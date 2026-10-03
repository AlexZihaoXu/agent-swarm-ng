import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { EndpointStore } from './endpoint-store';
import { buildApp } from './app';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function storePath() {
  await mkdir('.scratch', { recursive: true });
  const directory = await mkdtemp(join('.scratch', 'endpoint-store-test-'));
  directories.push(directory);
  return join(directory, 'endpoints.json');
}

const endpoint = {
  id: 'test-endpoint',
  name: 'Local server',
  baseUrl: 'http://localhost:1234/v1',
  apiKey: 'test-secret',
};

describe('saved endpoint preferences', () => {
  it('survives a fresh store instance, preserves omitted keys, and clears keys on URL changes', async () => {
    const path = await storePath();
    const store = new EndpointStore(path);
    await store.save(endpoint);
    const reopened = new EndpointStore(path);
    expect(await reopened.read()).toEqual([endpoint]);
    await reopened.save({ id: endpoint.id, name: 'Renamed', baseUrl: endpoint.baseUrl });
    expect((await reopened.read())[0].apiKey).toBe('test-secret');
    await reopened.save({ id: endpoint.id, name: 'Renamed', baseUrl: 'https://different.example/v1' });
    expect((await reopened.read())[0].apiKey).toBe('');
    await reopened.remove(endpoint.id);
    expect(await new EndpointStore(path).read()).toEqual([]);
  });

  it('serializes concurrent saves without dropping endpoints', async () => {
    const store = new EndpointStore(await storePath());
    await Promise.all([store.save(endpoint), store.save({ ...endpoint, id: 'second' })]);
    expect(await store.read()).toHaveLength(2);
  });

  it('never returns keys and can test by saved ID after an app restart', async () => {
    const path = await storePath();
    const first = await buildApp({ requireLogin: false, endpointStore: new EndpointStore(path) });
    try {
      const save = await first.inject({ method: 'POST', url: '/api/model-endpoints', payload: endpoint });
      expect(save.statusCode).toBe(200);
      expect(save.json()).toMatchObject({ id: endpoint.id, hasApiKey: true });
      expect(save.body).not.toContain('test-secret');
    } finally {
      await first.close();
    }
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'example-model' }] }));
    const { prepareDatabase } = await import('./test-database');
    const second = await buildApp({
      requireLogin: false,
      endpointStore: new EndpointStore(path),
      fetcher: fetcher as unknown as typeof fetch,
      database: await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`)),
    });
    try {
      const list = await second.inject('/api/model-endpoints');
      expect(list.json()).toHaveLength(1);
      expect(list.body).not.toContain('test-secret');
      const tested = await second.inject({
        method: 'POST',
        url: '/api/model-endpoints/test',
        payload: { endpointId: endpoint.id, baseUrl: endpoint.baseUrl },
      });
      expect(tested.statusCode).toBe(200);
      expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer test-secret');
      const removed = await second.inject({ method: 'DELETE', url: `/api/model-endpoints/${endpoint.id}` });
      expect(removed.statusCode).toBe(200);
    } finally {
      await second.close();
    }
  });
});

it('keeps saved keys beside the configured database instead of a fixed repository path', async () => {
  const { mkdtemp, readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const folder = await mkdtemp(join(process.env.SQLITE_TEST_ROOT!, 'ep-'));
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${join(folder, 'platform.db')}`;
  try {
    const store = new EndpointStore();
    await store.save({ id: 'one', name: 'One', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'secret' });
    expect(JSON.parse(await readFile(join(folder, 'endpoints.json'), 'utf8'))[0]).toMatchObject({
      id: 'one',
      apiKey: 'secret',
    });
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

it('refuses to remove an endpoint that agents still use, and removes it once they are gone', async () => {
  const folder = await mkdtemp(join('.scratch', 'endpoint-in-use-'));
  const { prepareDatabase } = await import('./test-database');
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const store = new EndpointStore(join(folder, 'endpoints.json'));
  const app = await buildApp({ requireLogin: false, endpointStore: store, database });
  try {
    await store.save({ id: 'in-use', name: 'Local', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'k' });
    const agent = await database.createAgent({
      name: 'Uses it',
      endpointId: 'in-use',
      model: 'm',
      thinkingLevel: 'off',
    });
    const refused = await app.inject({ method: 'DELETE', url: '/api/model-endpoints/in-use' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toMatch(/1 agent uses this endpoint/);
    expect((await store.read()).map(row => row.id)).toEqual(['in-use']);
    await database.deleteAgent(agent.id, 'Uses it');
    expect((await app.inject({ method: 'DELETE', url: '/api/model-endpoints/in-use' })).statusCode).toBe(200);
    expect(await store.read()).toEqual([]);
  } finally {
    await app.close();
    await rm(folder, { recursive: true, force: true });
  }
});
