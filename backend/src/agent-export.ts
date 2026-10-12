import type { PlatformStore } from './platform-store';
import type { BlobStore } from './files/blob-store';
import type { DiscordTokenStore } from './discord/token-store';
import { jsonPart, writeTar, type ArchivePart } from './agent-archive';

/** What an agent file may carry besides its settings (docs/agent-export.md); the export dialog's switches. */
export type ExportIncludes = {
  /** Its live (saved) conversation context. */
  context: boolean;
  memories: boolean;
  scratchpad: boolean;
  /** Its private chat with its owner: messages, reactions and files. */
  chat: boolean;
  /** Its agent-to-agent DMs and their files. */
  dms: boolean;
  /** Its Discord channels, DM list and the messages its bot saw (not the token). */
  discord: boolean;
  activity: boolean;
  /** The Discord bot token: a secret, off unless chosen. */
  discordToken: boolean;
};
export const DEFAULT_INCLUDES: ExportIncludes = {
  context: true,
  memories: true,
  scratchpad: true,
  chat: true,
  dms: true,
  discord: true,
  activity: true,
  discordToken: false,
};
export const AGENT_FILE_FORMAT = 'swarm-agent';
export const AGENT_FILE_VERSION = 1;

/** The agent's settings as saved, every column a user or the agent can change (the agent's id is not carried). */
const SETTINGS = [
  'name',
  'avatar',
  'endpointId',
  'model',
  'thinkingLevel',
  'modelChain',
  'compactAtPercent',
  'idleCompactMinutes',
  'idleCompactPercent',
  'instructions',
  'heartbeatEnabled',
  'heartbeatMinutes',
  'heartbeatFrom',
  'heartbeatTo',
  'heartbeatChecklist',
  'todos',
  'timeNoteMinutes',
  'memoryIndex',
  'sleepFrom',
  'sleepTo',
  'sleptAt',
  'sleptPosition',
  'sleepNote',
  'sleepNoteTold',
  'createdAt',
] as const;

/**
 * An agent as one file: a stream of a gzip-able tar (agent-archive.ts) with everything inside the agent by default.
 * The caller gzips and sends it. Secrets are carried only when `includes.discordToken` (the only agent-owned one).
 */
