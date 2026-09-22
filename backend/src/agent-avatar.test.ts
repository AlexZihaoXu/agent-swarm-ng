import { expect, it } from 'vitest';
import { join } from 'node:path';
import { buildApp } from './app';
import { EndpointStore } from './endpoint-store';
import { prepareDatabase } from './test-database';
import { PlatformStore } from './platform-store';
import { pathToFileURL } from 'node:url';

it('saves avatar identity at creation and edits only appearance, surviving reopen', async () => {
  const file = join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`);
  const database = await prepareDatabase(file);
  const endpoints = new EndpointStore(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.json`));
  await endpoints.save({ id: 'fixture', name: 'Fixture', baseUrl: 'http://test.invalid/v1', apiKey: '' });
  const app = await buildApp({ database, endpointStore: endpoints });
  let id = '';
  const avatar = { shape: 'bean', color: '#55bea9', seed: 42 };
  const edited = { shape: 'triangle', color: '#F7AD51', seed: 321, eyeStyle: 'round' };
  try {
    const response = await app.inject({ method: 'POST', url: '/api/agents', payload: { name: 'Avatar agent', endpointId: 'fixture', model: 'test-model', thinkingLevel: 'off', avatar } });
    expect(response.statusCode).toBe(200); const agent = response.json(); id = agent.id;
    expect(agent.avatar).toEqual(avatar);
    await database.appendMessage(agent.channelId, 'user', 'Keep this history');
    const changed = await app.inject({ method: 'PATCH', url: `/api/agents/${id}/avatar`, payload: { avatar: edited } });
    expect(changed.statusCode).toBe(200); expect(changed.json().avatar).toEqual({ ...edited, color: '#f7ad51' });
    const row = await database.findAgent(id);
    expect(row?.name).toBe('Avatar agent'); expect(row?.model).toBe('test-model');
    expect(row?.channels[0].messages[0].text).toBe('Keep this history');
    for (const bad of [{ ...avatar, shape: 'unknown' }, { ...avatar, color: 'url(https://test.invalid)' }, { ...avatar, eyeStyle: 'emoji' }, { ...avatar, seed: -1 }, { ...avatar, seed: 1.5 }, { ...avatar, seed: 2147483648 }])  {
      expect((await app.inject({ method: 'PATCH', url: `/api/agents/${id}/avatar`, payload: { avatar: bad } })).statusCode).toBe(400);
    }
    // Fastify strips additional properties; they must never mutate model configuration.
    expect((await app.inject({ method: 'PATCH', url: `/api/agents/${id}/avatar`, payload: { avatar: edited, model: 'changed' } })).statusCode).toBe(200);
    expect((await database.findAgent(id))?.model).toBe('test-model');
    expect((await app.inject({ method: 'PATCH', url: '/api/agents/missing/avatar', payload: { avatar } })).statusCode).toBe(404);
  } finally { await app.close(); }
  const reopened = new PlatformStore(pathToFileURL(file).href);
  try { expect(JSON.parse((await reopened.findAgent(id))!.avatar!)).toEqual({ ...edited, color: '#f7ad51' }); }
  finally { await reopened.close(); }
});
