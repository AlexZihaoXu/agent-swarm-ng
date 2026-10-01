import { defineTool } from '@earendil-works/pi-coding-agent';
import { classify, type AgentTool } from './tool-access';
import { Type } from '@earendil-works/pi-ai';
import type { GroupStore } from './group-store';
import { dmConversationId, type SwarmStore } from './swarm-store';
import type { Channel } from './chat-runtime';
import { messageText, messageMatch } from './message-text';
import { groupReply } from './reply-preview';
import type { FileStore } from './files/store';

const result = (data: object) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }], details: {} });
function groupId(channelId: string) {
  if (!channelId.startsWith('group:') || channelId.length <= 6 || channelId.length > 120)
    throw new Error('Use a group channelId returned by list_chats.');
  return channelId.slice(6);
}
type Row = Awaited<ReturnType<GroupStore['message']>>;
const metadata = (row: Row) => ({
  id: row.id,
  sequence: row.sequence,
  author: {
    kind: row.role === 'user' ? 'human' : 'agent',
    id: row.authorId,
    name: row.role === 'user' ? 'Human' : row.authorName,
  },
  timestamp: row.createdAt.toISOString(),
  replyTo: groupReply(row),
});
const view = (row: Row, offset = 0, length = 1000) => ({ ...metadata(row), ...messageText(row.text, offset, length) });

export function createGroupTools(
  groups: GroupStore,
  swarm: SwarmStore,
  channel: Channel,
  canPublishHuman = () => true,
  files?: FileStore,
) {
  const agentId = channel.agentId;
  const withFiles = async <T extends { id: string }>(items: T[]) => (await files?.annotate('group', items)) ?? items;
  return classify({ list_chats: 'r', read_group_messages: 'r', search_group_messages: 'r' }, [
    defineTool({
      name: 'list_chats',
      label: 'Discover accessible chats',
      description:
        'Discover your private human chat, allowed DM contacts, existing own DM conversations (including read-only revoked connections), and groups you currently belong to with their audiences. Group membership does not enable DMs. Use the indicated history tools; only explicit publication tools send messages. Group and DM-history pages have independent cursors. Choose an appropriate shared group for collaborative work; use DMs for focused assignments.',
      parameters: Type.Object(
        {
          groupAfter: Type.Optional(Type.Integer({ minimum: 1 })),
          dmAfter: Type.Optional(Type.Integer({ minimum: 1 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
        },
        { additionalProperties: false },
      ),
      async execute(_id, { groupAfter, dmAfter, limit = 10 }, signal) {
        signal?.throwIfAborted();
        const [contacts, peers, page] = await Promise.all([
          swarm.contacts(agentId),
          swarm.dmPeers(agentId, dmAfter, limit),
          groups.list(agentId, groupAfter, limit),
        ]);
        const allowed = new Set(contacts.map(contact => contact.id));
        signal?.throwIfAborted();
        return result({
          human: {
            channelId: channel.id,
            audience: 'Human operator and you only',
            canSend: canPublishHuman(),
            sendPolicy:
              'Requires a human-authored input in the current batch; group replies belong in their explicit group channel by default.',
            readTool: 'read_messages',
            searchTool: 'search_messages',
            sendTool: 'send_message',
          },
          dmContacts: contacts.map(contact => ({
            ...contact,
            channelId: dmConversationId(agentId, contact.id),
            sendTool: 'send_dm',
          })),
          dmConversations: peers.peers.map(peer => ({
            peerId: peer.id,
            name: peer.name,
            channelId: dmConversationId(agentId, peer.id),
            canSend: allowed.has(peer.id),
            readTool: 'read_dm_messages',
          })),
          dmNextCursor: peers.nextCursor,
          groups: page.groups.map(group => ({
            channelId: `group:${group.id}`,
            name: group.name,
            audience: {
              human: true,
              agents: group.members.map(member => ({ id: member.agent.id, name: member.agent.name })),
            },
            readTool: 'read_group_messages',
            searchTool: 'search_group_messages',
            sendTool: 'send_message',
          })),
          groupNextCursor: page.nextCursor,
        });
      },
    }),
    defineTool({
      name: 'read_group_messages',
      label: 'Read group chat',
      description:
        'Read a group you currently belong to. Returns the latest 20 messages, oldest first; maximum 40, exclusive before cursor for older history. Previews are at most 1000 characters each and 20000 total. Expand with messageId and nextOffset as offset (up to 6000 characters). Reading does not mark messages read or trigger work. Membership is rechecked for every call, independently of DM grants.',
      parameters: Type.Object(
        {
          channelId: Type.String({ minLength: 7, maxLength: 120 }),
          before: Type.Optional(Type.Integer({ minimum: 1 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 40 })),
          messageId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
          offset: Type.Optional(Type.Integer({ minimum: 0 })),
        },
        { additionalProperties: false },
      ),
      async execute(_id, { channelId, before, limit, messageId, offset }, signal) {
        signal?.throwIfAborted();
        if ((offset !== undefined && !messageId) || (messageId && (before !== undefined || limit !== undefined)))
          throw new Error('Choose a message fragment or history window, not both.');
        const id = groupId(channelId);
        const page = messageId
          ? { messages: [await groups.message(id, messageId, agentId)], nextCursor: null }
          : await groups.history(id, agentId, before, limit);
        const length = messageId ? 6000 : Math.min(1000, Math.floor(20000 / Math.max(1, page.messages.length)));
        signal?.throwIfAborted();
        return result({
          channelId,
          order: 'oldest-first',
          messages: await withFiles(page.messages.map(row => view(row, offset ?? 0, length))),
          nextCursor: page.nextCursor,
        });
      },
    }),
    defineTool({
      name: 'search_group_messages',
      label: 'Search group chat',
      description:
        'Search a current member group for a literal phrase (ASCII case-insensitive), newest matches first, up to 20 match-centered 320-character snippets. Use nextCursor as before to page and read_group_messages to expand a hit. Never searches private human chats or other groups.',
      parameters: Type.Object(
        {
          channelId: Type.String({ minLength: 7, maxLength: 120 }),
          query: Type.String({ minLength: 1, maxLength: 200 }),
          before: Type.Optional(Type.Integer({ minimum: 1 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
        },
        { additionalProperties: false },
      ),
      async execute(_id, { channelId, query, before, limit }, signal) {
        signal?.throwIfAborted();
        const page = await groups.search(groupId(channelId), agentId, query, before, limit);
        signal?.throwIfAborted();
        return result({
          channelId,
          order: 'newest-first',
          matches: await withFiles(page.messages.map(row => ({ ...metadata(row), ...messageMatch(row.text, query) }))),
          nextCursor: page.nextCursor,
        });
      },
    }),
  ]);
}
