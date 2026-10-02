import type { PlatformStore } from '../platform-store';
import type { SwarmSettingsStore } from '../swarm-settings';
import type { AgentMemory } from '../generated/prisma/client';

/**
 * An agent's long-term memory (docs/agent-memory.md): typed memories, each with a one-line title (its hook in the
 * index), provenance and versions. Search is literal (words, no model call), so recall is cheap enough to run on
 * every input and tool call. Memories are cached per agent in this one backend process and refreshed on every write.
 */
export const MEMORY_TYPES = ['person', 'preference', 'project', 'skill', 'reference'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];
/** Who caused a memory: the owner, the agent itself (its own work, platform events), another agent, anyone else. */
export type MemoryTrust = 'owner' | 'self' | 'agent' | 'other';
export type Provenance = { by: string; trust: MemoryTrust; channelId?: string };
/** Who changed a memory: the agent awake, the agent asleep, or the owner in the dashboard. */
export type ChangedBy = 'agent' | 'sleep' | 'owner';
export type MemoryHit = AgentMemory & { score: number; excerpt: string };
export class MemoryError extends Error {}
/** How a line marks a memory caused by someone other than the owner or the agent (it is information, not an order). */
export const UNTRUSTED: Record<string, string> = { agent: ', from an agent', other: ', untrusted' };

const TITLE_MAX = 120;
const STOPWORDS = new Set(
  (
    'the and for are but not you your yours with this that these those from have has had was were will would can ' +
    'could should shall may might must our ours their them they she her his him its into onto out over under than ' +
    'then there here what when where which who whom why how all any each few more most other some such only own ' +
    'same too very just also about again once both does did doing done been being because until while off very ' +
    'please thanks thank okay yes yeah let lets get got make made like want need know think see now new one two'
  ).split(' '),
);
/** Distinct lower-case words of 3+ letters or digits, without common words: what a text is about. */
export function keywords(text: string, limit = 60) {
  const words = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}]{3,}/gu)) {
    const word = match[0];
    if (!STOPWORDS.has(word) && !/^\d{1,3}$/.test(word)) words.add(word);
    if (words.size >= limit) break;
  }
  return [...words];
}

/** Text that looks like a credential: memories must never hold secrets. */
const SECRET =
  /(sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.|[MN][A-Za-z\d]{23,25}\.[\w-]{6}\.[\w-]{27,})/;

const slug = (title: string) =>
  title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '') || 'memory';

type Indexed = { memory: AgentMemory; title: Set<string>; text: Set<string> };

export class MemoryStore {
  private cache = new Map<string, Indexed[]>();
  constructor(
    private database: PlatformStore,
    private settings: SwarmSettingsStore,
  ) {}

  /** The agent's memories (newest change first); forgotten ones only when asked. */
  async list(agentId: string, { forgotten = false } = {}) {
    await this.database.initialize();
    return this.database.client.agentMemory.findMany({
      where: { agentId, deletedAt: forgotten ? { not: null } : null },
      orderBy: { updatedAt: 'desc' },
      take: 10000,
    });
  }
  async get(agentId: string, name: string) {
    await this.database.initialize();
    return this.database.client.agentMemory.findFirst({ where: { agentId, name, deletedAt: null } });
  }
  private async find(agentId: string, name: string, forgotten = false) {
    await this.database.initialize();
    const memory = await this.database.client.agentMemory.findUnique({ where: { agentId_name: { agentId, name } } });
    if (!memory || Boolean(memory.deletedAt) !== forgotten)
      throw new MemoryError(
        forgotten ? `No forgotten memory named ${name}.` : `No memory named ${name}. recall({query}) finds names.`,
      );
    return memory;
  }

  private async check(fields: { type?: string; title?: string; text?: string }) {
    if (fields.type !== undefined && !MEMORY_TYPES.includes(fields.type as MemoryType))
      throw new MemoryError(`A memory's type is one of ${MEMORY_TYPES.join(', ')}.`);
    if (fields.title !== undefined) {
      if (!fields.title.trim() || fields.title.length > TITLE_MAX || /[\r\n]/.test(fields.title))
        throw new MemoryError(`A title is one line of at most ${TITLE_MAX} characters.`);
    }
    if (fields.text !== undefined) {
      const { memoryMaxChars } = await this.settings.get();
      if (!fields.text.trim()) throw new MemoryError('A memory needs text.');
      if (fields.text.length > memoryMaxChars)
        throw new MemoryError(
          `A memory holds at most ${memoryMaxChars} characters (Settings → Swarm). Keep the gist; details stay findable with remember_when.`,
        );
    }
    if (SECRET.test(`${fields.title ?? ''}\n${fields.text ?? ''}`))
      throw new MemoryError(
        'That looks like a secret (a token, key or password); memories must not hold secrets. Remember where it is kept instead.',
      );
  }

