import { expect, it } from 'vitest';
import { join } from 'node:path';
import { buildApp } from '../app';
import { prepareDatabase } from '../test-database';

it('serves only bounded, read-only catalog pages for operator review', async () => {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const app = await buildApp({ requireLogin: false, database, computerController: null });
  try {
    const roots = await app.inject({ method: 'GET', url: '/api/knowledge' });
    expect(roots.statusCode).toBe(200);
    expect(roots.headers['cache-control']).toContain('no-store');
    expect(roots.json().entries.map((entry: { id: string }) => entry.id)).toEqual(['concepts', 'practices']);
    expect(roots.json().entries[0]).not.toHaveProperty('content');
    const children = await app.inject({ method: 'GET', url: '/api/knowledge?parentId=concepts&limit=1' });
    expect(children.json()).toMatchObject({ nextOffset: 1, entries: [{ id: 'concepts/agents' }] });
    expect((await app.inject({ method: 'GET', url: '/api/knowledge?parentId=missing' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/knowledge?limit=21' })).statusCode).toBe(400);
    const found = await app.inject({ method: 'GET', url: '/api/knowledge/search?query=communication' });
    expect(found.statusCode).toBe(200);
    expect(found.json().matches).toContainEqual(expect.objectContaining({ id: 'concepts/channels' }));
    expect(found.json().matches[0]).not.toHaveProperty('content');
    const first = await app.inject({ method: 'GET', url: '/api/knowledge/entry?id=concepts%2Fchannels&length=12' });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      id: 'concepts/channels',
      parentId: 'concepts',
      source: 'docs/vision.md',
      nextOffset: 12,
      breadcrumbs: [
        { id: 'concepts', title: 'Swarm concepts' },
        { id: 'concepts/channels', title: 'Channels' },
      ],
    });
    expect(first.json().text).toHaveLength(12);
    expect(first.json().related).toContainEqual(expect.objectContaining({ id: 'practices/communication' }));
    const rest = await app.inject({
      method: 'GET',
      url: `/api/knowledge/entry?id=concepts%2Fchannels&offset=${first.json().nextOffset}`,
    });
    expect(rest.statusCode).toBe(200);
    expect(rest.json().nextOffset).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/api/knowledge/entry?id=missing' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/knowledge/search?query=%20' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/knowledge', payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/knowledge/entry?id=concepts' })).statusCode).toBe(404);
  } finally {
    await app.close();
    await database.close();
  }
});
