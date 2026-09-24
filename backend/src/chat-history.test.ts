import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from './test-database';
import { createChatHistoryTools } from './chat-history-tools';

async function fixture() {
  const store = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const config = { name: 'Archivist', endpointId: 'test', model: 'test', thinkingLevel: 'off' as const };
  const agent = await store.createAgent(config), other = await store.createAgent(config);
  const channel = { id: agent.channels[0].id, agentId: agent.id, kind: 'platform-chat' as const };
  const tools = createChatHistoryTools(store, channel, agent.name);
  const call = async (name: string, args: object = {}) => (await tools.find(tool => tool.name === name)!.execute('test', args, undefined, undefined, undefined as never)).details as any;
  return { store, channel, other: other.channels[0].id, call };
}

describe('agent chat-history tools', () => {
  it('opens the latest section and pages both ways without overlap, even when messages arrive', async () => {
    const { store, channel, call } = await fixture();
    try {
      for (let index = 0; index < 25; index++) await store.appendMessage(channel.id, index % 2 ? 'assistant' : 'user', `Message ${index}`);
      const latest = await call('read_messages');
      expect(latest.messages).toHaveLength(20);
      expect(latest.messages[0].text).toBe('Message 5');
      expect(latest.messages.at(-1).text).toBe('Message 24');
      expect(latest.cursors.after).toBeNull();
      expect(latest.messages[0].author).toEqual({ role: 'assistant', name: 'Archivist' });
      expect(latest.range.from.timestamp).toBeTruthy();
      await store.appendMessage(channel.id, 'user', 'New arrival');
      const older = await call('read_messages', { before: latest.cursors.before });
      expect(older.messages.map((row: any) => row.text)).toEqual(['Message 0', 'Message 1', 'Message 2', 'Message 3', 'Message 4']);
      expect(older.cursors.before).toBeNull();
      const later = await call('read_messages', { after: latest.range.to.sequence });
      expect(later.messages.map((row: any) => row.text)).toEqual(['New arrival']);
      expect(await store.client.message.count()).toBe(26);
    } finally { await store.close(); }
  });

  it('jumps to a message or ISO timestamp with surrounding context and handles boundaries', async () => {
    const { store, channel, call } = await fixture();
    try {
      const rows = [];
      for (let index = 0; index < 7; index++) {
        const row = await store.appendMessage(channel.id, 'user', `Message ${index}`); rows.push(row);
        await store.client.message.update({ where: { id: row.id }, data: { createdAt: new Date(`2026-09-21T12:0${index}:00Z`) } });
      }
      await store.client.message.update({ where: { id: rows[4].id }, data: { createdAt: new Date('2026-09-21T12:03:00Z') } });
      const plan = await store.client.$queryRawUnsafe<{ detail: string }[]>('EXPLAIN QUERY PLAN SELECT id FROM Message WHERE channelId = ? AND createdAt >= ? ORDER BY createdAt, sequence LIMIT 1', channel.id, '2026-09-21T12:03:00+00:00');
      expect(plan.map(row => row.detail).join(' ')).toContain('Message_channelId_createdAt_sequence_idx');
      expect((await call('read_messages', { messageId: rows[3].id, limit: 3 })).messages.map((row: any) => row.text)).toEqual(['Message 2', 'Message 3', 'Message 4']);
      expect((await call('read_messages', { at: '2026-09-21T12:03:00Z', limit: 3 })).messages.map((row: any) => row.text)).toEqual(['Message 2', 'Message 3', 'Message 4']);
      expect((await call('read_messages', { at: '2020-01-01T00:00:00Z', limit: 3 })).messages.map((row: any) => row.text)).toEqual(['Message 0', 'Message 1', 'Message 2']);
      expect((await call('read_messages', { at: '2030-01-01T00:00:00Z', limit: 3 })).messages.map((row: any) => row.text)).toEqual(['Message 4', 'Message 5', 'Message 6']);
      expect((await call('read_messages', { messageId: rows[3].id, limit: 1 })).messages.map((row: any) => row.text)).toEqual(['Message 3']);
    } finally { await store.close(); }
  });

  it('bounds previews and expands long messages without losing text', async () => {
    const { store, channel, call } = await fixture();
    try {
      const text = 'x'.repeat(999) + '🌊' + 'body '.repeat(3000);
      const row = await store.appendMessage(channel.id, 'assistant', text);
      const view = await call('read_messages');
      const preview = view.messages[0];
      expect(preview.truncated).toBe(true);
      expect(preview.text.length).toBeLessThanOrEqual(1000);
      let combined = preview.text, offset = preview.nextOffset;
      while (offset !== null) {
        const part = (await call('read_messages', { messageId: row.id, offset })).messages[0];
        expect(part.text.length).toBeLessThanOrEqual(6000);
        combined += part.text; offset = part.nextOffset;
      }
      expect(combined).toBe(text);
      for (let index = 0; index < 40; index++) await store.appendMessage(channel.id, 'user', 'long '.repeat(1000));
      const section = await call('read_messages', { limit: 40 });
      expect(section.messages).toHaveLength(40);
      expect(section.messages.reduce((sum: number, message: any) => sum + message.text.length, 0)).toBeLessThanOrEqual(20000);
    } finally { await store.close(); }
  });

  it('searches literal phrases with bounded snippets, role/date filters, and a stable cursor', async () => {
    const { store, channel, other, call } = await fixture();
    try {
      for (let index = 0; index < 5; index++) {
        const row = await store.appendMessage(channel.id, index % 2 ? 'assistant' : 'user', `${'prefix '.repeat(100)} Pega 100%_sure ${index}`);
        await store.client.message.update({ where: { id: row.id }, data: { createdAt: new Date(`2026-09-21T12:0${index}:00Z`) } });
      }
      await store.appendMessage(other, 'user', 'Pega 100%_sure PRIVATE OTHER CHANNEL');
      const page = await call('search_messages', { query: 'pega 100%_sure', limit: 2 });
      expect(page.matches).toHaveLength(2);
      expect(page.matches.every((row: any) => row.snippet.text.length <= 320 && row.snippet.text.includes('Pega'))).toBe(true);
      expect(JSON.stringify(page)).not.toContain('PRIVATE OTHER CHANNEL');
      const next = await call('search_messages', { query: 'pega 100%_sure', limit: 2, before: page.nextCursor });
      expect(next.matches.every((row: any) => !page.matches.some((prior: any) => prior.id === row.id))).toBe(true);
      const filtered = await call('search_messages', { query: 'pega', author: 'assistant', since: '2026-09-21T12:02:00Z', until: '2026-09-21T12:04:00Z' });
      expect(filtered.matches).toHaveLength(1);
      expect((await call('search_messages', { query: "' OR 1=1 --" })).matches).toHaveLength(0);
    } finally { await store.close(); }
  });

  it('shows a bounded same-channel reply reference even when its parent is older than the read window', async () => {
    const { store, channel, other, call } = await fixture();
    try {
      const parent = await store.appendMessage(channel.id, 'assistant', 'Old context '.repeat(100));
      await store.appendMessage(other, 'assistant', 'FOREIGN SECRET');
      for (let index = 0; index < 30; index++) await store.appendMessage(channel.id, 'user', `Filler ${index}`);
      const reply = await store.appendMessage(channel.id, 'user', 'Follow-up', crypto.randomUUID(), parent.id);
      const section = await call('read_messages');
      const last = section.messages.at(-1);
      expect(last.replyTo).toMatchObject({ id: parent.id, role: 'assistant' });
      expect(last.replyTo.text.length).toBeLessThanOrEqual(161);
      expect(JSON.stringify(section)).not.toContain('FOREIGN SECRET');
      expect((await call('read_messages', { messageId: reply.id, offset: 0 })).messages[0].replyTo.id).toBe(parent.id);
      expect((await call('search_messages', { query: 'Follow-up' })).matches[0].replyTo.id).toBe(parent.id);
      const parentRead = await call('read_messages', { messageId: parent.id, offset: 0 });
      expect(parentRead.messages[0].text).toContain('Old context');
    } finally { await store.close(); }
  });

  it('enforces the granted channel and rejects ambiguous or invalid navigation', async () => {
    const { store, channel, other, call } = await fixture();
    try {
      const foreign = await store.appendMessage(other, 'user', 'Private');
      expect((await call('read_messages')).messages).toEqual([]);
      await expect(call('read_messages', { channelId: other })).rejects.toThrow();
      await expect(call('search_messages', { channelId: other, query: 'Private' })).rejects.toThrow();
      await expect(call('read_messages', { messageId: foreign.id })).rejects.toThrow();
      await expect(call('read_messages', { messageId: foreign.id, offset: 0 })).rejects.toThrow();
      for (const args of [{ at: 'yesterday' }, { before: 1, after: 2 }, { offset: 5 }, { limit: 999 }, { offset: -1, messageId: foreign.id }]) await expect(call('read_messages', args)).rejects.toThrow();
      await expect(call('search_messages', { query: ' ' })).rejects.toThrow();
      await expect(call('search_messages', { query: 'a', since: '2027-01-01T00:00:00Z', until: '2026-01-01T00:00:00Z' })).rejects.toThrow();
      expect(await store.client.message.count({ where: { channelId: channel.id } })).toBe(0);
    } finally { await store.close(); }
  });
});
