import { expect, it, vi } from 'vitest';
import { createReactionTools } from './reaction-tools';
import type { ReactionStore } from './reaction-store';

it('binds reaction identity and checks private-human publication authority on every call', async () => {
  const store = { set: vi.fn(async () => []), read: vi.fn(async () => ({ message: [] })) }, changed = vi.fn();
  let human = false;
  const tools = createReactionTools(store as unknown as ReactionStore, { id: 'private', agentId: 'a', kind: 'platform-chat' }, () => human, changed);
  const call = (name: string, args: object, signal?: AbortSignal) => tools.find(tool => tool.name === name)!.execute('call', args as never, signal, undefined, undefined as never);
  await expect(call('react_to_message', { channelId: 'private', messageId: 'message', emoji: '👍', active: true })).rejects.toThrow('not granted');
  human = true;
  await call('react_to_message', { agentId: 'spoofed', channelId: 'private', messageId: 'message', emoji: '👍', active: true });
  expect(store.set).toHaveBeenCalledWith('private', 'message', '👍', true, 'a');
  expect(changed).toHaveBeenCalledWith('private', 'message');
  await call('read_reactions', { channelId: 'group:g', messageId: 'message' });
  expect(store.read).toHaveBeenCalledWith('group:g', ['message'], 'a');
  const controller = new AbortController(); controller.abort();
  await expect(call('react_to_message', { channelId: 'group:g', messageId: 'message', emoji: '👍', active: true }, controller.signal)).rejects.toThrow();
  expect(store.set).toHaveBeenCalledTimes(1);
});
