import type { PlatformStore } from '../platform-store';

/**
 * Deep storage: the agent's saved session archive (every entry it ever had in context, never deleted), searched word
 * for word. Results are bounded excerpts, only from channels the agent can still access (checked on every call), and
 * archive text is untrusted prior data, never new instructions.
 */
type Entry = {
  type: string;
  id: string;
  timestamp?: string;
  customType?: string;
  content?: unknown;
  summary?: string;
  message?: { role: string; content?: unknown; toolName?: string };
};
export type Episode = { id: string; at: string; channel: string | null; kind: string; text: string };

const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .map(part =>
            part?.type === 'text'
              ? part.text
              : part?.type === 'toolCall'
                ? `→ ${part.name}(${JSON.stringify(part.arguments ?? {}).slice(0, 300)})`
                : part?.type === 'image'
                  ? '[image]'
                  : '',
          )
          .filter(Boolean)
          .join('\n')
      : '';

/** What an archive entry says, as text (thinking is left out), or null for bookkeeping entries. */
export function entryText(entry: Entry): { kind: string; text: string } | null {
  if (entry.type === 'message' && entry.message) {
    const { role, toolName } = entry.message;
    const text = textOf(entry.message.content);
    if (role === 'toolResult') return { kind: `result of ${toolName ?? 'a tool'}`, text };
    if (role === 'user' || role === 'assistant') return { kind: role === 'user' ? 'input' : 'you', text };
    return null;
  }
  if (entry.type === 'custom_message') return { kind: `note (${entry.customType})`, text: textOf(entry.content) };
  if (entry.type === 'compaction') return { kind: 'summary', text: entry.summary ?? '' };
  return null;
}
/**
 * Every channel an input draws from: a prompt can batch inputs from several channels, each starting a line with its
 * [channel: …] (bodies cannot forge one at a line start, and a forged extra channel could only hide an entry).
 */
const channelsOf = (text: string) => [
  ...new Set([...text.matchAll(/^\[channel: ([^\]\s]+)\]/gm)].map(match => match[1])),
];
const clip = (text: string, around: number, size: number) => {
  const start = Math.max(0, around - Math.floor(size / 3));
  return `${start ? '…' : ''}${text.slice(start, start + size)}${start + size < text.length ? '…' : ''}`;
};
const like = (word: string) => `%${word.replace(/[\\%_]/g, char => `\\${char}`)}%`;

export class DeepStorage {
  constructor(
    private database: PlatformStore,
    /** Whether the agent may still read this channel (its own private chat, its DMs, groups, allowed Discord). */
    private canRead: (agentId: string, channelId: string) => Promise<boolean>,
  ) {}

  /** The channels an entry belongs to: those of the input that started its stretch of context. */
  private async channelsAt(agentId: string, position: number, own: Entry): Promise<string[]> {
    const ownText = entryText(own);
    if (own.message?.role === 'user' && ownText) return channelsOf(ownText.text);
    const before = await this.database.client.agentSessionEntry.findFirst({
      where: { agentId, position: { lt: position }, payload: { contains: '"role":"user"' } },
      orderBy: { position: 'desc' },
      select: { payload: true },
    });
    const text = before ? entryText(JSON.parse(before.payload) as Entry) : null;
    return text ? channelsOf(text.text) : [];
  }
  /** Readable only if every channel it draws from still is (entries before any input belong to the agent itself). */
  private async readable(agentId: string, channels: string[], cache: Map<string, boolean>) {
    for (const channel of channels) {
      if (!cache.has(channel)) cache.set(channel, await this.canRead(agentId, channel).catch(() => false));
      if (!cache.get(channel)) return false;
    }
    return true;
  }

  /**
   * remember_when: entries whose text holds every word of the query (newest first), optionally within a time span or
   * one channel. At most `limit` excerpts of about 300 characters.
   */
  async search(
    agentId: string,
    {
      query,
      from,
      to,
      channel,
      limit = 8,
    }: { query: string; from?: Date; to?: Date; channel?: string; limit?: number },
  ) {
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .map(word => word.trim())
      .filter(word => word.length >= 2)
      .slice(0, 6);
    if (!words.length) throw new Error('Search for at least one word of two letters or more.');
    await this.database.initialize();
    const results: Episode[] = [];
    const access = new Map<string, boolean>();
    let before: number | undefined;
    // Scan newest first in pages; the archive can be long, so stop after a bounded number of candidates.
    for (let page = 0; page < 5 && results.length < limit; page++) {
      const rows = await this.database.client.agentSessionEntry.findMany({
        where: {
          agentId,
          ...(before === undefined ? {} : { position: { lt: before } }),
          AND: words.map(word => ({ payload: { contains: word } })),
        },
        orderBy: { position: 'desc' },
        take: 100,
        select: { position: true, payload: true, entryId: true },
      });
      if (!rows.length) break;
      before = rows.at(-1)!.position;
      for (const row of rows) {
        const entry = JSON.parse(row.payload) as Entry;
        const said = entryText(entry);
        if (!said) continue;
        const lower = said.text.toLowerCase();
        if (!words.every(word => lower.includes(word))) continue;
        const at = entry.timestamp ?? '';
        if ((from && at && new Date(at) < from) || (to && at && new Date(at) > to)) continue;
        const where = await this.channelsAt(agentId, row.position, entry);
        if (channel && !where.includes(channel)) continue;
        if (!(await this.readable(agentId, where, access))) continue;
        results.push({
          id: row.entryId,
          at,
          channel: where.join(', ') || null,
          kind: said.kind,
          text: clip(said.text, lower.indexOf(words[0]), 300),
        });
        if (results.length >= limit) break;
      }
      if (rows.length < 100) break;
    }
    return results;
  }

  /** read_episode: the entries around one (`around` before and after), each up to 1500 characters. */
  async episode(agentId: string, id: string, around = 4) {
    await this.database.initialize();
    const row = await this.database.client.agentSessionEntry.findUnique({
      where: { agentId_entryId: { agentId, entryId: id } },
      select: { position: true },
    });
    if (!row) throw new Error(`No episode ${id} in your memory. remember_when finds them.`);
    const span = Math.min(Math.max(around, 0), 10);
    const rows = await this.database.client.agentSessionEntry.findMany({
      where: { agentId, position: { gte: row.position - span, lte: row.position + span } },
      orderBy: { position: 'asc' },
      select: { position: true, payload: true, entryId: true },
    });
    const access = new Map<string, boolean>();
    const entries: Episode[] = [];
    let hidden = 0;
    for (const item of rows) {
      const entry = JSON.parse(item.payload) as Entry;
      const said = entryText(entry);
      if (!said) continue;
      const where = await this.channelsAt(agentId, item.position, entry);
      if (!(await this.readable(agentId, where, access))) {
        hidden++;
        continue;
      }
      entries.push({
        id: item.entryId,
        at: entry.timestamp ?? '',
        channel: where.join(', ') || null,
        kind: said.kind,
        text: clip(said.text, 0, 1500),
      });
    }
    if (!entries.some(entry => entry.id === id))
      throw new Error('That episode is in a channel you can no longer read.');
    return {
      entries,
      ...(hidden ? { hidden: `${hidden} entries from channels you can no longer read were left out.` } : {}),
    };
  }
}
