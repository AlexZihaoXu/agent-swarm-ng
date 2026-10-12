import { randomUUID } from 'node:crypto';
import type { PlatformStore } from './platform-store';
import type { BlobStore } from './files/blob-store';
import { DISCORD_TOKEN, type DiscordTokenStore } from './discord/token-store';
import { ArchiveError, type OpenedArchive } from './agent-archive';
import { AGENT_FILE_FORMAT, AGENT_FILE_VERSION, type ExportIncludes } from './agent-export';
import { dmConversationId } from './swarm-store';

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
  blobs: BlobStore,
  tokens: DiscordTokenStore,
  archive: OpenedArchive,
  organizationId: string,
) {
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
      avatar: typeof settings.avatar === 'string' ? settings.avatar : null,
      endpointId: text(settings.endpointId),
      model: text(settings.model),
      thinkingLevel: (LEVELS.includes(thinking) ? thinking : 'off') as never,
      modelChain: text(settings.modelChain, '{}'),
      compactAtPercent: integer(settings.compactAtPercent, 65),
      idleCompactMinutes: integer(settings.idleCompactMinutes, 30),
      idleCompactPercent: integer(settings.idleCompactPercent, 50),
      instructions: text(settings.instructions),
      heartbeatEnabled: bool(settings.heartbeatEnabled, false),
      heartbeatMinutes: integer(settings.heartbeatMinutes, 30),
      heartbeatFrom: text(settings.heartbeatFrom),
      heartbeatTo: text(settings.heartbeatTo),
      heartbeatChecklist: text(settings.heartbeatChecklist),
      todos: text(settings.todos, '[]'),
      timeNoteMinutes: integer(settings.timeNoteMinutes, 15),
      memoryIndex: text(settings.memoryIndex),
      sleepFrom: text(settings.sleepFrom, '03:00'),
      sleepTo: text(settings.sleepTo, '05:00'),
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

    // Agent-to-agent DMs, where the other agent exists here.
    const dms = await archive.lines<Row>('dm-messages.jsonl');
    const peerIds = new Set(dms.map(dm => text(dm.senderId === oldAgentId ? dm.recipientId : dm.senderId)));
    const present = new Set(
      (await client.agent.findMany({ where: { id: { in: [...peerIds] } }, select: { id: true } })).map(row => row.id),
    );
    const keptDms = dms.filter(dm => present.has(text(dm.senderId === oldAgentId ? dm.recipientId : dm.senderId)));
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
            status: 'delivered',
            createdAt: date(dm.createdAt),
          };
        }),
      }),
    );

    // Files of the chats brought along: bytes first (by content hash), then their rows.
    const keyOf = (old: string) => {
      if (old.startsWith('chat:')) return `chat:${ids.get(old.slice(5)) ?? channels[0]!.id}`;
      if (old.startsWith('dm:')) {
        const [a, b] = old.slice(3).split(':');
        const pair = [a === oldAgentId ? agentId : a, b === oldAgentId ? agentId : b];
        return present.has(pair[0] === agentId ? pair[1]! : pair[0]!) ? dmConversationId(pair[0]!, pair[1]!) : null;
      }
      return null;
    };
    for (const file of files) {
      const key = keyOf(text(file.channelKey));
      const blobId = text(file.blobId);
      let blob: string | null = null;
      if (blobId && archive.has(`files/${blobId}`)) {
        const stored = await blobs.put(archive.stream(`files/${blobId}`), Number.MAX_SAFE_INTEGER);
        if (stored.id === blobId) {
          blob = stored.id;
          await client.fileBlob.upsert({
            where: { id: blob },
            create: { id: blob, size: stored.size },
            update: {},
          });
        }
      }
      if (!key) continue;
      const uploaderIsAgent = file.uploaderId === oldAgentId;
      await client.channelFile.create({
        data: {
          id: ids.get(text(file.id))!,
          channelKey: key,
          messageKind: typeof file.messageKind === 'string' ? file.messageKind : null,
          messageId: ids.get(text(file.messageId)) ?? null,
          uploaderKind: text(file.uploaderKind, 'human'),
          uploaderId: uploaderIsAgent ? agentId : typeof file.uploaderId === 'string' ? file.uploaderId : null,
          uploaderName: text(file.uploaderName),
          name: text(file.name, 'file'),
          mime: text(file.mime, 'application/octet-stream'),
          kind: text(file.kind, 'other'),
          size: integer(file.size, 0),
          blobId: blob,
          status: blob ? text(file.status, 'available') : 'deleted',
          deletedByKind: typeof file.deletedByKind === 'string' ? file.deletedByKind : null,
          deletedById: typeof file.deletedById === 'string' ? rewrite(file.deletedById) : null,
          deletedByName: typeof file.deletedByName === 'string' ? file.deletedByName : null,
          deletedAt: optionalDate(file.deletedAt),
          scratchAgentId: file.scratchAgentId === oldAgentId ? agentId : null,
          scratchPath: typeof file.scratchPath === 'string' ? file.scratchPath : null,
          createdAt: date(file.createdAt),
        },
      });
    }

    // The live context: its entries, with every old id rewritten.
    if (archive.has('session.json')) {
      const session = await archive.json<Row>('session.json');
      const entries = await archive.lines<Row>('session-entries.jsonl');
      await client.agentSession.create({
        data: {
          agentId,
          sessionId: rewrite(text(session.sessionId, randomUUID())),
          header: rewrite(text(session.header)),
          entryCount: entries.length,
          activeStart: integer(session.activeStart, 0),
          leafId: typeof session.leafId === 'string' ? session.leafId : null,
          privateCursor: integer(session.privateCursor, 0),
          dmCursor: integer(session.dmCursor, 0),
          groupCursor: integer(session.groupCursor, 0),
        },
      });
      await insert(entries, batch =>
        client.agentSessionEntry.createMany({
          data: batch.map((entry, index) => ({
            agentId,
            position: integer(entry.position, index),
            entryId: text(entry.entryId, randomUUID()),
            parentId: typeof entry.parentId === 'string' ? entry.parentId : null,
            payload: rewrite(text(entry.payload)),
          })),
        }),
      );
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
    for (const timer of timers.timers ?? [])
      await client.agentTimer.create({
        data: {
          agentId,
          kind: text(timer.kind, 'timer'),
          note: text(timer.note),
          nextAt: date(timer.nextAt),
          intervalMs: timer.intervalMs == null ? null : integer(timer.intervalMs, 60_000),
          total: timer.total == null ? null : integer(timer.total, 1),
          fired: integer(timer.fired, 0),
          lastFiredAt: optionalDate(timer.lastFiredAt),
          human: bool(timer.human, false),
          createdAt: date(timer.createdAt),
        },
      });
    for (const event of timers.pending ?? [])
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
    for (const row of await archive.lines<Row>('scratch.jsonl')) {
      const data = typeof row.data === 'string' && archive.has(row.data) ? await archive.bytes(row.data) : null;
      await client.scratchFile.create({
        data: {
          agentId,
          path: text(row.path, `imported-${randomUUID()}`),
          content: text(row.content),
          data,
          mime: typeof row.mime === 'string' ? row.mime : null,
          size: integer(row.size, data?.byteLength ?? 0),
          createdAt: date(row.createdAt),
        },
      });
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
    const discordMessages = await archive.lines<Row>('discord-messages.jsonl');
    await insert(discordMessages, batch =>
      client.discordMessage.createMany({
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
      }),
    );

    // Activity: its runs keep their entries, under new run ids.
    const activity = await archive.lines<Row>('activity.jsonl');
    await insert(activity, batch =>
      client.activity.createMany({
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
      }),
    );

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
    // Nothing half-imported is left behind (everything above cascades from the agent).
    await client.agent.delete({ where: { id: agentId } }).catch(() => {});
    await client.dmChain.deleteMany({ where: { id: { in: [...chains.values()] } } }).catch(() => {});
    await tokens.remove(agentId).catch(() => {});
    throw error;
  }
  return { agentId, skipped };
}
