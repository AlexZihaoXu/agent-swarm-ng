import { expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PlatformStore } from './platform-store';
import { prepareDatabase } from './test-database';
import { buildApp } from './app';
import { defaultSwarmSettings, SwarmSettingsStore } from './swarm-settings';

it('starts from defaults, saves only valid whole numbers within bounds, and survives reopening', async () => {
  const file = join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`);
  const database = await prepareDatabase(file);
  const store = new SwarmSettingsStore(database);
  try {
    expect(await store.get()).toEqual(defaultSwarmSettings);
    expect(defaultSwarmSettings).toMatchObject({ maxComputers: 4, uploadMaxMb: 100, storageBudgetGb: 10 });
    await expect(store.update({ maxComputers: 0 })).rejects.toThrow('from 1 to 100');
    await expect(store.update({ uploadMaxMb: 1.5 })).rejects.toThrow('whole number');
    await expect(store.update({ nope: 1 } as never)).rejects.toThrow('Unknown setting');
    expect(await store.update({ maxComputers: 6, scratchMaxFiles: 800 })).toMatchObject({
      maxComputers: 6,
      scratchMaxFiles: 800,
      uploadMaxMb: 100,
    });
  } finally {
    await database.close();
  }
  const reopened = new PlatformStore(pathToFileURL(file).href);
  try {
    expect((await new SwarmSettingsStore(reopened).get()).maxComputers).toBe(6);
  } finally {
    await reopened.close();
  }
});

it('serves Settings → Swarm over the API with bounds, and rejects bad edits', async () => {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const app = await buildApp({ database, computerController: null });
  try {
    const read = await app.inject({ method: 'GET', url: '/api/settings/swarm' });
    expect(read.statusCode).toBe(200);
    expect(read.headers['cache-control']).toBe('no-store');
    expect(read.json()).toMatchObject({
      settings: { maxComputers: 4 },
      bounds: { maxComputers: { min: 1, max: 100, label: 'Computers' }, uploadMaxMb: { unit: 'MB' } },
    });
    const saved = await app.inject({ method: 'PATCH', url: '/api/settings/swarm', payload: { uploadMaxMb: 250 } });
    expect(saved.json().settings.uploadMaxMb).toBe(250);
    const bad = await app.inject({ method: 'PATCH', url: '/api/settings/swarm', payload: { storageBudgetGb: 0 } });
    expect(bad.statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/api/settings/swarm', payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/api/settings/swarm', payload: { extra: 1 } })).statusCode).toBe(
      400,
    );
  } finally {
    await app.close();
    await database.close();
  }
});