  async memorize(agentId: string, fields: { type: MemoryType; title: string; text: string }, from: Provenance) {
    const title = fields.title.trim(),
      text = fields.text.trim();
    await this.check({ type: fields.type, title, text });
    await this.database.initialize();
    const { memoryMaxCount } = await this.settings.get();
    const live = await this.database.client.agentMemory.count({ where: { agentId, deletedAt: null } });
    if (live >= memoryMaxCount)
      throw new MemoryError(
        `You already hold ${memoryMaxCount} memories (Settings → Swarm). Revise or forget one, or merge similar ones.`,
      );
    const same = await this.database.client.agentMemory.findFirst({ where: { agentId, title, deletedAt: null } });
    if (same) throw new MemoryError(`You already remember "${title}" (${same.name}). Revise it instead.`);
    const base = slug(title);
    const taken = new Set(
      (
        await this.database.client.agentMemory.findMany({
          where: { agentId, name: { startsWith: base } },
          select: { name: true },
        })
      ).map(row => row.name),
    );
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
    const memory = await this.database.client.agentMemory.create({
      data: {
        agentId,
        name,
        type: fields.type,
        title,
        text,
        by: from.by,
        trust: from.trust,
        channelId: from.channelId,
      },
    });
    this.cache.delete(agentId);
    return memory;
  }

