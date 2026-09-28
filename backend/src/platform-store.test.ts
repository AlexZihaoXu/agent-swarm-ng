import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { prepareDatabase } from './test-database';
import { PlatformStore } from './platform-store';

let folder: string;
beforeAll(async () => { folder = await mkdtemp(join(process.env.SQLITE_TEST_ROOT!, 'store-')); });

const config = { name: 'Durable', endpointId: 'endpoint', model: 'test', thinkingLevel: 'off' as const };

describe('Prisma SQLite platform records', () => {
  it('persists identities and channel messages across clients with WAL and foreign keys', async () => {
    const path = join(folder, 'restart.db');
    let store = await prepareDatabase(path);
    const agent = await store.createAgent(config);
    const channel = agent.channels[0];
    await store.appendMessage(channel.id, 'user', 'Hello');
    await store.appendMessage(channel.id, 'assistant', 'Published reply');
    expect(await store.client.$queryRawUnsafe('PRAGMA journal_mode')).toEqual([{ journal_mode: 'wal' }]);
    await expect(store.appendMessage('missing-channel', 'user', 'No orphan')).rejects.toThrow();
    await store.close();
    store = new PlatformStore(pathToFileURL(resolve(path)).href);
    try {
      expect((await store.findAgent(agent.id))?.channels[0].id).toBe(channel.id);
      expect((await store.messages(channel.id)).messages.map(row => row.text)).toEqual(['Hello', 'Published reply']);
    } finally { await store.close(); }
  });

  it('saves only same-channel reply targets and returns previews when the parent is outside the page', async () => {
    const store = await prepareDatabase(join(folder, 'replies.db'));
    try {
      const agent = await store.createAgent(config), other = await store.createAgent(config);
      const channelId = agent.channels[0].id;
      const parent = await store.appendMessage(channelId, 'assistant', 'A prior answer');
      const foreign = await store.appendMessage(other.channels[0].id, 'assistant', 'Private answer');
      for (let i = 0; i < 52; i++) await store.appendMessage(channelId, 'user', `Filler ${i}`);
      const reply = await store.appendMessage(channelId, 'user', 'Which answer?', crypto.randomUUID(), parent.id);
      expect(reply.replyToId).toBe(parent.id);
      expect(reply.replyTo?.text).toBe('A prior answer');
      expect((await store.messages(channelId, undefined, 1)).messages[0].replyTo?.id).toBe(parent.id);
      await expect(store.appendMessage(channelId, 'user', 'No', crypto.randomUUID(), foreign.id)).rejects.toThrow('Reply target not found');
      await expect(store.appendMessage(channelId, 'user', 'No', crypto.randomUUID(), 'missing')).rejects.toThrow('Reply target not found');
      expect(await store.client.message.count({ where: { channelId } })).toBe(54);
      await store.client.message.delete({ where: { id: parent.id } });
      expect((await store.messages(channelId, undefined, 1)).messages[0]).toMatchObject({ id: reply.id, replyToId: null, replyTo: null });
    } finally { await store.close(); }
  });

  it('uses channel-scoped keyset pages without overlap or ordering by tied timestamps', async () => {
    const store = await prepareDatabase(join(folder, 'pages.db'));
    try {
      const first = await store.createAgent(config); const other = await store.createAgent(config);
      const channelId = first.channels[0].id;
      for (let i = 0; i < 5; i++) await store.appendMessage(channelId, 'user', String(i));
      await store.appendMessage(other.channels[0].id, 'user', 'Other channel');
      const plan = await store.client.$queryRawUnsafe<{ detail: string }[]>('EXPLAIN QUERY PLAN SELECT * FROM Message WHERE channelId = ? AND sequence < ? ORDER BY sequence DESC LIMIT 50', channelId, 100);
      expect(plan.map(row => row.detail).join(' ')).toContain('Message_channelId_sequence_idx');
      const latest = await store.messages(channelId, undefined, 2);
      await store.appendMessage(channelId, 'user', 'Arrived between pages');
      const older = await store.messages(channelId, latest.nextCursor!, 2);
      const oldest = await store.messages(channelId, older.nextCursor!, 2);
      expect([...oldest.messages, ...older.messages, ...latest.messages].map(row => row.text)).toEqual(['0', '1', '2', '3', '4']);
      expect(oldest.nextCursor).toBeNull();
      const page = await store.listAgents(undefined, 1);
      expect((await store.listAgents(page.nextCursor!, 1)).agents.map(row => row.id)).toEqual([other.id]);
    } finally { await store.close(); }
  });

  it('bounds model context without deleting display history and rejects duplicate message IDs', async () => {
    const store = await prepareDatabase(join(folder, 'context.db'));
    try {
      const agent = await store.createAgent(config); const channelId = agent.channels[0].id;
      for (let i = 0; i < 105; i++) await store.appendMessage(channelId, 'user', String(i));
      const recent = await store.context(channelId);
      expect(recent).toHaveLength(8);
      expect(recent[0]).toMatchObject({ id: expect.any(String), sequence: expect.any(Number), timestamp: expect.any(Number), text: '97' });
      const beforeIncoming = await store.context(channelId, recent.at(-1)!.id);
      expect(beforeIncoming).toHaveLength(8);
      expect(beforeIncoming[0].text).toBe('96');
      expect(beforeIncoming.at(-1)!.text).toBe('103');
      for (let i = 0; i < 5; i++) await store.appendMessage(channelId, 'assistant', 'x'.repeat(20000));
      const previews = await store.context(channelId);
      expect(previews).toHaveLength(8);
      expect(previews.every(message => message.text.length <= 1000)).toBe(true);
      expect(previews.at(-1)).toMatchObject({ nextOffset: 1000, totalCharacters: 20000 });
      expect(await store.client.message.count()).toBe(110);
      const saved = await store.appendMessage(channelId, 'user', 'Once');
      await expect(store.appendMessage(channelId, 'user', 'Twice', saved.id)).rejects.toThrow();
      await store.appendMessage(channelId, 'user', 'Queued follow-up');
      await store.appendMessage(channelId, 'assistant', 'Preceding turn finished');
      const queuedContext = await store.context(channelId, saved.id, saved.sequence);
      expect(queuedContext.at(-1)?.text).toBe('Preceding turn finished');
      expect(queuedContext.some(message => message.text === 'Once' || message.text === 'Queued follow-up')).toBe(false);
    } finally { await store.close(); }
  });

  it('keeps its busy timeout after transactions and waits for a competing writer instead of failing', async () => {
    const path = join(folder, 'busy.db');
    const store = await prepareDatabase(path);
    try {
      const agent = await store.createAgent(config);
      await store.appendMessage(agent.channels[0].id, 'user', 'first'); // interactive transaction: the client swaps its connection
      expect(await store.client.$queryRawUnsafe('PRAGMA busy_timeout')).toEqual([{ timeout: 5000 }]);
      // The native driver blocks its thread while waiting, so the rival writer must live in another process.
      const holder = spawn('bun', ['-e', `import { createClient } from '@libsql/client';
        const c = createClient({ url: ${JSON.stringify(pathToFileURL(resolve(path)).href)} });
        const t = await c.transaction('write'); console.log('locked'); await new Promise(r => setTimeout(r, 1200)); await t.commit(); c.close();`], { cwd: resolve(__dirname, '..') });
      const exited = new Promise(resolvePromise => holder.once('exit', resolvePromise));
      await new Promise(resolvePromise => holder.stdout.once('data', resolvePromise)); // wait until the lock is held
      const started = Date.now();
      await store.appendMessage(agent.channels[0].id, 'user', 'second'); // must wait, not throw SQLITE_BUSY
      expect(Date.now() - started).toBeGreaterThanOrEqual(400);
      await exited;
    } finally { await store.close(); }
  });
});
