import { expect, it } from 'vitest';
import { join } from 'node:path';
import { buildApp } from './app';
import { prepareDatabase } from './test-database';
import type { ComputerController } from './computer-controller-client';
import { ComputerStore } from './computer-store';

async function fixture() {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const calls: string[] = [];
  const observed = new Map<string, { status: string; cpuPercent: number | null; memoryBytes: number | null }>();
  const controller: ComputerController = {
    async create(id, name) { calls.push(`create:${id}:${name}`); observed.set(id, { status: 'running', cpuPercent: 12.5, memoryBytes: 134217728 }); },
    async remove(id, name) { calls.push(`remove:${id}:${name}`); observed.delete(id); },
    async observe() { return observed; },
    async preview(id, full = false) { if (!observed.has(id)) return null; if (full) calls.push(`full-preview:${id}`); return Buffer.from([0xff, 0xd8, 0xff, 0xd9]); },
    async pointer(id, x, y) { calls.push(`pointer:${id}:${x}:${y}`); },
  };
  const app = await buildApp({ database, computerController: controller });
  return { app, database, calls, observed, controller };
}

it('creates one platform computer, lists status/usage and serves its bounded JPEG without granting agents tools', async () => {
  const { app, database, calls } = await fixture();
  try {
    const requestKey = crypto.randomUUID();
    const create = await app.inject({ method: 'POST', url: '/api/computers', payload: { name: 'My computer', requestKey } });
    expect(create.statusCode).toBe(201);
    const computer = create.json();
    expect(computer).toMatchObject({ name: 'My computer', state: 'running', cpuPercent: 12.5, memoryBytes: 134217728 });
    const retry = await app.inject({ method: 'POST', url: '/api/computers', payload: { name: 'My computer', requestKey } });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().id).toBe(computer.id);
    expect(calls).toEqual([`create:${computer.id}:My computer`]);
    expect((await app.inject({ method: 'GET', url: '/api/computers' })).json()).toEqual({ computers: [computer], controllerConnected: true });
    const image = await app.inject({ method: 'GET', url: `/api/computers/${computer.id}/preview` });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toContain('image/jpeg');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    expect(image.headers['cache-control']).toBe('no-store');
    expect(image.rawPayload).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    expect(await database.client.agent.count()).toBe(0);
  } finally { await app.close(); await database.close(); }
});

