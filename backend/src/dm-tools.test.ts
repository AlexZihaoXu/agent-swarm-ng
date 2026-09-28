import { expect, it, vi } from 'vitest';
import { createDmTools } from './dm-tools';
import type { SwarmStore } from './swarm-store';

it('binds reads and contact discovery to the granted identity and keeps send metadata server-owned', async () => {
  const row = {
    id: 'message',
    sequence: 4,
    senderId: 'a',
    sender: { name: 'A' },
    createdAt: new Date('2026-09-23T00:00:00Z'),
    status: 'completed',
    text: 'x'.repeat(7000),
    replyTo: { id: 'parent', senderId: 'b', sender: { name: 'B' }, text: 'A previous message' },
  };
  const store = {
    received: vi.fn(async () => ({ messages: [row], nextCursor: null })),
    contacts: vi.fn(async () => [{ id: 'b', name: 'B' }]),
    history: vi.fn(async () => ({ messages: [row], nextCursor: null })),
    message: vi.fn(async () => row),
  };
  const send = vi.fn(async () => ({ id: 'sent', conversationId: 'dm:a:b', status: 'queued', duplicate: false }));
  const tools = createDmTools(store as unknown as SwarmStore, 'a', send);
  const call = (name: string, args: object, signal?: AbortSignal) =>
    tools.find(tool => tool.name === name)!.execute('call-id', args as never, signal, undefined, undefined as never);
  await call('list_dm_contacts', {});
  expect(store.contacts).toHaveBeenCalledWith('a');
  await call('read_dm_inbox', { agentId: 'spoofed' });
  expect(store.received).toHaveBeenCalledWith('a', undefined);
  await call('send_dm', { senderId: 'spoofed', chainId: 'spoofed', recipientId: 'b', text: 'Hello' });
  expect(send).toHaveBeenCalledWith('b', 'Hello', 'call-id', undefined);
  await call('send_dm', { recipientId: 'b', text: 'Follow-up', replyToMessageId: 'parent' });
  expect(send).toHaveBeenCalledWith('b', 'Follow-up', 'call-id', 'parent');
  const section = await call('read_dm_messages', { agentId: 'spoofed', peerId: 'b' });
  expect(store.history).toHaveBeenCalledWith('a', 'b', undefined, undefined);
  const result = JSON.parse((section.content[0] as { text: string }).text);
  expect(result.messages[0].text).toHaveLength(1000);
  expect(result.messages[0].truncated).toBe(true);
  expect(result.messages[0].replyTo).toMatchObject({ id: 'parent', senderName: 'B', text: 'A previous message' });
  const fragment = await call('read_dm_messages', { peerId: 'b', messageId: 'message', offset: 1000 });
  expect(store.message).toHaveBeenCalledWith('a', 'b', 'message');
  expect(JSON.parse((fragment.content[0] as { text: string }).text).messages[0].text).toHaveLength(6000);
  await expect(call('read_dm_messages', { peerId: 'b', offset: 0 })).rejects.toThrow('fragment');
  const controller = new AbortController();
  controller.abort();
  await expect(call('send_dm', { recipientId: 'b', text: 'No send' }, controller.signal)).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(2);
});