export async function exportAgent(
  database: PlatformStore,
  blobs: BlobStore,
  tokens: DiscordTokenStore,
  agentId: string,
  includes: ExportIncludes,
) {
  const client = database.client;
  const agent = await client.agent.findUnique({
    where: { id: agentId },
    include: { organization: { select: { id: true, name: true } }, channels: true },
  });
  if (!agent) return null;
  const settings = Object.fromEntries(SETTINGS.map(key => [key, agent[key]]));
  const channelIds = agent.channels.map(channel => channel.id);
  const [assignments, grantsOut, grantsIn, memberships, timers, pending, emojis] = await Promise.all([
    client.computerAssignment.findMany({ where: { agentId }, include: { computer: { select: { name: true } } } }),
    client.dmGrant.findMany({ where: { senderId: agentId }, include: { recipient: { select: { name: true } } } }),
    client.dmGrant.findMany({ where: { recipientId: agentId }, include: { sender: { select: { name: true } } } }),
    client.groupMember.findMany({ where: { agentId }, include: { group: { select: { name: true } } } }),
    client.agentTimer.findMany({ where: { agentId } }),
    client.pendingTimerEvent.findMany({ where: { agentId } }),
    client.agentEmojiRecent.findMany({ where: { agentId } }),
  ]);
  const peers = new Map<string, { id: string; name: string; sends: boolean; receives: boolean }>();
  for (const grant of grantsOut)
    peers.set(grant.recipientId, { id: grant.recipientId, name: grant.recipient.name, sends: true, receives: false });
  for (const grant of grantsIn) {
    const peer = peers.get(grant.senderId) ?? {
      id: grant.senderId,
      name: grant.sender.name,
      sends: false,
      receives: false,
    };
    peer.receives = true;
    peers.set(grant.senderId, peer);
  }
  const parts: ArchivePart[] = [
    jsonPart('manifest.json', {
      format: AGENT_FILE_FORMAT,
      version: AGENT_FILE_VERSION,
      exportedAt: new Date().toISOString(),
      app: process.env.APP_VERSION ?? 'dev',
      agent: { id: agent.id, name: agent.name },
      includes,
    }),
    jsonPart('agent.json', {
      settings,
      organization: agent.organization,
      channels: agent.channels.map(channel => ({ id: channel.id, kind: channel.kind })),
    }),
    // Links to things outside the agent: restored by id where they exist, otherwise kept as unresolved.
    jsonPart('links.json', {
      computers: assignments.map(row => ({ id: row.computerId, name: row.computer.name })),
      dmPeers: [...peers.values()],
      groups: memberships.map(row => ({ id: row.groupId, name: row.group.name })),
    }),
    jsonPart('timers.json', { timers, pending }),
    jsonPart('emojis.json', emojis),
  ];
  if (includes.context) {
    const session = await client.agentSession.findUnique({ where: { agentId } });
    if (session) {
      parts.push(jsonPart('session.json', session));
      parts.push(
        jsonPart(
          'session-entries.jsonl',
          await client.agentSessionEntry.findMany({ where: { agentId }, orderBy: { position: 'asc' } }),
          true,
        ),
      );
    }
  }
  if (includes.memories)
    parts.push(
      jsonPart(
        'memories.jsonl',
        await client.agentMemory.findMany({ where: { agentId }, include: { versions: true } }),
        true,
      ),
    );
  if (includes.scratchpad) {
    const scratch = await client.scratchFile.findMany({ where: { agentId } });
    parts.push(
      jsonPart(
        'scratch.jsonl',
        scratch.map(({ data, ...row }, index) => ({ ...row, data: data ? `scratch/${index}` : null })),
        true,
      ),
    );
    scratch.forEach((row, index) => {
      if (row.data) parts.push({ name: `scratch/${index}`, size: row.data.byteLength, body: row.data });
    });
  }
  const fileKeys: string[] = [];
  if (includes.chat) {
    const messages = await client.message.findMany({
      where: { channelId: { in: channelIds } },
      orderBy: { sequence: 'asc' },
    });
    parts.push(
      jsonPart(
        'messages.jsonl',
        messages.map(({ sequence: _, ...row }) => row),
        true,
      ),
    );
    parts.push(
      jsonPart(
        'reactions.jsonl',
        await client.messageReaction.findMany({ where: { messageId: { in: messages.map(message => message.id) } } }),
        true,
      ),
    );
    fileKeys.push(...channelIds.map(id => `chat:${id}`));
  }
  if (includes.dms) {
    const dms = await client.dmMessage.findMany({
      where: { OR: [{ senderId: agentId }, { recipientId: agentId }] },
      include: { sender: { select: { name: true } }, recipient: { select: { name: true } } },
      orderBy: { sequence: 'asc' },
    });
    parts.push(
      jsonPart(
        'dm-messages.jsonl',
        dms.map(({ sequence: _, ...row }) => row),
        true,
      ),
    );
    fileKeys.push(...new Set(dms.map(dm => dm.conversationId)));
  }
  if (fileKeys.length) {
    const files = await client.channelFile.findMany({
      where: { channelKey: { in: fileKeys } },
      include: { blob: true },
    });
    parts.push(
      jsonPart(
        'files.jsonl',
        files.map(({ blob: _, ...row }) => row),
        true,
      ),
    );
    const seen = new Set<string>();
    for (const file of files)
      if (file.blob && !seen.has(file.blob.id) && (await blobs.exists(file.blob.id))) {
        seen.add(file.blob.id);
        parts.push({ name: `files/${file.blob.id}`, size: file.blob.size, body: blobs.stream(file.blob.id) });
      }
  }
  if (includes.discord) {
    const [bot, channels, dmAllow, messages] = await Promise.all([
      client.discordBot.findUnique({ where: { agentId } }),
      client.discordChannel.findMany({ where: { agentId } }),
      client.discordDmAllow.findMany({ where: { agentId } }),
      client.discordMessage.findMany({ where: { agentId }, orderBy: { createdAt: 'asc' } }),
    ]);
    const token = includes.discordToken ? await tokens.get(agentId) : undefined;
    parts.push(jsonPart('discord.json', { bot, channels, dmAllow, ...(token ? { token } : {}) }));
    parts.push(jsonPart('discord-messages.jsonl', messages, true));
  } else if (includes.discordToken) {
    const token = await tokens.get(agentId);
    if (token) parts.push(jsonPart('discord.json', { bot: null, channels: [], dmAllow: [], token }));
  }
  if (includes.activity)
    parts.push(
      jsonPart(
        'activity.jsonl',
        (await client.activity.findMany({ where: { agentId }, orderBy: { sequence: 'asc' } })).map(
          ({ sequence: _, ...row }) => row,
        ),
        true,
      ),
    );
  return { name: agent.name, tar: writeTar(parts) };
}