it('limits first-run desktop input to an existing running computer and normalized coordinates', async () => {
  const { app, database, calls } = await fixture();
  try {
    const row = (await app.inject({ method: 'POST', url: '/api/computers', payload: { name: 'Desk', requestKey: crypto.randomUUID() } })).json();
    const path = `/api/computers/${row.id}/desktop/input`;
    for (const payload of [{ x: -0.1, y: 0.5 }, { x: 1.1, y: 0 }, { x: 0.5, y: '3' }]) {
      expect((await app.inject({ method: 'POST', url: path, payload })).statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect((await app.inject({ method: 'POST', url: '/api/computers/not-a-computer/desktop/input', payload: { x: 0.5, y: 0.5 } })).statusCode).toBe(404);
    expect(calls.filter(call => call.startsWith('pointer:'))).toEqual([]);
    const accepted = await app.inject({ method: 'POST', url: path, payload: { x: 0.65, y: 0.43 } });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toEqual({ accepted: true });
    expect(calls).toContain(`pointer:${row.id}:0.65:0.43`);
    // Fastify strips extra JSON keys; they never become command arguments.
    const extra = await app.inject({ method: 'POST', url: path, payload: { x: 0.5, y: 0.5, command: 'shell' } });
    expect(extra.statusCode).toBe(202);
    expect(calls.filter(call => call.startsWith('pointer:'))).toEqual([`pointer:${row.id}:0.65:0.43`, `pointer:${row.id}:0.5:0.5`]);
    const full = await app.inject({ method: 'GET', url: `/api/computers/${row.id}/preview?full=1` });
    expect(full.statusCode).toBe(200);
    expect(full.headers['x-content-type-options']).toBe('nosniff');
    expect(calls).toContain(`full-preview:${row.id}`);
    expect((await app.inject({ method: 'GET', url: `/api/computers/${row.id}/preview?full=other` })).statusCode).toBe(400);
    await database.client.computer.update({ where: { id: row.id }, data: { state: 'failed' } });
    expect((await app.inject({ method: 'POST', url: path, payload: { x: 0.5, y: 0.5 } })).statusCode).toBe(503);
  } finally { await app.close(); await database.close(); }
});

it('validates exact-name deletion on the backend and never calls Docker for invalid or foreign requests', async () => {
  const { app, database, calls } = await fixture();
  try {
    const key = crypto.randomUUID();
    expect((await app.inject({ method: 'POST', url: '/api/computers', payload: { name: '   ', requestKey: key } })).statusCode).toBe(400);
    const created = (await app.inject({ method: 'POST', url: '/api/computers', payload: { name: 'Example', requestKey: key } })).json();
    expect((await app.inject({ method: 'POST', url: '/api/computers', payload: { name: 'Other', requestKey: key } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: `/api/computers/${created.id}`, payload: { confirmation: 'example' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: '/api/computers/foreign', payload: { confirmation: 'Example' } })).statusCode).toBe(404);
    expect(calls).toEqual([`create:${created.id}:Example`]);
    expect((await app.inject({ method: 'DELETE', url: `/api/computers/${created.id}`, payload: { confirmation: 'Example' } })).statusCode).toBe(200);
    expect(calls).toContain(`remove:${created.id}:Example`);
    expect(await database.client.computer.count()).toBe(0);
  } finally { await app.close(); await database.close(); }
});

it('treats two identically confirmed concurrent deletes as one completed effect', async () => {
  const { app, database, controller } = await fixture();
  try {
    const row = (await app.inject({ method: 'POST', url: '/api/computers', payload: { name: 'Concurrent', requestKey: crypto.randomUUID() } })).json();
    const remove = controller.remove;
    controller.remove = async (id, name) => { await new Promise(resolve => setTimeout(resolve, 20)); return remove(id, name); };
    const results = await Promise.all([1, 2].map(() => app.inject({ method: 'DELETE', url: `/api/computers/${row.id}`, payload: { confirmation: 'Concurrent' } })));
    expect(results.map(result => result.statusCode)).toEqual([200, 200]);
    expect(await database.client.computer.count()).toBe(0);
  } finally { await app.close(); await database.close(); }
});

it('reconciles a crash between Docker creation and a saved status, and unlocks stale partial creates', async () => {
  const { app, database, observed } = await fixture();
  try {
    const store = new ComputerStore(database);
    const live = (await store.reserve('Recovered', crypto.randomUUID())).computer;
    observed.set(live.id, { status: 'running', cpuPercent: 1, memoryBytes: 123 });
    const first = (await app.inject({ method: 'GET', url: '/api/computers' })).json();
    expect(first.computers[0]).toMatchObject({ id: live.id, state: 'running' });
    const partial = (await store.reserve('Partial', crypto.randomUUID())).computer;
    await database.client.computer.update({ where: { id: partial.id }, data: { createdAt: new Date(Date.now() - 180_000) } });
    const second = (await app.inject({ method: 'GET', url: '/api/computers' })).json();
    expect(second.computers.find((item: { id: string }) => item.id === partial.id)).toMatchObject({ state: 'failed' });
    expect((await app.inject({ method: 'DELETE', url: `/api/computers/${partial.id}`, payload: { confirmation: 'Partial' } })).statusCode).toBe(200);
  } finally { await app.close(); await database.close(); }
});

it('shows saved computers as unavailable during a controller outage without hiding identities', async () => {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const store = new ComputerStore(database);
  const { computer } = await store.reserve('Kept machine', crypto.randomUUID());
  await store.markRunning(computer.id);
  const app = await buildApp({ database, computerController: null });
  try {
    const response = await app.inject({ method: 'GET', url: '/api/computers' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ controllerConnected: false, computers: [{ id: computer.id, name: 'Kept machine', state: 'unavailable', cpuPercent: null, memoryBytes: null }] });
    expect((await app.inject({ method: 'POST', url: '/api/computers', payload: { name: 'Other', requestKey: crypto.randomUUID() } })).statusCode).toBe(503);
  } finally { await app.close(); await database.close(); }
});

it('retains failed and deleting records for safe retry after controller failures', async () => {
  const { app, database, calls, controller } = await fixture();
  try {
    controller.create = async () => { throw new Error('engine offline'); };
    const failed = await app.inject({ method: 'POST', url: '/api/computers', payload: { name: 'Failure', requestKey: crypto.randomUUID() } });
    expect(failed.statusCode).toBe(503);
    expect((await database.client.computer.findMany()).map(item => item.state)).toEqual(['failed']);
    expect(calls).toEqual([]);
  } finally { await app.close(); await database.close(); }
});
