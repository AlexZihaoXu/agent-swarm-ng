import { parseGrant } from './tickets/tools';
import { randomUUID } from 'node:crypto';
import type { PlatformStore } from './platform-store';
import { FileError, type FileStore } from './files/store';
import { detectFile, fileName } from './files/file-kind';
import { ScratchError, type Scratchpad } from './scratchpad';
import { DISCORD_TOKEN, type DiscordTokenStore } from './discord/token-store';
import { ArchiveError, type OpenedArchive } from './agent-archive';
import { AGENT_FILE_FORMAT, AGENT_FILE_VERSION, type ExportIncludes } from './agent-export';
import { dmConversationId, IMPORTED_DM } from './swarm-store';
import { encodeAvatar, parseAvatar } from './agent-avatar';
import { COMPACTION_RANGES } from './background-compaction';
import { HEARTBEAT_CHECKLIST_MAX, HEARTBEAT_MINUTES } from './heartbeat';
import { TIME_NOTE_CHOICES, TIME_NOTE_DEFAULT } from './time-notes';
import {
  FAST_REMINDER_SECONDS,
  MAX_ACTIVE_TIMERS,
  MAX_DELAY_SECONDS,
  MAX_FAST_REMINDER_TIMES,
  MIN_REMINDER_SECONDS,
  TIMER_NOTE_MAX,
} from './agent-timers';
import { swarmSettingBounds } from './swarm-settings';

/** The links an imported agent had that do not exist here (Agent.unresolved): shown in its settings to fix. */
export type Unresolved = {
  computers: { id: string; name: string }[];
  dmPeers: { id: string; name: string; sends: boolean; receives: boolean }[];
  groups: { id: string; name: string }[];
};
export const unresolvedOf = (value: string): Unresolved => {
  try {
    const parsed = JSON.parse(value || '{}') as Partial<Unresolved>;
    return {
      computers: Array.isArray(parsed.computers) ? parsed.computers : [],
      dmPeers: Array.isArray(parsed.dmPeers) ? parsed.dmPeers : [],
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
    };
  } catch {
    return { computers: [], dmPeers: [], groups: [] };
  }
};

type Manifest = { format?: unknown; version?: unknown; includes?: Partial<ExportIncludes>; agent?: { name?: unknown } };
type Row = Record<string, unknown>;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const number = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const integer = (value: unknown, fallback: number) => Math.trunc(number(value, fallback));
/** A whole number within the bounds the settings routes enforce. */
const within = (value: unknown, fallback: number, range: { minimum: number; maximum: number }) =>
  Math.min(range.maximum, Math.max(range.minimum, integer(value, fallback)));
const CLOCK = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const clock = (value: unknown, fallback: string) => {
  const parsed = text(value, fallback);
  return parsed === '' || CLOCK.test(parsed) ? parsed : fallback;
};
const FILE_KINDS = ['image', 'video', 'text', 'pdf', 'other', 'scratch'];
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const date = (value: unknown, fallback = new Date()) => {
  const parsed = typeof value === 'string' || typeof value === 'number' ? new Date(value) : fallback;
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};
const optionalDate = (value: unknown) => (value == null ? null : date(value));
const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
/** Bulk inserts, a few hundred rows at a time (SQLite variable limits). */
async function insert<T>(rows: T[], write: (batch: T[]) => Promise<unknown>) {
  for (let index = 0; index < rows.length; index += 200) await write(rows.slice(index, index + 200));
}

/**
 * A new agent from an agent file (docs/agent-export.md), in `organizationId`, paused until reviewed. Everything is
 * kept as it was, settings included, even those that do not work here (a provider that does not exist shows in red
 * in its settings). Every id is new; the old ids of the agent, its channels, messages and files are rewritten inside
 * the saved context too. Links resolve by id where they exist here (same organization); the rest are kept unresolved.
 * Returns the new agent's id and what could not be brought over.
 */