  /**
   * Changes a memory, keeping its previous text as a version. `expected` (the updatedAt a writer read) makes a stale
   * change fail instead of overwriting a newer one: sleep works from a snapshot, and the agent's own edits win.
   */
  async revise(
    agentId: string,
    name: string,
    changes: { type?: MemoryType; title?: string; text?: string; faded?: boolean; conflict?: boolean },
    by: ChangedBy,
    expected?: Date,
  ) {
    const title = changes.title?.trim(),
      text = changes.text?.trim();
    await this.check({ type: changes.type, title, text });
    const memory = await this.find(agentId, name);
    if (expected && memory.updatedAt.getTime() !== expected.getTime())
      throw new MemoryError(`${name} changed since you read it; it was left as it is.`);
    const content =
      (title !== undefined && title !== memory.title) ||
      (text !== undefined && text !== memory.text) ||
      (changes.type !== undefined && changes.type !== memory.type);
    const updated = await this.database.client.$transaction(async tx => {
      if (content)
        await tx.agentMemoryVersion.create({
          data: { memoryId: memory.id, title: memory.title, text: memory.text, type: memory.type, changedBy: by },
        });
      const row = await tx.agentMemory.updateMany({
        where: { id: memory.id, updatedAt: memory.updatedAt },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(text !== undefined ? { text } : {}),
          ...(changes.type !== undefined ? { type: changes.type } : {}),
          ...(changes.faded !== undefined ? { faded: changes.faded } : {}),
          ...(changes.conflict !== undefined ? { conflict: changes.conflict } : {}),
        },
      });
      if (row.count !== 1) throw new MemoryError(`${name} changed meanwhile; read it again.`);
      return tx.agentMemory.findUniqueOrThrow({ where: { id: memory.id } });
    });
    this.cache.delete(agentId);
    return updated;
  }

  async versions(agentId: string, name: string) {
    await this.database.initialize();
    const memory = await this.database.client.agentMemory.findUnique({ where: { agentId_name: { agentId, name } } });
    if (!memory) throw new MemoryError(`No memory named ${name}.`);
    return this.database.client.agentMemoryVersion.findMany({
      where: { memoryId: memory.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /** Forgets a memory: it leaves recall and the index but is kept, restorable (never silently erased). */
  async forget(agentId: string, name: string, by: ChangedBy, expected?: Date) {
    const memory = await this.find(agentId, name);
    if (expected && memory.updatedAt.getTime() !== expected.getTime())
      throw new MemoryError(`${name} changed since you read it; it was left as it is.`);
    await this.database.client.$transaction([
      this.database.client.agentMemoryVersion.create({
        data: { memoryId: memory.id, title: memory.title, text: memory.text, type: memory.type, changedBy: by },
      }),
      this.database.client.agentMemory.update({ where: { id: memory.id }, data: { deletedAt: new Date() } }),
    ]);
    this.cache.delete(agentId);
  }
  async restore(agentId: string, name: string) {
    const memory = await this.find(agentId, name, true);
    const restored = await this.database.client.agentMemory.update({
      where: { id: memory.id },
      data: { deletedAt: null },
    });
    this.cache.delete(agentId);
    return restored;
  }
  /** The owner erases everything the agent remembers (versions too), and its index. */
  async eraseAll(agentId: string) {
    await this.database.initialize();
    await this.database.client.$transaction([
      this.database.client.agentMemory.deleteMany({ where: { agentId } }),
      this.database.client.agent.update({
        where: { id: agentId },
        data: { memoryIndex: '', sleepNote: '', sleepNoteTold: true },
      }),
    ]);
    this.cache.delete(agentId);
  }

  /** Recalled or attached as a reminder: recall strengthens (sleep orders the index by it). */
  async recalled(agentId: string, names: string[]) {
    if (!names.length) return;
    await this.database.initialize();
    await this.database.client.agentMemory.updateMany({
      where: { agentId, name: { in: names } },
      data: { recalls: { increment: 1 }, lastRecalledAt: new Date() },
    });
    // Counts do not change what search finds: the cache stays.
  }

  private async indexed(agentId: string) {
    const cached = this.cache.get(agentId);
    if (cached) return cached;
    const rows = (await this.list(agentId)).map(memory => ({
      memory,
      title: new Set([...keywords(memory.title, 200), ...keywords(memory.name.replace(/-/g, ' '), 200)]),
      text: new Set(keywords(memory.text, 2000)),
    }));
    this.cache.set(agentId, rows);
    return rows;
  }

  private score(rows: Indexed[], words: string[], phrase?: string) {
    const hits: MemoryHit[] = [];
    for (const row of rows) {
      let score = 0,
        first: string | undefined;
      for (const word of words)
        if (row.title.has(word)) {
          score += 3;
          first ??= word;
        } else if (row.text.has(word)) {
          score += 1;
          first ??= word;
        }
      if (phrase && phrase.includes(' ') && `${row.memory.title}\n${row.memory.text}`.toLowerCase().includes(phrase))
        score += 3;
      if (score) hits.push({ ...row.memory, score, excerpt: excerpt(row.memory.text, first) });
    }
    return hits.sort((a, b) => b.score - a.score || b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  /** recall: memories matching the query's words, most relevant first, then newest. */
  async search(agentId: string, query: string, { type, limit = 10 }: { type?: MemoryType; limit?: number } = {}) {
    const rows = (await this.indexed(agentId)).filter(row => !type || row.memory.type === type);
    return this.score(rows, keywords(query), query.trim().toLowerCase()).slice(0, limit);
  }

  /**
   * Cue-driven recall: memories a text (an input, a tool call) brings to mind. Only good matches (a word of the
   * title, or three of its text), skipping those shown recently (`skip`, by id), most relevant then newest.
   */
  async cues(agentId: string, text: string, limit: number, skip = new Set<string>()) {
    const rows = (await this.indexed(agentId)).filter(row => !skip.has(row.memory.id));
    if (!rows.length) return [];
    return this.score(rows, keywords(text, 80))
      .filter(hit => hit.score >= 3)
      .slice(0, limit);
  }

  /**
   * The index: one line per memory (name, type, title), not faded, most used and most recent first, under the
   * Settings → Swarm caps. Saved on the agent; it shows in its system prompt from its next turn (rebuilt at sleep).
   */
  async rebuildIndex(agentId: string) {
    const { memoryIndexMaxLines, memoryIndexMaxChars } = await this.settings.get();
    const live = (await this.list(agentId)).filter(memory => !memory.faded);
    const used = (memory: AgentMemory) => (memory.lastRecalledAt ?? memory.updatedAt).getTime();
    live.sort((a, b) => Number(b.conflict) - Number(a.conflict) || used(b) - used(a) || b.recalls - a.recalls);
    const lines: string[] = [];
    let size = 0;
    for (const [index, memory] of live.entries()) {
      const line = `- ${memory.name} [${memory.type}${memory.conflict ? ', conflict' : ''}${UNTRUSTED[memory.trust] ?? ''}] ${memory.title}`;
      const left = live.length - index;
      const room =
        lines.length < memoryIndexMaxLines - (left > 1 ? 1 : 0) && size + line.length + 60 < memoryIndexMaxChars;
      if (!room) {
        lines.push(`- …and ${left} more: recall finds them.`);
        break;
      }
      lines.push(line);
      size += line.length + 1;
    }
    const index = lines.join('\n');
    await this.database.client.agent.update({ where: { id: agentId }, data: { memoryIndex: index } });
    return index;
  }
}

/** About 100 characters of a memory's text, around the first matching word. */
export function excerpt(text: string, word?: string, size = 100) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= size) return flat;
  const at = word ? Math.max(0, flat.toLowerCase().indexOf(word) - 30) : 0;
  const start = at > 0 ? at : 0;
  return `${start ? '…' : ''}${flat.slice(start, start + size).trim()}…`;
}
