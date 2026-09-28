import { expect, it, vi } from 'vitest';
import { createGroupTools } from './group-tools';
import type { GroupStore } from './group-store';
import type { SwarmStore } from './swarm-store';
import { CHAT_AUDIENCE_GUIDANCE } from './chat-audience';

it('binds discovery and bounded group history to the executing agent, not caller-supplied identity', async () => {
  const row = {
    id: 'message',
    sequence: 2,
    role: 'assistant',
    authorId: 'b',
    authorName: 'B',
    createdAt: new Date(),
    text: 'x'.repeat(9000),
    replyTo: { id: 'parent', role: 'user', authorId: null, authorName: 'You', text: 'Prior group message' },
  };
  const groups = {
    list: vi.fn(async () => ({
      groups: [{ id: 'g', name: 'Team', members: [{ agent: { id: 'a', name: 'A' } }] }],
      nextCursor: null,
    })),
    history: vi.fn(async () => ({ messages: [row], nextCursor: null })),
    message: vi.fn(async () => row),
    search: vi.fn(async () => ({ messages: [row], nextCursor: null })),
  };
  const swarm = {
    contacts: vi.fn(async () => []),
    dmPeers: vi.fn(async () => ({ peers: [{ id: 'b', name: 'B' }], nextCursor: null })),
  };
  const tools = createGroupTools(groups as unknown as GroupStore, swarm as unknown as SwarmStore, {
    id: 'private-a',
    agentId: 'a',
    kind: 'platform-chat',
  });
  const call = async (name: string, args: object, signal?: AbortSignal) => {
    const result = await tools
      .find(tool => tool.name === name)!
      .execute('call', args as never, signal, undefined, undefined as never);
    return JSON.parse((result.content[0] as { text: string }).text);
  };
  const chats = await call('list_chats', { agentId: 'spoofed' });
  expect(groups.list).toHaveBeenCalledWith('a', undefined, 10);
  expect(chats.human.channelId).toBe('private-a');
  expect(chats.dmConversations[0].canSend).toBe(false);
  expect(chats.groups[0].channelId).toBe('group:g');
  const groupMessages = (await call('read_group_messages', { channelId: 'group:g', agentId: 'spoofed' })).messages;
  expect(groupMessages[0].text).toHaveLength(1000);
  expect(groupMessages[0].replyTo).toMatchObject({ id: 'parent', authorName: 'You', text: 'Prior group message' });
  expect(groups.history).toHaveBeenCalledWith('g', 'a', undefined, undefined);
  expect(
    (await call('read_group_messages', { channelId: 'group:g', messageId: 'message', offset: 1000 })).messages[0].text,
  ).toHaveLength(6000);
  expect(groups.message).toHaveBeenCalledWith('g', 'message', 'a');
  row.text = 'x'.repeat(7000) + 'needle';
  const found = await call('search_group_messages', { channelId: 'group:g', query: 'needle' });
  expect(found.matches[0].snippet.text).toContain('needle');
  expect(found.matches[0].matchOffset).toBe(7000);
  expect(groups.search).toHaveBeenCalledWith('g', 'a', 'needle', undefined, undefined);
  await expect(call('read_group_messages', { channelId: 'private-b' })).rejects.toThrow('group channelId');
  await expect(call('read_group_messages', { channelId: 'group:g', offset: 2 })).rejects.toThrow('fragment');
  const stopped = new AbortController();
  stopped.abort();
  await expect(call('list_chats', {}, stopped.signal)).rejects.toThrow();
  expect(groups.list).toHaveBeenCalledTimes(1);
});

it('guides audience choice without claiming permission or exposing deliberation', () => {
  expect(CHAT_AUDIENCE_GUIDANCE).toContain('shared context');
  expect(CHAT_AUDIENCE_GUIDANCE).toContain('focused assignment');
  expect(CHAT_AUDIENCE_GUIDANCE).toContain('Group membership does not grant');
  expect(CHAT_AUDIENCE_GUIDANCE).toContain('thinking internal');
});
