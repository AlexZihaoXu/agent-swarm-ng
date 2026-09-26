import { expect, it } from 'vitest';
import { join } from 'node:path';
import { buildApp } from './app';
import { prepareDatabase } from './test-database';
import type { ComputerController, ComputerObservation } from './computer-controller-client';
import { ComputerStore, type ComputerSettings } from './computer-store';

async function fixture() {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const calls: string[] = [];
  const settingsCalls: ComputerSettings[] = [];
  const observed = new Map<string, ComputerObservation>();
  const controller: ComputerController = {
    async limits() { return { cpuCores: { min: 1, max: 8, default: 4 }, memoryGiB: { min: 1, max: 16, default: 4 }, timezoneDefault: 'America/Toronto' }; },
    async create(id, name, settings) { calls.push(`create:${id}:${name}`); settingsCalls.push(settings); observed.set(id, { status: 'running', cpuPercent: 12.5, memoryBytes: 134217728, memoryLimitBytes: settings.memoryGiB * 1024 ** 3, cpuCount: settings.cpuCores }); },
    async remove(id, name) { calls.push(`remove:${id}:${name}`); observed.delete(id); },
    async observe() { return observed; },
    async preview(id, full = false) { if (!observed.has(id)) return null; if (full) calls.push(`full-preview:${id}`); return Buffer.from([0xff, 0xd8, 0xff, 0xd9]); },
    async pointer(id, x, y) { calls.push(`pointer:${id}:${x}:${y}`); },
    async start(id, name) { calls.push(`start:${id}:${name}`); observed.set(id, { status: 'running', cpuPercent: 3, memoryBytes: 209715200, memoryLimitBytes: 4_294_967_296, cpuCount: 4 }); },
    async stop(id, name) { calls.push(`stop:${id}:${name}`); observed.set(id, { status: 'exited', cpuPercent: null, memoryBytes: null, memoryLimitBytes: null, cpuCount: null }); },
    async updateResources(id, name, settings) {
      calls.push(`update:${id}:${name}:${settings.cpuCores}:${settings.memoryGiB}`);
      const previous = observed.get(id)!;
      observed.set(id, { ...previous, cpuCount: settings.cpuCores, memoryLimitBytes: settings.memoryGiB * 1024 ** 3 });
    },
    async replaceStopped(id, name, settings) {
      calls.push(`replace:${id}:${name}:${settings.timezone}`);
      observed.set(id, { status: 'exited', cpuPercent: null, memoryBytes: null, memoryLimitBytes: null, cpuCount: null });
    },
  };
  const app = await buildApp({ database, computerController: controller });
  return { app, database, calls, settingsCalls, observed, controller };
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

it('offers detected host bounds and persists per-computer creation choices without changing defaults', async () => {
  const { app, database, settingsCalls } = await fixture();
  try {
    const limits = await app.inject({ method: 'GET', url: '/api/computers/settings-limits' });
    expect(limits.statusCode).toBe(200);
    expect(limits.json()).toMatchObject({ cpuCores: { max: 8, default: 4 }, memoryGiB: { max: 16, default: 4 }, timezoneDefault: 'America/Toronto' });
    const key = crypto.randomUUID();
    const payload = { name: 'Custom desk', requestKey: key, cpuCores: 3, memoryGiB: 6, timezone: 'Etc/UTC' };
    const created = await app.inject({ method: 'POST', url: '/api/computers', payload });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ cpuCores: 3, memoryGiB: 6, timezone: 'Etc/UTC', memoryLimitBytes: 6 * 1024 ** 3, cpuCount: 3 });
    expect(settingsCalls).toEqual([{ cpuCores: 3, memoryGiB: 6, timezone: 'Etc/UTC' }]);
    expect(await database.client.computer.findUnique({ where: { id: created.json().id } })).toMatchObject({ cpuCores: 3, memoryGiB: 6, timezone: 'Etc/UTC' });
    expect((await app.inject({ method: 'POST', url: '/api/computers', payload: { ...payload, memoryGiB: 7 } })).statusCode).toBe(409);
    for (const bad of [{ cpuCores: 9 }, { memoryGiB: 17 }, { cpuCores: 2.5 }, { timezone: '../etc/passwd' }, { timezone: 'Not/A/Zone' }]) {
      expect((await app.inject({ method: 'POST', url: '/api/computers', payload: { name: 'Bad desk', requestKey: crypto.randomUUID(), ...bad } })).statusCode).toBe(400);
    }
  } finally { await app.close(); await database.close(); }
});

