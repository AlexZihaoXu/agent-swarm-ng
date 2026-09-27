import { expect, it } from 'vitest';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { AgentSessionStore } from '../agent-session-store';
import { prepareDatabase } from '../test-database';
import { ScreenshotPool } from './image-pool';
it('keeps image bytes only in disk pool and restores valid Pi checkpoints after image expiry', async () => {
  const db = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const pool = new ScreenshotPool(join(db.dataDirectory, 'computer-screenshots'));
  const store = new AgentSessionStore(db);
  const agent = await db.createAgent({ name: 'Vision', endpointId: 'mock', model: 'test', thinkingLevel: 'off' });
  try {
    const bytes = Buffer.from('screenshot-unique-bytes');
    const ref = await pool.put(agent.id, { data: bytes, mimeType: 'image/png', width: 2, height: 2, bounds: [0,0,999,999] });
    const session = SessionManager.inMemory();
    session.appendMessage({ role: 'toolResult', toolCallId: 'look', toolName: 'glance', timestamp: 1, isError: false,
      content: [{ type: 'text', text: JSON.stringify({ ...ref, note: 'Image copy may expire; take a fresh look if not attached.' }) }, { type: 'image', mimeType: 'image/png', data: bytes.toString('base64') }], details: { computerImage: ref } });
    await store.save(agent.id, session);
    const persisted = await db.client.agentSessionEntry.findFirst({ where: { agentId: agent.id } });
    expect(persisted?.payload).not.toContain(bytes.toString('base64'));
    let restored = (await store.load(agent.id))!;
    expect(JSON.stringify(restored.getEntries())).toContain(bytes.toString('base64'));
    await store.save(agent.id, restored);
    await pool.removeAgent(agent.id);
    restored = (await store.load(agent.id))!;
    expect(JSON.stringify(restored.getEntries())).not.toContain(bytes.toString('base64'));
    restored.appendMessage({ role: 'user', content: 'Continue', timestamp: 2 });
    await store.save(agent.id, restored);
    expect((await store.load(agent.id))?.getEntries()).toHaveLength(2);
  } finally { await pool.removeAgent(agent.id); await db.close(); }
});