export async function importAgent(
  database: PlatformStore,
  stores: { files: FileStore; scratch: Scratchpad; tokens: DiscordTokenStore },
  archive: OpenedArchive,
  organizationId: string,
) {
  const { files: fileStore, scratch, tokens } = stores;
  const client = database.client;
  const manifest = await archive.json<Manifest>('manifest.json');
  if (manifest.format !== AGENT_FILE_FORMAT) throw new ArchiveError('This is not an agent file.');
  if (typeof manifest.version !== 'number' || manifest.version > AGENT_FILE_VERSION)
    throw new ArchiveError('This agent file is from a newer version of Agent Swarm. Update to import it.');
  const saved = await archive.json<{ settings: Row; channels: { id: string; kind: string }[] }>('agent.json');
  const settings = saved.settings ?? {};
  const links = await archive.json<Partial<Unresolved>>('links.json').catch(() => ({}) as Partial<Unresolved>);

  // Old ids → new ones, applied to every id field and inside the saved context and activity.
  const ids = new Map<string, string>();
  const fresh = (old: unknown) => {
    const key = text(old);
    if (!key) return randomUUID();
    let next = ids.get(key);
    if (!next) ids.set(key, (next = randomUUID()));
    return next;
  };
  const oldAgentId = text((await archive.json<{ agent?: { id?: unknown } }>('manifest.json')).agent?.id);
  const agentId = fresh(oldAgentId);
  const channels = (Array.isArray(saved.channels) ? saved.channels : []).map(channel => ({
    id: fresh(channel.id),
    kind: text(channel.kind, 'platform-chat'),
  }));
  if (!channels.length) channels.push({ id: randomUUID(), kind: 'platform-chat' });
  const messages = await archive.lines<Row>('messages.jsonl');
  for (const message of messages) fresh(message.id);
  const files = await archive.lines<Row>('files.jsonl');
  for (const file of files) fresh(file.id);
  const rewrite = (value: string) => value.replace(UUID, match => ids.get(match.toLowerCase()) ?? match);

  const thinking = text(settings.thinkingLevel);
  await client.agent.create({
    data: {
      id: agentId,
      organizationId,
      name: text(settings.name, text(manifest.agent?.name, 'Imported agent')).slice(0, 80) || 'Imported agent',
      // Settings are kept as they were, within what the settings routes accept.
      avatar: parseAvatar(settings.avatar) && encodeAvatar(parseAvatar(settings.avatar)!),
      endpointId: text(settings.endpointId),
      model: text(settings.model),
      thinkingLevel: (LEVELS.includes(thinking) ? thinking : 'off') as never,
      modelChain: text(settings.modelChain, '{}'),
      compactAtPercent: within(settings.compactAtPercent, 65, COMPACTION_RANGES.atPercent),
      idleCompactMinutes: within(settings.idleCompactMinutes, 30, COMPACTION_RANGES.idleMinutes),
      idleCompactPercent: within(settings.idleCompactPercent, 50, COMPACTION_RANGES.idlePercent),
      instructions: text(settings.instructions),
      heartbeatEnabled: bool(settings.heartbeatEnabled, false),
      heartbeatMinutes: within(settings.heartbeatMinutes, 30, HEARTBEAT_MINUTES),
      heartbeatFrom: clock(settings.heartbeatFrom, ''),
      heartbeatTo: clock(settings.heartbeatTo, ''),
      heartbeatChecklist: text(settings.heartbeatChecklist).slice(0, HEARTBEAT_CHECKLIST_MAX),
      todos: text(settings.todos, '[]'),
      timeNoteMinutes: (TIME_NOTE_CHOICES as readonly number[]).includes(settings.timeNoteMinutes as number)
        ? (settings.timeNoteMinutes as number)
        : TIME_NOTE_DEFAULT,
      ticketTools: JSON.stringify(parseGrant(text(settings.ticketTools, '[]'))),
      memoryIndex: text(settings.memoryIndex),
      sleepFrom: clock(settings.sleepFrom, '03:00'),
      sleepTo: clock(settings.sleepTo, '05:00'),
      sleptAt: optionalDate(settings.sleptAt),
      sleptPosition: integer(settings.sleptPosition, 0),
      sleepNote: text(settings.sleepNote),
      sleepNoteTold: bool(settings.sleepNoteTold, false),
      createdAt: date(settings.createdAt),
      paused: true,
      channels: { create: channels },
    },
  });
  const skipped = { dms: 0, links: 0 };
  const chains = new Map<string, string>();
  try {
    // Chat: messages (replies to a message not brought along are dropped), reactions.
    const kept = new Set(messages.map(message => ids.get(text(message.id))!));
    const channelOf = (old: unknown) => ids.get(text(old)) ?? channels[0]!.id;
    await insert(messages, batch =>
      client.message.createMany({
        data: batch.map(message => {
          const replyTo = ids.get(text(message.replyToId));
          return {
            id: ids.get(text(message.id))!,
            channelId: channelOf(message.channelId),
            role: (text(message.role) === 'assistant' ? 'assistant' : 'user') as never,
            authorUserId: null,
            authorName: typeof message.authorName === 'string' ? message.authorName : null,
            text: text(message.text),
            replyToId: replyTo && kept.has(replyTo) ? replyTo : null,
            createdAt: date(message.createdAt),
          };
        }),
      }),
    );
    const reactions = (await archive.lines<Row>('reactions.jsonl')).filter(row => ids.has(text(row.messageId)));
    await insert(reactions, batch =>
      client.messageReaction.createMany({
        data: batch.map(row => ({
          id: randomUUID(),
          messageId: ids.get(text(row.messageId))!,
          actorKey: rewrite(text(row.actorKey, 'human')),
          agentId: row.agentId === oldAgentId ? agentId : null,
          emoji: text(row.emoji),
        })),
      }),
    );

    // Agent-to-agent DMs: only its own (exactly one side is the agent), with an agent here in the same organization.
    const dms = await archive.lines<Row>('dm-messages.jsonl');
    const peerOf = (dm: Row) =>
      (dm.senderId === oldAgentId) !== (dm.recipientId === oldAgentId)
        ? text(dm.senderId === oldAgentId ? dm.recipientId : dm.senderId)
        : '';
    const peerIds = new Set(dms.map(peerOf).filter(Boolean));
    const present = new Set(
      (await client.agent.findMany({ where: { id: { in: [...peerIds] }, organizationId }, select: { id: true } })).map(
        row => row.id,
      ),
    );
    const keptDms = dms.filter(dm => present.has(peerOf(dm)));
    skipped.dms = dms.length - keptDms.length;
    for (const dm of keptDms) if (!chains.has(text(dm.chainId))) chains.set(text(dm.chainId), randomUUID());
    for (const chain of chains.values())
      await client.dmChain.create({ data: { id: chain, rootAgentId: agentId, remaining: 0, cancelled: true } });
    for (const dm of keptDms) fresh(dm.id);
    await insert(keptDms, batch =>
      client.dmMessage.createMany({
        data: batch.map(dm => {
          const sender = dm.senderId === oldAgentId ? agentId : text(dm.senderId);
          const recipient = dm.recipientId === oldAgentId ? agentId : text(dm.recipientId);
          const replyTo = ids.get(text(dm.replyToId));
          return {
            id: ids.get(text(dm.id))!,
            conversationId: dmConversationId(sender, recipient),
            senderId: sender,
            recipientId: recipient,
            text: text(dm.text),
            replyToId: replyTo ?? null,
            chainId: chains.get(text(dm.chainId))!,
            deliveryKey: randomUUID(),
            // Imported, never delivered here: a peer's recovered publications skip these (agent-session-store.ts).
            status: IMPORTED_DM,
            createdAt: date(dm.createdAt),
          };
        }),
      }),
    );

    // Files of the chats brought along: bytes first (by content hash), then their rows.
    const keyOf = (old: string) => {
      if (old.startsWith('chat:')) return `chat:${ids.get(old.slice(5)) ?? channels[0]!.id}`;
      if (old.startsWith('dm:')) {
        const [a = '', b = ''] = old.slice(3).split(':');
        if ((a === oldAgentId) === (b === oldAgentId)) return null;
        const peer = a === oldAgentId ? b : a;
        return present.has(peer) ? dmConversationId(agentId, peer) : null;
      }
      return null;
    };
    for (const file of files) {
      const key = keyOf(text(file.channelKey));
      if (!key) continue;
      const blobId = text(file.blobId);
      const uploaderIsAgent = file.uploaderId === oldAgentId;
      const row = {
        id: ids.get(text(file.id))!,
        channelKey: key,
        messageKind: typeof file.messageKind === 'string' ? file.messageKind : null,
        messageId: ids.get(text(file.messageId)) ?? null,
        uploaderKind: text(file.uploaderKind, 'human'),
        uploaderId: uploaderIsAgent ? agentId : typeof file.uploaderId === 'string' ? file.uploaderId : null,
        uploaderName: text(file.uploaderName),
        status: text(file.status, 'available') === 'deleted' ? 'deleted' : 'available',
        deletedByKind: typeof file.deletedByKind === 'string' ? file.deletedByKind : null,
        deletedById: typeof file.deletedById === 'string' ? rewrite(file.deletedById) : null,
        deletedByName: typeof file.deletedByName === 'string' ? file.deletedByName : null,
        deletedAt: optionalDate(file.deletedAt),
        createdAt: date(file.createdAt),
      };
      // Bytes are stored like an upload: the size limit and storage budget apply, the type is detected again.
      if (blobId && row.status === 'available' && archive.has(`files/${blobId}`)) {
        try {
          await fileStore.restore(archive.stream(`files/${blobId}`), text(file.name, 'file'), row);
        } catch (error) {
          if (error instanceof FileError)
            throw new ArchiveError(`A file of this agent cannot be stored: ${error.message}`);
          throw error;
        }
        continue;
      }
      // Without its bytes it is a tombstone (a deleted file, or a live scratch preview, which does not carry over).
      const kind = text(file.kind, 'other');
      await client.channelFile.create({
        data: {
          ...row,
          name: fileName(text(file.name, 'file')),
          mime: 'application/octet-stream',
          kind: FILE_KINDS.includes(kind) ? kind : 'other',
          size: Math.max(0, integer(file.size, 0)),
          blobId: null,
          status: 'deleted',
        },
      });
    }

    // The live context: its entries, with every old id rewritten. What it published is already in it or in the
    // history brought along, so its publication cursors start after everything here (none is recovered again).
    if (archive.has('session.json')) {
      const session = await archive.json<Row>('session.json');
      const [message, dm, group] = await Promise.all([
        client.message.aggregate({ _max: { sequence: true } }),
        client.dmMessage.aggregate({ _max: { sequence: true } }),
        client.groupMessage.aggregate({ _max: { sequence: true } }),
      ]);
      await client.agentSession.create({
        data: {
          agentId,
          sessionId: rewrite(text(session.sessionId, randomUUID())),
          header: rewrite(text(session.header)),
          entryCount: 0,
          activeStart: integer(session.activeStart, 0),
          leafId: typeof session.leafId === 'string' ? session.leafId : null,
          privateCursor: message._max.sequence ?? 0,
          dmCursor: dm._max.sequence ?? 0,
          groupCursor: group._max.sequence ?? 0,
        },
      });
      let entryCount = 0;
      for await (const batch of archive.batches<Row>('session-entries.jsonl')) {
        await client.agentSessionEntry.createMany({
          data: batch.map(entry => ({
            agentId,
            position: integer(entry.position, entryCount++),
            entryId: text(entry.entryId, randomUUID()),
            parentId: typeof entry.parentId === 'string' ? entry.parentId : null,
            payload: rewrite(text(entry.payload)),
          })),
        });
      }
      await client.agentSession.update({ where: { agentId }, data: { entryCount } });
    }

    // Memories (with their versions and provenance), timers, scratchpad, recent emojis.
    for (const memory of await archive.lines<Row & { versions?: Row[] }>('memories.jsonl'))
      await client.agentMemory.create({
        data: {
          agentId,
          name: text(memory.name, randomUUID()),
          type: text(memory.type, 'reference'),
          title: text(memory.title),
          text: text(memory.text),
          by: text(memory.by, 'agent'),
          trust: text(memory.trust, 'agent'),
          channelId: typeof memory.channelId === 'string' ? rewrite(memory.channelId) : null,
          recalls: integer(memory.recalls, 0),
          lastRecalledAt: optionalDate(memory.lastRecalledAt),
          faded: bool(memory.faded, false),
          conflict: bool(memory.conflict, false),
          deletedAt: optionalDate(memory.deletedAt),
          createdAt: date(memory.createdAt),
          versions: {
            create: (Array.isArray(memory.versions) ? memory.versions : []).map(version => ({
              title: text(version.title),
              text: text(version.text),
              type: text(version.type, 'reference'),
              changedBy: text(version.changedBy, 'agent'),
              createdAt: date(version.createdAt),
            })),
          },
        },
      });
    const timers = await archive.json<{ timers?: Row[]; pending?: Row[] }>('timers.json').catch(() => ({}) as never);
    // Within what setting a timer allows: at most 25, 30 days ahead, reminders every 10 s or more (bounded times
    // when faster than every 5 minutes).
    for (const timer of (Array.isArray(timers.timers) ? timers.timers : []).slice(0, MAX_ACTIVE_TIMERS)) {
      const reminder = timer.kind === 'reminder';
      const every = within(timer.intervalMs, 60_000, {
        minimum: MIN_REMINDER_SECONDS * 1000,
        maximum: MAX_DELAY_SECONDS * 1000,
      });
      const total = timer.total == null ? null : Math.max(1, integer(timer.total, 1));
      const nextAt = date(timer.nextAt);
      await client.agentTimer.create({
        data: {
          agentId,
          kind: reminder ? 'reminder' : 'timer',
          note: text(timer.note).slice(0, TIMER_NOTE_MAX),
          nextAt: new Date(Math.min(nextAt.getTime(), Date.now() + MAX_DELAY_SECONDS * 1000)),
          intervalMs: reminder ? every : null,
          total: !reminder
            ? 1
            : every < FAST_REMINDER_SECONDS * 1000
              ? Math.min(total ?? MAX_FAST_REMINDER_TIMES, MAX_FAST_REMINDER_TIMES)
              : total,
          fired: Math.max(0, integer(timer.fired, 0)),
          lastFiredAt: optionalDate(timer.lastFiredAt),
          human: bool(timer.human, false),
          createdAt: date(timer.createdAt),
        },
      });
    }
    for (const event of (Array.isArray(timers.pending) ? timers.pending : []).slice(0, MAX_ACTIVE_TIMERS))
      await client.pendingTimerEvent.create({
        data: {
          id: randomUUID(),
          agentId,
          kind: text(event.kind, 'timer'),
          text: text(event.text),
          human: bool(event.human, false),
          createdAt: date(event.createdAt),
        },
      });
    // The scratchpad through its own checks (paths, image types, Settings → Swarm limits).
    const scratchImageMax = swarmSettingBounds.scratchFileMaxKb.max * 1024;
    for (const row of await archive.lines<Row>('scratch.jsonl')) {
      const path = text(row.path, `imported-${randomUUID()}`);
      try {
        if (typeof row.data === 'string' && archive.has(row.data)) {
          const data = await archive.bytes(row.data, scratchImageMax);
          await scratch.writeImage(agentId, path, data, detectFile(path, data.subarray(0, 8192)).mime);
        } else await scratch.write(agentId, path, text(row.content));
      } catch (error) {
        if (error instanceof ScratchError)
          throw new ArchiveError(`Its scratchpad cannot be brought over: ${error.message}`);
        throw error;
      }
    }
    const emojis = await archive.json<Row[]>('emojis.json').catch(() => [] as Row[]);
    if (Array.isArray(emojis) && emojis.length)
      await client.agentEmojiRecent.createMany({
        data: emojis.map(row => ({ agentId, emoji: text(row.emoji), usedAt: date(row.usedAt) })),
      });

    // Discord: its channels, DM list and saved messages; the token only when the file carries one.
    if (archive.has('discord.json')) {
      const discord = await archive.json<{ bot?: Row | null; channels?: Row[]; dmAllow?: Row[]; token?: unknown }>(
        'discord.json',
      );
      if (discord.bot)
        await client.discordBot.create({
          data: {
            agentId,
            botUserId: typeof discord.bot.botUserId === 'string' ? discord.bot.botUserId : null,
            botName: typeof discord.bot.botName === 'string' ? discord.bot.botName : null,
            admission: text(discord.bot.admission, 'check'),
            catchUp: bool(discord.bot.catchUp, true),
            presenceMode: text(discord.bot.presenceMode, 'auto'),
            statusText: text(discord.bot.statusText),
          },
        });
      for (const channel of discord.channels ?? [])
        await client.discordChannel.create({
          data: {
            agentId,
            channelId: text(channel.channelId),
            guildId: typeof channel.guildId === 'string' ? channel.guildId : null,
            guildName: typeof channel.guildName === 'string' ? channel.guildName : null,
            parentId: typeof channel.parentId === 'string' ? channel.parentId : null,
            recipientId: typeof channel.recipientId === 'string' ? channel.recipientId : null,
            name: text(channel.name),
            kind: text(channel.kind, 'text'),
            allowed: bool(channel.allowed, false),
            admission: typeof channel.admission === 'string' ? channel.admission : null,
            announcedUpTo: typeof channel.announcedUpTo === 'string' ? channel.announcedUpTo : null,
            botOnlyTurns: integer(channel.botOnlyTurns, 0),
          },
        });
      for (const row of discord.dmAllow ?? [])
        await client.discordDmAllow.create({
          data: {
            agentId,
            discordUserId: text(row.discordUserId),
            name: text(row.name),
            createdAt: date(row.createdAt),
          },
        });
      const token = text(discord.token);
      if (token && DISCORD_TOKEN.test(token)) await tokens.set(agentId, token);
    }
    for await (const batch of archive.batches<Row>('discord-messages.jsonl'))
      await client.discordMessage.createMany({
        data: batch.map(row => ({
          agentId,
          id: text(row.id, randomUUID()),
          channelId: text(row.channelId),
          guildId: typeof row.guildId === 'string' ? row.guildId : null,
          authorId: text(row.authorId),
          authorName: text(row.authorName),
          authorBot: bool(row.authorBot, false),
          content: text(row.content),
          chainId: typeof row.chainId === 'string' ? row.chainId : null,
          replyToId: typeof row.replyToId === 'string' ? row.replyToId : null,
          mentionsBot: bool(row.mentionsBot, false),
          attachments: typeof row.attachments === 'string' ? row.attachments : null,
          createdAt: date(row.createdAt),
          editedAt: optionalDate(row.editedAt),
          deletedAt: optionalDate(row.deletedAt),
        })),
      });

    // Activity: its runs keep their entries, under new run ids.
    for await (const batch of archive.batches<Row>('activity.jsonl'))
      await client.activity.createMany({
        data: batch.map(row => {
          const run = fresh(row.runId);
          return {
            id: text(row.id, randomUUID())
              .replace(text(row.runId), run)
              .replace(UUID, match => ids.get(match) ?? match),
            agentId,
            runId: run,
            channelId: rewrite(text(row.channelId)),
            kind: text(row.kind, 'status'),
            label: text(row.label),
            text: rewrite(text(row.text)),
            timestamp: number(row.timestamp, Date.now()),
            revision: integer(row.revision, 1),
            // A run the export caught mid-way is not active here.
            state:
              row.state === 'active' || row.state === 'running'
                ? 'interrupted'
                : ((row.state as string | null) ?? null),
          };
        }),
      });

    // Links: by id where they exist here, in the same organization; the rest stay unresolved.
    const unresolved: Unresolved = { computers: [], dmPeers: [], groups: [] };
    for (const computer of links.computers ?? []) {
      const here = await client.computer.findUnique({
        where: { id: text(computer.id) },
        select: { organizationId: true },
      });
      if (here?.organizationId === organizationId)
        await client.computerAssignment.create({ data: { agentId, computerId: text(computer.id) } });
      else unresolved.computers.push({ id: text(computer.id), name: text(computer.name) });
    }
    for (const peer of links.dmPeers ?? []) {
      const here = await client.agent.findUnique({ where: { id: text(peer.id) }, select: { organizationId: true } });
      if (here?.organizationId === organizationId) {
        if (peer.sends) await client.dmGrant.create({ data: { senderId: agentId, recipientId: text(peer.id) } });
        if (peer.receives) await client.dmGrant.create({ data: { senderId: text(peer.id), recipientId: agentId } });
      } else
        unresolved.dmPeers.push({
          id: text(peer.id),
          name: text(peer.name),
          sends: !!peer.sends,
          receives: !!peer.receives,
        });
    }
    for (const group of links.groups ?? []) {
      const here = await client.groupChat.findUnique({
        where: { id: text(group.id) },
        select: { organizationId: true },
      });
      if (here?.organizationId === organizationId)
        await client.groupMember.create({ data: { groupId: text(group.id), agentId } });
      else unresolved.groups.push({ id: text(group.id), name: text(group.name) });
    }
    skipped.links = unresolved.computers.length + unresolved.dmPeers.length + unresolved.groups.length;
    await client.agent.update({ where: { id: agentId }, data: { unresolved: JSON.stringify(unresolved) } });
  } catch (error) {
    // Nothing half-imported is left behind (everything above cascades from the agent, but its files).
    await fileStore
      .deleteForAgent(
        agentId,
        channels.map(channel => channel.id),
      )
      .catch(() => {});
    await client.agent.delete({ where: { id: agentId } }).catch(() => {});
    await client.dmChain.deleteMany({ where: { id: { in: [...chains.values()] } } }).catch(() => {});
    await tokens.remove(agentId).catch(() => {});
    throw error;
  }
  return { agentId, skipped };
}
