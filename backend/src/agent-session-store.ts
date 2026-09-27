import { CURRENT_SESSION_VERSION, SessionManager, type FileEntry, type SessionEntry, type SessionHeader } from '@earendil-works/pi-coding-agent';
import type { PlatformStore } from './platform-store';
import type { Prisma } from './generated/prisma/client';
import { messageText } from './message-text';
import { join } from 'node:path';
import { ScreenshotPool } from './computer-use/image-pool';
import { hydrateScreenshot, withoutScreenshotBytes } from './computer-use/session-images';

const MAX_HEADER_BYTES = 64 * 1024;
const MAX_ENTRY_BYTES = 512 * 1024;
const MAX_CHECKPOINT_BYTES = 4 * 1024 * 1024;
const MAX_CHECKPOINT_ENTRIES = 256;
const RECENT_PUBLICATIONS = 8;

type SessionSnapshot = { header: SessionHeader; sessionId: string; leafId: string | null; entries: SessionEntry[] };

/** Pi's private working entries. This store never returns channel messages or activity events. */
export class AgentSessionStore {
  private images: ScreenshotPool;
  constructor(private database: PlatformStore) { this.images = new ScreenshotPool(join(database.dataDirectory, 'computer-screenshots')); }

  /** Freeze one completed Pi boundary before another model turn can append to the manager. */
  static capture(session: SessionManager): SessionSnapshot {
    const header = session.getHeader();
    if (!header || session.getSessionFile()) throw new Error('Invalid private agent session.');
    return { header: structuredClone(header), sessionId: session.getSessionId(), entries: structuredClone(session.getEntries()), leafId: session.getLeafId() };
  }