it('edits an owned computer’s CPU and memory live but never silently changes its timezone', async () => {
  const { app, database, calls } = await fixture();
  try {
    const created = await app.inject({ method: 'POST', url: '/api/computers', payload: { name: 'Editable desk', requestKey: crypto.randomUUID() } });
    const id = created.json().id as string;
    const saved = await app.inject({ method: 'PATCH', url: `/api/computers/${id}/settings`, payload: { cpuCores: 2, memoryGiB: 6, timezone: 'America/Toronto' } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ cpuCores: 2, memoryGiB: 6, timezone: 'America/Toronto', cpuCount: 2, memoryLimitBytes: 6 * 1024 ** 3 });
    expect(calls).toContain(`update:${id}:Editable desk:2:6`);
    expect(await database.client.computer.findUnique({ where: { id } })).toMatchObject({ cpuCores: 2, memoryGiB: 6, timezone: 'America/Toronto' });
    const timezone = await app.inject({ method: 'PATCH', url: `/api/computers/${id}/settings`, payload: { cpuCores: 2, memoryGiB: 6, timezone: 'Etc/UTC' } });
    expect(timezone.statusCode).toBe(409);
    expect(timezone.json().message).toMatch(/replacement|restart/i);
    expect(calls.filter(call => call.startsWith('update:'))).toHaveLength(1);
    const replacementUrl = `/api/computers/${id}/settings/replacement`;
    const replacement = { cpuCores: 2, memoryGiB: 6, timezone: 'Etc/UTC', confirmReplacement: true };
    expect((await app.inject({ method: 'POST', url: replacementUrl, payload: replacement })).statusCode).toBe(409);
    await app.inject({ method: 'POST', url: `/api/computers/${id}/power`, payload: { action: 'stop' } });
    expect((await app.inject({ method: 'POST', url: replacementUrl, payload: { ...replacement, confirmReplacement: false } })).statusCode).toBe(400);
    const replaced = await app.inject({ method: 'POST', url: replacementUrl, payload: replacement });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json()).toMatchObject({ state: 'exited', cpuCores: 2, memoryGiB: 6, timezone: 'Etc/UTC' });
    expect(calls).toContain(`replace:${id}:Editable desk:Etc/UTC`);
    expect(await database.client.computer.findUnique({ where: { id } })).toMatchObject({ timezone: 'Etc/UTC', desiredState: 'stopped' });
  } finally { await app.close(); await database.close(); }
});

it('powers a computer off and on, remembering the operator intent', async () => {
  const { app, calls, observed } = await fixture();
  try {
    const created = await app.inject({ method: 'POST', url: '/api/computers', payload: { name: 'Power desk', requestKey: crypto.randomUUID() } });
    const id = created.json().id as string;
    expect(observed.get(id)?.status).toBe('running');
    const stopped = await app.inject({ method: 'POST', url: `/api/computers/${id}/power`, payload: { action: 'stop' } });
    expect(stopped.statusCode).toBe(202);
    expect(stopped.json()).toMatchObject({ accepted: true, action: 'stop', desiredState: 'stopped' });
    expect(calls).toContain(`stop:${id}:Power desk`);
    expect((await app.inject({ method: 'GET', url: '/api/computers' })).json().computers[0]).toMatchObject({ state: 'exited', cpuPercent: null });
    const started = await app.inject({ method: 'POST', url: `/api/computers/${id}/power`, payload: { action: 'start' } });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toMatchObject({ action: 'start', desiredState: 'running' });
    expect(calls).toContain(`start:${id}:Power desk`);
    expect((await app.inject({ method: 'GET', url: '/api/computers' })).json().computers[0].state).toBe('running');
  } finally { await app.close(); }
});

it('refuses an unknown power action, an unknown computer, and one still being created', async () => {
  const { app, calls, database } = await fixture();
  try {
    const created = await app.inject({ method: 'POST', url: '/api/computers', payload: { name: 'Guarded desk', requestKey: crypto.randomUUID() } });
    const id = created.json().id as string;
    expect((await app.inject({ method: 'POST', url: `/api/computers/${id}/power`, payload: { action: 'reboot' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/computers/${crypto.randomUUID()}/power`, payload: { action: 'stop' } })).statusCode).toBe(404);
    const pending = await database.client.computer.create({ data: { name: 'Half built', requestKey: crypto.randomUUID(), state: 'creating' } });
    expect((await app.inject({ method: 'POST', url: `/api/computers/${pending.id}/power`, payload: { action: 'stop' } })).statusCode).toBe(409);
    // Every refusal above happens before any Docker call.
    expect(calls.filter(call => call.startsWith('stop:') || call.startsWith('start:'))).toHaveLength(0);
  } finally { await app.close(); }
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
    observed.set(live.id, { status: 'running', cpuPercent: 1, memoryBytes: 123, memoryLimitBytes: 4_294_967_296, cpuCount: 4 });
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
