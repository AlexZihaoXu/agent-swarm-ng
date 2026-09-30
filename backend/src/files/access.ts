import type { PlatformStore } from '../platform-store';
import { DiscordStore } from '../discord/store';

/** Who is acting on a channel's files: the human operator, or one agent. */
export type Actor = { kind: 'human' } | { kind: 'agent'; id: string };
export type ChannelAccess = {
  /** The channel exists; what it is, for display. */
  exists: boolean;
  view: boolean;
  post: boolean;
  /** May delete any file here (the human); agents may delete only files they uploaded. */
  deleteAny: boolean;
};
const none: ChannelAccess = { exists: false, view: false, post: false, deleteAny: false };

export type ChannelKey =
  | { kind: 'chat'; channelId: string }
  | { kind: 'dm'; a: string; b: string }
  | { kind: 'group'; groupId: string }
  | { kind: 'discord'; channelId: string };

/** `chat:<channelId>`, `dm:<agentA>:<agentB>` (sorted, as DM conversations are named) or `group:<groupId>`. */
export function parseChannelKey(key: string): ChannelKey | null {
  const [kind, ...rest] = String(key).split(':');
  if (kind === 'chat' && rest.length === 1 && rest[0]) return { kind: 'chat', channelId: rest[0] };
  if (kind === 'group' && rest.length === 1 && rest[0]) return { kind: 'group', groupId: rest[0] };
  if (kind === 'discord' && rest.length === 1 && /^\d{15,21}$/.test(rest[0]))
    return { kind: 'discord', channelId: rest[0] };
  if (kind === 'dm' && rest.length === 2 && rest[0] && rest[1] && rest[0] < rest[1])
    return { kind: 'dm', a: rest[0], b: rest[1] };
  return null;
}
export const chatKey = (channelId: string) => `chat:${channelId}`;
export const groupKey = (groupId: string) => `group:${groupId}`;
export const dmKey = (a: string, b: string) => `dm:${[a, b].sort().join(':')}`;

/**
 * What an actor may do with a channel's files: exactly who can read and post there already. The human sees
 * every channel and may delete any file; agents follow their channel grants (private chat owner, DM
 * participants with a live connection to post, group members). New app channels (Discord…) add a case here.
 */
export async function channelAccess(database: PlatformStore, key: string, actor: Actor): Promise<ChannelAccess> {
  const parsed = parseChannelKey(key);
  if (!parsed) return none;
  await database.initialize();
  const human = actor.kind === 'human';
  if (parsed.kind === 'chat') {
    const channel = await database.client.channel.findUnique({ where: { id: parsed.channelId } });
    if (!channel) return none;
    const owner = !human && actor.id === channel.agentId;
    return { exists: true, view: human || owner, post: human || owner, deleteAny: human };
  }
  if (parsed.kind === 'group') {
    const group = await database.client.groupChat.findUnique({ where: { id: parsed.groupId } });
    if (!group) return none;
    const member =
      !human &&
      Boolean(
        await database.client.groupMember.findUnique({
          where: { groupId_agentId: { groupId: parsed.groupId, agentId: actor.id } },
        }),
      );
    return { exists: true, view: human || member, post: human || member, deleteAny: human };
  }
  if (parsed.kind === 'discord') {
    // A Discord channel: agents that may use it (DiscordStore.usable) may use
    // its files; the human looks and deletes, but posts in Discord through the agents, not the dashboard.
    const rows = await database.client.discordChannel.findMany({ where: { channelId: parsed.channelId } });
    if (!rows.length) return none;
    if (human) return { exists: true, view: true, post: false, deleteAny: true };
    const allowed = Boolean(await new DiscordStore(database).usable(actor.id, parsed.channelId));
    return { exists: true, view: allowed, post: allowed, deleteAny: false };
  }
  // An agent-to-agent DM: the human can look (and delete) but never posts as either agent.
  const participant = !human && (actor.id === parsed.a || actor.id === parsed.b);
  if (human) {
    const agents = await database.client.agent.count({ where: { id: { in: [parsed.a, parsed.b] } } });
    return agents === 2 ? { exists: true, view: true, post: false, deleteAny: true } : none;
  }
  if (!participant) return { ...none, exists: true };
  const peer = actor.id === parsed.a ? parsed.b : parsed.a;
  const connected = Boolean(
    await database.client.dmGrant.findUnique({
      where: { senderId_recipientId: { senderId: actor.id, recipientId: peer } },
    }),
  );
  return { exists: true, view: true, post: connected, deleteAny: false };
}