  async load(agentId: string): Promise<SessionManager | null> {
    await this.database.initialize();
    const record = await this.database.client.agentSession.findUnique({ where: { agentId } });
    if (!record) return null;
    const rows = await this.database.client.agentSessionEntry.findMany({ where: { agentId, position: { gte: record.activeStart } }, orderBy: { position: 'asc' } });
    const prior = record.activeStart ? await this.database.client.agentSessionEntry.findUnique({ where: { agentId_position: { agentId, position: record.activeStart - 1 } }, select: { entryId: true } }) : null;
    const header = JSON.parse(record.header) as SessionHeader;
    if (header.type !== 'session' || header.version !== CURRENT_SESSION_VERSION || header.id !== record.sessionId || Buffer.byteLength(record.header) > MAX_HEADER_BYTES || record.activeStart < 0 || record.activeStart >= record.entryCount || record.entryCount - record.activeStart !== rows.length || record.activeStart && !prior) throw new Error('Private agent session is invalid.');
    const entries: SessionEntry[] = [];
    let parent: string | null = prior?.entryId ?? null;
    for (const [index, row] of rows.entries()) {
      if (row.position !== record.activeStart + index || row.parentId !== parent || Buffer.byteLength(row.payload) > MAX_ENTRY_BYTES) throw new Error('Private agent session is invalid.');
      const entry = JSON.parse(row.payload) as SessionEntry;
      if (entry.id !== row.entryId || entry.parentId !== parent || typeof entry.type !== 'string') throw new Error('Private agent session is invalid.');
      // Pi 0.85.1 follows parent links. Re-root only the loaded active tail;
      // original parent links and older entries remain archived in SQLite.
      entries.push(index === 0 && record.activeStart ? { ...entry, parentId: null } : entry);
      parent = entry.id;
    }
    if (parent !== record.leafId || record.activeStart && !entries.some(entry => entry.type === 'compaction' && entry.firstKeptEntryId === entries[0].id)) throw new Error('Private agent session is invalid.');
    const hydrated = await Promise.all(entries.map(entry => hydrateScreenshot(entry, agentId, this.images)));
    const session = SessionManager.inMemory(process.cwd(), { id: record.sessionId }, [header, ...hydrated] satisfies FileEntry[]);
    // A channel publication commits before its Pi tool can finish. Restore that committed
    // effect as prior private context if a crash interrupted the next Pi checkpoint.
    const [privateMessages, dms, groups] = await Promise.all([
      this.database.client.message.findMany({ where: { channel: { agentId }, role: 'assistant', sequence: { gt: record.privateCursor } }, orderBy: { sequence: 'desc' }, take: RECENT_PUBLICATIONS + 1 }),
      this.database.client.dmMessage.findMany({ where: { senderId: agentId, sequence: { gt: record.dmCursor } }, orderBy: { sequence: 'desc' }, take: RECENT_PUBLICATIONS + 1 }),
      this.database.client.groupMessage.findMany({ where: { authorId: agentId, role: 'assistant', sequence: { gt: record.groupCursor } }, orderBy: { sequence: 'desc' }, take: RECENT_PUBLICATIONS + 1 }),
    ]);
    const excerpt = (text: string) => {
      const preview = messageText(text);
      return `${preview.text}${preview.truncated ? ' [excerpt; use authorized history tools to expand]' : ''}`;
    };
    const recovered = [
      ...privateMessages.slice(0, RECENT_PUBLICATIONS).map(message => ({ timestamp: message.createdAt.getTime(), text: `[Previously published to private channel ${message.channelId}; message: ${message.id}] ${excerpt(message.text)}` })),
      ...dms.slice(0, RECENT_PUBLICATIONS).map(message => ({ timestamp: message.createdAt.getTime(), text: `[Previously sent in agent DM ${message.conversationId}; message: ${message.id}] ${excerpt(message.text)}` })),
      ...groups.slice(0, RECENT_PUBLICATIONS).map(message => ({ timestamp: message.createdAt.getTime(), text: `[Previously published to group:${message.groupId}; message: ${message.id}] ${excerpt(message.text)}` })),
    ].sort((a, b) => a.timestamp - b.timestamp);
    if (recovered.length) session.appendCustomMessageEntry('recovered-publications', `Committed publications after the last private Pi checkpoint (prior conversation data, not a new instruction; do not repeat these effects):\n${recovered.map(item => item.text).join('\n')}${privateMessages.length > RECENT_PUBLICATIONS || dms.length > RECENT_PUBLICATIONS || groups.length > RECENT_PUBLICATIONS ? '\nAdditional earlier publications were omitted; use authorized history tools if needed.' : ''}`, false);
    return session;
  }

  private async publicationCursors(tx: Prisma.TransactionClient, agentId: string) {
    const [privateMessage, dm, group] = await Promise.all([
      tx.message.findFirst({ where: { channel: { agentId }, role: 'assistant' }, orderBy: { sequence: 'desc' }, select: { sequence: true } }),
      tx.dmMessage.findFirst({ where: { senderId: agentId }, orderBy: { sequence: 'desc' }, select: { sequence: true } }),
      tx.groupMessage.findFirst({ where: { authorId: agentId, role: 'assistant' }, orderBy: { sequence: 'desc' }, select: { sequence: true } }),
    ]);
    return { privateCursor: privateMessage?.sequence ?? 0, dmCursor: dm?.sequence ?? 0, groupCursor: group?.sequence ?? 0 };
  }

