import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { EndpointStore } from './endpoint-store';
import { buildApp } from './app';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function storePath() {
  await mkdir('.scratch', { recursive: true });
  const directory = await mkdtemp(join('.scratch', 'endpoint-store-test-'));
  directories.push(directory);
  return join(directory, 'endpoints.json');
}

const endpoint = { id: 'test-endpoint', name: 'Local server', baseUrl: 'http://localhost:1234/v1', apiKey: 'test-secret' };

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
    const first = await buildApp({ endpointStore: new EndpointStore(path) });
    try {
      const save = await first.inject({ method: 'POST', url: '/api/model-endpoints', payload: endpoint });
      expect(save.statusCode).toBe(200);
      expect(save.json()).toMatchObject({ id: endpoint.id, hasApiKey: true });
      expect(save.body).not.toContain('test-secret');
    } finally { await first.close(); }
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'example-model' }] }));
    const second = await buildApp({ endpointStore: new EndpointStore(path), fetcher: fetcher as unknown as typeof fetch });
    try {
      const list = await second.inject('/api/model-endpoints');
      expect(list.json()).toHaveLength(1);
      expect(list.body).not.toContain('test-secret');
      const tested = await second.inject({ method: 'POST', url: '/api/model-endpoints/test', payload: { endpointId: endpoint.id, baseUrl: endpoint.baseUrl } });
      expect(tested.statusCode).toBe(200);
      expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer test-secret');
      const removed = await second.inject({ method: 'DELETE', url: `/api/model-endpoints/${endpoint.id}` });
      expect(removed.statusCode).toBe(200);
    } finally { await second.close(); }
  });
});
