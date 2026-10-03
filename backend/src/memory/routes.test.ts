import { expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareDatabase } from '../test-database';
import { buildApp } from '../app';
import { MemoryStore } from './store';
import { SwarmSettingsStore } from '../swarm-settings';

it('lets the owner see, edit, forget, restore and erase memories, and set the sleep window', async () => {
  const folder = await mkdtemp(join(process.env.SQLITE_TEST_ROOT!, 'memory-api-'));
  const db = await prepareDatabase(join(folder, 'api.db'));
  const agent = await db.createAgent({ name: 'A', endpointId: 'test', model: 'test', thinkingLevel: 'off' });
  const store = new MemoryStore(db, new SwarmSettingsStore(db));
  await store.memorize(
    agent.id,
    { type: 'person', title: 'Sam', text: 'Sam runs the release.' },
    { by: 'agent Bo', trust: 'agent' },
  );
  const app = await buildApp({ requireLogin: false, database: db, computerController: null });
  const base = `/api/agents/${agent.id}/memory`;
  try {
    const first = await app.inject(base);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.json()).toMatchObject({
      index: '',
      maxCount: 1000,
      memories: [{ name: 'sam', type: 'person', by: 'agent Bo', trust: 'agent' }],
      sleep: { from: '03:00', to: '05:00', sleeping: false, sleptAt: null },
    });
    const edited = await app.inject({
      method: 'PATCH',
      url: `${base}/sam`,
      payload: { text: 'Sam runs releases on Fridays.' },
    });
    expect(edited.json()).toMatchObject({ text: 'Sam runs releases on Fridays.' });
    expect((await app.inject(`${base}/sam/versions`)).json()).toMatchObject([
      { text: 'Sam runs the release.', changedBy: 'owner' },
    ]);
    expect((await app.inject({ method: 'PATCH', url: `${base}/sam`, payload: { type: 'mood' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: `${base}/nope`, payload: { text: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `${base}/sam` })).statusCode).toBe(204);
    expect((await app.inject(base)).json()).toMatchObject({ memories: [], forgotten: [{ name: 'sam' }] });
    expect((await app.inject({ method: 'POST', url: `${base}/sam/restore` })).json()).toMatchObject({
      forgottenAt: null,
    });
    const window = await app.inject({
      method: 'PUT',
      url: `${base}/sleep-window`,
      payload: { from: '01:30', to: '04:00' },
    });
    expect(window.json().sleep).toMatchObject({ from: '01:30', to: '04:00' });
    expect(
      (await app.inject({ method: 'PUT', url: `${base}/sleep-window`, payload: { from: '25:00', to: '04:00' } }))
        .statusCode,
    ).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: base })).statusCode).toBe(204);
    expect((await app.inject(base)).json()).toMatchObject({ memories: [], forgotten: [] });
    expect((await app.inject('/api/agents/foreign/memory')).statusCode).toBe(404);
  } finally {
    await app.close();
    await db.close();
  }
});
