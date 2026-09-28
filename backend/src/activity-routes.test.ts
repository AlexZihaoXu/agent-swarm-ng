import { expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareDatabase } from './test-database';
import { buildApp } from './app';
import { ActivityStore } from './activity-store';
import { createActivityRecorder } from './agent-activity';

it('serves no-store operator pages/fragments with ownership, bounds, retries and side-effect-free app construction', async () => {
  const folder = await mkdtemp(join(process.env.SQLITE_TEST_ROOT!, 'activity-api-'));
  const db = await prepareDatabase(join(folder, 'api.db'));
  const agent = await db.createAgent({ name: 'A', endpointId: 'test', model: 'test', thinkingLevel: 'off' });
  const store = new ActivityStore(db);
  const recorder = createActivityRecorder(agent.id, agent.channels[0].id, '', () => {}, 'run', store);
  await recorder.start();
  recorder.record('assistant', 'Internal output', 'x'.repeat(7000), 'output');
  await recorder.flush();
  const app = await buildApp({ database: db, computerController: null });
  try {
    expect((await db.client.activity.findUnique({ where: { id: 'run:run-status' } }))?.state).toBe('active');
    const page = await app.inject(`/api/agents/${agent.id}/activity`);
    expect(page.statusCode).toBe(200); expect(page.headers['cache-control']).toBe('no-store');
    expect(page.json().entries.find((entry: {id:string}) => entry.id === 'run:output')).toMatchObject({ text: 'x'.repeat(6000), nextOffset: 6000, revision: 1 });
    const fragment = await app.inject(`/api/agents/${agent.id}/activity/entry?entryId=run:output&offset=6000&revision=1`);
    expect(fragment.json()).toMatchObject({ text: 'x'.repeat(1000), offset: 6000, nextOffset: null });
    expect((await app.inject(`/api/agents/${agent.id}/activity/entry?entryId=run:output&revision=2`)).statusCode).toBe(409);
    expect((await app.inject('/api/agents/foreign/activity/entry?entryId=run:output')).statusCode).toBe(404);
    expect((await app.inject('/api/agents/foreign/activity')).statusCode).toBe(404);
    expect((await app.inject(`/api/agents/${agent.id}/activity?before=-1`)).statusCode).toBe(400);
    expect((await app.inject(`/api/agents/${agent.id}/activity/entry?entryId=run:output&offset=-1`)).statusCode).toBe(400);
    expect((await app.inject(`/api/channels/${agent.channels[0].id}/messages`)).json().messages).toEqual([]);
  } finally { await app.close(); }
});
