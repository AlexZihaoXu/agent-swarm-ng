import { expect, it } from 'vitest';
import { join } from 'node:path';
import { buildApp } from '../app';
import { prepareDatabase } from '../test-database';
import { ScreenshotPool } from './image-pool';
import type { ComputerController } from '../computer-controller-client';
it('serves explicit assignments, human release and scoped expiring images without channel publication', async () => {
  const db = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const agent = await db.createAgent({ name: 'A', endpointId: 'mock', model: 'mock', thinkingLevel: 'off' });
  const other = await db.createAgent({ name: 'B', endpointId: 'mock', model: 'mock', thinkingLevel: 'off' });
  const computer = await db.client.computer.create({ data: { name: 'Desk', requestKey: crypto.randomUUID(), state: 'running' } });
  const pool = new ScreenshotPool(join(db.dataDirectory, 'computer-screenshots'));
  const app = await buildApp({ database: db, computerController: { runtime: { cancel: async () => {} } } as unknown as ComputerController });
  try {
    const put = await app.inject({ method: 'PUT', url: `/api/agents/${agent.id}/computers`, payload: { computerIds: [computer.id] } });
    expect(put.statusCode).toBe(200);
    const assigned = await app.inject(`/api/agents/${agent.id}/computers`);
    expect(assigned.headers['cache-control']).toBe('no-store'); expect(assigned.json().computers[0].id).toBe(computer.id);
    await db.client.computerClaim.create({ data: { computerId: computer.id, agentId: agent.id } });
    expect((await app.inject('/api/computers/control')).json().holders[0].agent.name).toBe('A');
    const release = await app.inject({ method: 'POST', url: `/api/computers/${computer.id}/release`, payload: {} });
    expect(release.json()).toEqual({ released: true }); expect(await db.client.computerAssignment.count()).toBe(1);
    const ref = await pool.put(agent.id, { data: Buffer.from([255,216,255,217]), mimeType: 'image/jpeg', width: 1, height: 1, bounds: [0,0,999,999] });
    const image = await app.inject(`/api/agents/${agent.id}/screenshots/${ref.id}`);
    expect(image.statusCode).toBe(200); expect(image.headers['content-type']).toContain('image/jpeg');
    expect((await app.inject(`/api/agents/${other.id}/screenshots/${ref.id}`)).statusCode).toBe(404);
    await pool.removeAgent(agent.id);
    expect((await app.inject(`/api/agents/${agent.id}/screenshots/${ref.id}`)).json().message).toContain('expired');
    expect(await db.client.message.count()).toBe(0);
  } finally { await app.close(); }
});