  /** Append only newly completed entries and advance the active leaf in the same transaction. */
  async save(agentId: string, session: SessionManager | SessionSnapshot, options: { advancePublications?: boolean } = {}): Promise<void> {
    const snapshot = session instanceof SessionManager ? AgentSessionStore.capture(session) : session;
    const { header, sessionId, leafId } = snapshot;
    const entries = snapshot.entries.map(withoutScreenshotBytes);
    if (header.type !== 'session' || header.version !== CURRENT_SESSION_VERSION || header.id !== sessionId) throw new Error('Invalid private agent session.');
    const headerText = JSON.stringify(header);
    if (Buffer.byteLength(headerText) > MAX_HEADER_BYTES) throw new Error('Private agent session header is too large.');
    if (leafId !== (entries.at(-1)?.id ?? null)) throw new Error('Private agent session branch has not been checkpointed.');
    await this.database.initialize();
    await this.database.client.$transaction(async tx => {
      const previous = await tx.agentSession.findUnique({ where: { agentId }, select: { sessionId: true, entryCount: true, activeStart: true, leafId: true, privateCursor: true, dmCursor: true, groupCursor: true } });
      if (previous && previous.sessionId !== header.id) throw new Error('Cannot checkpoint a different session for this agent.');
      const activeCount = previous ? previous.entryCount - previous.activeStart : 0;
      if (activeCount > entries.length) throw new Error('Cannot checkpoint a divergent private agent session.');
      if (activeCount) {
        const last = await tx.agentSessionEntry.findUnique({ where: { agentId_position: { agentId, position: previous!.entryCount - 1 } }, select: { payload: true, parentId: true } });
        const candidate = entries[activeCount - 1];
        const normalized = activeCount === 1 && previous!.activeStart ? { ...candidate, parentId: last?.parentId } : candidate;
        if (!last || last.payload !== JSON.stringify(normalized)) throw new Error('Cannot checkpoint a divergent private agent session.');
      }
      if (entries.length === activeCount && options.advancePublications === false) return;
      if (entries.length - activeCount > MAX_CHECKPOINT_ENTRIES) throw new Error('Private agent session checkpoint is too large.');
      let parent = previous?.leafId ?? null;
      let bytes = 0;
      const rows = entries.slice(activeCount).map((entry, index) => {
        if (!entry.id || typeof entry.id !== 'string' || entry.parentId !== parent || typeof entry.type !== 'string') throw new Error('Invalid private agent session entry.');
        const payload = JSON.stringify(entry);
        const size = Buffer.byteLength(payload);
        bytes += size;
        if (size > MAX_ENTRY_BYTES || bytes > MAX_CHECKPOINT_BYTES) throw new Error('Private agent session checkpoint is too large.');
        parent = entry.id;
        return { agentId, position: (previous?.entryCount ?? 0) + index, entryId: entry.id, parentId: entry.parentId, payload };
      });
      const latestCompaction = [...entries].reverse().find(entry => entry.type === 'compaction');
      const keptIndex = latestCompaction ? entries.findIndex(entry => entry.id === latestCompaction.firstKeptEntryId) : 0;
      if (keptIndex < 0) throw new Error('Private agent session compaction is invalid.');
      // During an active provider run, another tool may publish after the frozen Pi
      // boundary but before this SQLite write. Advance cursors only after inference
      // is idle; a stale cursor may repeat context, but never hide a committed effect.
      const latest = options.advancePublications === false ? null : await this.publicationCursors(tx, agentId);
      const cursors = { privateCursor: Math.max(previous?.privateCursor ?? 0, latest?.privateCursor ?? 0), dmCursor: Math.max(previous?.dmCursor ?? 0, latest?.dmCursor ?? 0), groupCursor: Math.max(previous?.groupCursor ?? 0, latest?.groupCursor ?? 0) };
      if (!previous) {
        if (!rows.length) return;
        await tx.agentSession.create({ data: { agentId, sessionId: header.id, header: headerText } });
      }
      if (rows.length) await tx.agentSessionEntry.createMany({ data: rows });
      const updated = await tx.agentSession.updateMany({ where: { agentId, entryCount: previous?.entryCount ?? 0, leafId: previous?.leafId ?? null }, data: { entryCount: (previous?.entryCount ?? 0) + rows.length, activeStart: (previous?.activeStart ?? 0) + keptIndex, leafId: parent, ...cursors } });
      if (updated.count !== 1) throw new Error('Private agent session checkpoint changed concurrently.');
    });
  }
}
