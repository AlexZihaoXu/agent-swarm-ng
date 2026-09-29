import { expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { buildApp } from './app';
import { prepareDatabase } from './test-database';
import type { ComputerController, ComputerObservation } from './computer-controller-client';
import { ComputerStore, type ComputerSettings } from './computer-store';

async function fixture() {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const calls: string[] = [];
  const settingsCalls: ComputerSettings[] = [];
  const limitCalls: (number | undefined)[] = [];
  const observed = new Map<string, ComputerObservation>();
  const controller: ComputerController = {
    async limits() {
      return {
        cpuCores: { min: 1, max: 8, default: 4 },
        memoryGiB: { min: 1, max: 16, default: 4 },
        timezoneDefault: 'America/Toronto',
      };
    },
    async create(id, name, settings, maxComputers) {
      calls.push(`create:${id}:${name}`);
      limitCalls.push(maxComputers);
      settingsCalls.push(settings);
      observed.set(id, {
        status: 'running',
        cpuPercent: 12.5,
        memoryBytes: 134217728,
        memoryLimitBytes: settings.memoryGiB * 1024 ** 3,
        cpuCount: settings.cpuCores,
      });
    },
    async remove(id, name) {
      calls.push(`remove:${id}:${name}`);
      observed.delete(id);
    },
    async observe() {
      return observed;
    },
    async preview(id, full = false) {
      if (!observed.has(id)) return null;
      if (full) calls.push(`full-preview:${id}`);
      return Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    },
    async pointer(id, x, y) {
      calls.push(`pointer:${id}:${x}:${y}`);
    },
    async start(id, name) {
      calls.push(`start:${id}:${name}`);
      observed.set(id, {
        status: 'running',
        cpuPercent: 3,
        memoryBytes: 209715200,
        memoryLimitBytes: 4_294_967_296,
        cpuCount: 4,
      });
    },
    async stop(id, name) {
      calls.push(`stop:${id}:${name}`);
      observed.set(id, {
        status: 'exited',
        cpuPercent: null,
        memoryBytes: null,
        memoryLimitBytes: null,
        cpuCount: null,
      });
    },
    async updateResources(id, name, settings) {
      calls.push(`update:${id}:${name}:${settings.cpuCores}:${settings.memoryGiB}`);
      const previous = observed.get(id)!;
      observed.set(id, { ...previous, cpuCount: settings.cpuCores, memoryLimitBytes: settings.memoryGiB * 1024 ** 3 });
    },
    async replaceStopped(id, name, settings) {
      calls.push(`replace:${id}:${name}:${settings.timezone}`);
      observed.set(id, {
        status: 'exited',
        cpuPercent: null,
        memoryBytes: null,
        memoryLimitBytes: null,
        cpuCount: null,
      });
    },
  };
  const app = await buildApp({ database, computerController: controller });
  return { app, database, calls, settingsCalls, limitCalls, observed, controller };
}

it('creates one platform computer, lists status/usage and serves its bounded JPEG without granting agents tools', async () => {
  const { app, database, calls, limitCalls } = await fixture();
  try {
    const requestKey = crypto.randomUUID();
    const create = await app.inject({
      method: 'POST',
      url: '/api/computers',
      payload: { name: 'My computer', requestKey },
    });
    expect(create.statusCode).toBe(201);
    const computer = create.json();
    expect(computer).toMatchObject({ name: 'My computer', state: 'running', cpuPercent: 12.5, memoryBytes: 134217728 });
    const retry = await app.inject({
      method: 'POST',
      url: '/api/computers',
      payload: { name: 'My computer', requestKey },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().id).toBe(computer.id);
    expect(calls).toEqual([`create:${computer.id}:My computer`]);
    expect(limitCalls).toEqual([4]); // the Settings → Swarm limit travels with the create
    expect((await app.inject({ method: 'GET', url: '/api/computers' })).json()).toEqual({
      computers: [computer],
      controllerConnected: true,
    });
    const image = await app.inject({ method: 'GET', url: `/api/computers/${computer.id}/preview` });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toContain('image/jpeg');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    expect(image.headers['cache-control']).toBe('no-store');
    expect(image.rawPayload).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    expect(await database.client.agent.count()).toBe(0);
  } finally {
    await app.close();
    await database.close();
  }
});

it('offers detected host bounds and persists per-computer creation choices without changing defaults', async () => {
  const { app, database, settingsCalls } = await fixture();
  try {
    const limits = await app.inject({ method: 'GET', url: '/api/computers/settings-limits' });
    expect(limits.statusCode).toBe(200);
    expect(limits.json()).toMatchObject({
      cpuCores: { max: 8, default: 4 },
      memoryGiB: { max: 16, default: 4 },
      timezoneDefault: 'America/Toronto',
    });
    const key = crypto.randomUUID();
    const payload = { name: 'Custom desk', requestKey: key, cpuCores: 3, memoryGiB: 6, timezone: 'Etc/UTC' };
    const created = await app.inject({ method: 'POST', url: '/api/computers', payload });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      cpuCores: 3,
      memoryGiB: 6,
      timezone: 'Etc/UTC',
      memoryLimitBytes: 6 * 1024 ** 3,
      cpuCount: 3,
    });
    expect(settingsCalls).toEqual([{ cpuCores: 3, memoryGiB: 6, timezone: 'Etc/UTC' }]);
    expect(await database.client.computer.findUnique({ where: { id: created.json().id } })).toMatchObject({
      cpuCores: 3,
      memoryGiB: 6,
      timezone: 'Etc/UTC',
    });
    expect(
      (await app.inject({ method: 'POST', url: '/api/computers', payload: { ...payload, memoryGiB: 7 } })).statusCode,
    ).toBe(409);
    for (const bad of [
      { cpuCores: 9 },
      { memoryGiB: 17 },
      { cpuCores: 2.5 },
      { timezone: '../etc/passwd' },
      { timezone: 'Not/A/Zone' },
    ]) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/computers',
            payload: { name: 'Bad desk', requestKey: crypto.randomUUID(), ...bad },
          })
        ).statusCode,
      ).toBe(400);
    }
  } finally {
    await app.close();
    await database.close();
  }
});

it('edits an owned computer’s CPU and memory live but never silently changes its timezone', async () => {
  const { app, database, calls } = await fixture();
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/computers',
      payload: { name: 'Editable desk', requestKey: crypto.randomUUID() },
    });
    const id = created.json().id as string;
    const saved = await app.inject({
      method: 'PATCH',
      url: `/api/computers/${id}/settings`,
      payload: { cpuCores: 2, memoryGiB: 6, timezone: 'America/Toronto' },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      cpuCores: 2,
      memoryGiB: 6,
      timezone: 'America/Toronto',
      cpuCount: 2,
      memoryLimitBytes: 6 * 1024 ** 3,
    });
    expect(calls).toContain(`update:${id}:Editable desk:2:6`);
    expect(await database.client.computer.findUnique({ where: { id } })).toMatchObject({
      cpuCores: 2,
      memoryGiB: 6,
      timezone: 'America/Toronto',
    });
    const timezone = await app.inject({
      method: 'PATCH',
      url: `/api/computers/${id}/settings`,
      payload: { cpuCores: 2, memoryGiB: 6, timezone: 'Etc/UTC' },
    });
    expect(timezone.statusCode).toBe(409);
    expect(timezone.json().message).toMatch(/replacement|restart/i);
    expect(calls.filter(call => call.startsWith('update:'))).toHaveLength(1);
    const replacementUrl = `/api/computers/${id}/settings/replacement`;
    const replacement = { cpuCores: 2, memoryGiB: 6, timezone: 'Etc/UTC', confirmReplacement: true };
    expect((await app.inject({ method: 'POST', url: replacementUrl, payload: replacement })).statusCode).toBe(409);
    await app.inject({ method: 'POST', url: `/api/computers/${id}/power`, payload: { action: 'stop' } });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: replacementUrl,
          payload: { ...replacement, confirmReplacement: false },
        })
      ).statusCode,
    ).toBe(400);
    const replaced = await app.inject({ method: 'POST', url: replacementUrl, payload: replacement });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json()).toMatchObject({ state: 'exited', cpuCores: 2, memoryGiB: 6, timezone: 'Etc/UTC' });
    expect(calls).toContain(`replace:${id}:Editable desk:Etc/UTC`);
    expect(await database.client.computer.findUnique({ where: { id } })).toMatchObject({
      timezone: 'Etc/UTC',
      desiredState: 'stopped',
    });
  } finally {
    await app.close();
    await database.close();
  }
});

it('powers a computer off and on, remembering the operator intent', async () => {
  const { app, calls, observed } = await fixture();
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/computers',
      payload: { name: 'Power desk', requestKey: crypto.randomUUID() },
    });
    const id = created.json().id as string;
    expect(observed.get(id)?.status).toBe('running');
    const stopped = await app.inject({
      method: 'POST',
      url: `/api/computers/${id}/power`,
      payload: { action: 'stop' },
    });
    expect(stopped.statusCode).toBe(202);
    expect(stopped.json()).toMatchObject({ accepted: true, action: 'stop', desiredState: 'stopped' });
    expect(calls).toContain(`stop:${id}:Power desk`);
    expect((await app.inject({ method: 'GET', url: '/api/computers' })).json().computers[0]).toMatchObject({
      state: 'exited',
      cpuPercent: null,
    });
    const started = await app.inject({
      method: 'POST',
      url: `/api/computers/${id}/power`,
      payload: { action: 'start' },
    });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toMatchObject({ action: 'start', desiredState: 'running' });
    expect(calls).toContain(`start:${id}:Power desk`);
    expect((await app.inject({ method: 'GET', url: '/api/computers' })).json().computers[0].state).toBe('running');
  } finally {
    await app.close();
  }
});

it('refuses an unknown power action, an unknown computer, and one still being created', async () => {
  const { app, calls, database } = await fixture();
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/computers',
      payload: { name: 'Guarded desk', requestKey: crypto.randomUUID() },
    });
    const id = created.json().id as string;
    expect(
      (await app.inject({ method: 'POST', url: `/api/computers/${id}/power`, payload: { action: 'reboot' } }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/computers/${crypto.randomUUID()}/power`,
          payload: { action: 'stop' },
        })
      ).statusCode,
    ).toBe(404);
    const pending = await database.client.computer.create({
      data: { name: 'Half built', requestKey: crypto.randomUUID(), state: 'creating' },
    });
    expect(
      (await app.inject({ method: 'POST', url: `/api/computers/${pending.id}/power`, payload: { action: 'stop' } }))
        .statusCode,
    ).toBe(409);
    // Every refusal above happens before any Docker call.
    expect(calls.filter(call => call.startsWith('stop:') || call.startsWith('start:'))).toHaveLength(0);
  } finally {
    await app.close();
  }
});

it('limits first-run desktop input to an existing running computer and normalized coordinates', async () => {
  const { app, database, calls } = await fixture();
  try {
    const row = (
      await app.inject({
        method: 'POST',
        url: '/api/computers',
        payload: { name: 'Desk', requestKey: crypto.randomUUID() },
      })
    ).json();
    const path = `/api/computers/${row.id}/desktop/input`;
    for (const payload of [
      { x: -0.1, y: 0.5 },
      { x: 1.1, y: 0 },
      { x: 0.5, y: '3' },
    ]) {
      expect((await app.inject({ method: 'POST', url: path, payload })).statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/computers/not-a-computer/desktop/input',
          payload: { x: 0.5, y: 0.5 },
        })
      ).statusCode,
    ).toBe(404);
    expect(calls.filter(call => call.startsWith('pointer:'))).toEqual([]);
    const accepted = await app.inject({ method: 'POST', url: path, payload: { x: 0.65, y: 0.43 } });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toEqual({ accepted: true });
    expect(calls).toContain(`pointer:${row.id}:0.65:0.43`);
    // Fastify strips extra JSON keys; they never become command arguments.
    const extra = await app.inject({ method: 'POST', url: path, payload: { x: 0.5, y: 0.5, command: 'shell' } });
    expect(extra.statusCode).toBe(202);
    expect(calls.filter(call => call.startsWith('pointer:'))).toEqual([
      `pointer:${row.id}:0.65:0.43`,
      `pointer:${row.id}:0.5:0.5`,
    ]);
    const full = await app.inject({ method: 'GET', url: `/api/computers/${row.id}/preview?full=1` });
    expect(full.statusCode).toBe(200);
    expect(full.headers['x-content-type-options']).toBe('nosniff');
    expect(calls).toContain(`full-preview:${row.id}`);
    expect((await app.inject({ method: 'GET', url: `/api/computers/${row.id}/preview?full=other` })).statusCode).toBe(
      400,
    );
    await database.client.computer.update({ where: { id: row.id }, data: { state: 'failed' } });
    expect((await app.inject({ method: 'POST', url: path, payload: { x: 0.5, y: 0.5 } })).statusCode).toBe(503);
  } finally {
    await app.close();
    await database.close();
  }
});

it('validates exact-name deletion on the backend and never calls Docker for invalid or foreign requests', async () => {
  const { app, database, calls } = await fixture();
  try {
    const key = crypto.randomUUID();
    expect(
      (await app.inject({ method: 'POST', url: '/api/computers', payload: { name: '   ', requestKey: key } }))
        .statusCode,
    ).toBe(400);
    const created = (
      await app.inject({ method: 'POST', url: '/api/computers', payload: { name: 'Example', requestKey: key } })
    ).json();
    expect(
      (await app.inject({ method: 'POST', url: '/api/computers', payload: { name: 'Other', requestKey: key } }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/computers/${created.id}`,
          payload: { confirmation: 'example' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/computers/foreign', payload: { confirmation: 'Example' } }))
        .statusCode,
    ).toBe(404);
    expect(calls).toEqual([`create:${created.id}:Example`]);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/computers/${created.id}`,
          payload: { confirmation: 'Example' },
        })
      ).statusCode,
    ).toBe(200);
    expect(calls).toContain(`remove:${created.id}:Example`);
    expect(await database.client.computer.count()).toBe(0);
  } finally {
    await app.close();
    await database.close();
  }
});

it('treats two identically confirmed concurrent deletes as one completed effect', async () => {
  const { app, database, controller } = await fixture();
  try {
    const row = (
      await app.inject({
        method: 'POST',
        url: '/api/computers',
        payload: { name: 'Concurrent', requestKey: crypto.randomUUID() },
      })
    ).json();
    const remove = controller.remove;
    controller.remove = async (id, name) => {
      await new Promise(resolve => setTimeout(resolve, 20));
      return remove(id, name);
    };
    const results = await Promise.all(
      [1, 2].map(() =>
        app.inject({ method: 'DELETE', url: `/api/computers/${row.id}`, payload: { confirmation: 'Concurrent' } }),
      ),
    );
    expect(results.map(result => result.statusCode)).toEqual([200, 200]);
    expect(await database.client.computer.count()).toBe(0);
  } finally {
    await app.close();
    await database.close();
  }
});

it('reconciles a crash between Docker creation and a saved status, and unlocks stale partial creates', async () => {
  const { app, database, observed } = await fixture();
  try {
    const store = new ComputerStore(database);
    const live = (await store.reserve('Recovered', crypto.randomUUID())).computer;
    observed.set(live.id, {
      status: 'running',
      cpuPercent: 1,
      memoryBytes: 123,
      memoryLimitBytes: 4_294_967_296,
      cpuCount: 4,
    });
    const first = (await app.inject({ method: 'GET', url: '/api/computers' })).json();
    expect(first.computers[0]).toMatchObject({ id: live.id, state: 'running' });
    const partial = (await store.reserve('Partial', crypto.randomUUID())).computer;
    await database.client.computer.update({
      where: { id: partial.id },
      data: { createdAt: new Date(Date.now() - 180_000) },
    });
    const second = (await app.inject({ method: 'GET', url: '/api/computers' })).json();
    expect(second.computers.find((item: { id: string }) => item.id === partial.id)).toMatchObject({ state: 'failed' });
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/computers/${partial.id}`,
          payload: { confirmation: 'Partial' },
        })
      ).statusCode,
    ).toBe(200);
  } finally {
    await app.close();
    await database.close();
  }
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
    expect(response.json()).toMatchObject({
      controllerConnected: false,
      computers: [{ id: computer.id, name: 'Kept machine', state: 'unavailable', cpuPercent: null, memoryBytes: null }],
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/computers',
          payload: { name: 'Other', requestKey: crypto.randomUUID() },
        })
      ).statusCode,
    ).toBe(503);
  } finally {
    await app.close();
    await database.close();
  }
});

it('retains failed and deleting records for safe retry after controller failures', async () => {
  const { app, database, calls, controller } = await fixture();
  try {
    controller.create = async () => {
      throw new Error('engine offline');
    };
    const failed = await app.inject({
      method: 'POST',
      url: '/api/computers',
      payload: { name: 'Failure', requestKey: crypto.randomUUID() },
    });
    expect(failed.statusCode).toBe(503);
    expect((await database.client.computer.findMany()).map(item => item.state)).toEqual(['failed']);
    expect(calls).toEqual([]);
  } finally {
    await app.close();
    await database.close();
  }
});

it("reports the controller's own refusal and leaves no stray record when a create is rejected before anything exists", async () => {
  const { createServer } = await import('node:http');
  const { HttpComputerController } = await import('./computer-controller-client');
  let refusal = { status: 409, message: 'Computer limit reached.' };
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/computers/settings-limits')
      return void response.end(
        JSON.stringify({
          cpuCores: { min: 1, max: 8, default: 2 },
          memoryGiB: { min: 1, max: 16, default: 4 },
          timezoneDefault: 'UTC',
        }),
      );
    if (request.url === '/computers' && request.method === 'GET')
      return void response.end(JSON.stringify({ computers: [] }));
    response.statusCode = refusal.status;
    response.end(JSON.stringify({ message: refusal.message }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const app = await buildApp({
    database,
    computerController: new HttpComputerController(`http://127.0.0.1:${(server.address() as { port: number }).port}`),
  });
  try {
    const capped = await app.inject({
      method: 'POST',
      url: '/api/computers',
      payload: { name: 'Fifth', requestKey: crypto.randomUUID() },
    });
    expect(capped.statusCode).toBe(409);
    expect(capped.json().message).toBe('Computer limit reached.');
    expect(await database.client.computer.count()).toBe(0); // the name is not held by a failed record
    refusal = { status: 503, message: 'Build the approved computer images before creating computers.' };
    const missing = await app.inject({
      method: 'POST',
      url: '/api/computers',
      payload: { name: 'NoImages', requestKey: crypto.randomUUID() },
    });
    expect(missing.statusCode).toBe(503);
    expect(missing.json().message).toBe('Build the approved computer images before creating computers.');
    expect((await database.client.computer.findMany()).map(row => row.state)).toEqual(['failed']); // may have partially created: kept for cleanup
  } finally {
    await app.close();
    await new Promise(resolve => server.close(resolve));
  }
});

it('does not fail a slow create while the controller is unreachable', async () => {
  const { app, database, controller } = await fixture();
  try {
    const partial = (await new ComputerStore(database).reserve('Slow', crypto.randomUUID())).computer;
    await database.client.computer.update({
      where: { id: partial.id },
      data: { createdAt: new Date(Date.now() - 180_000) },
    });
    const outage = vi.spyOn(controller, 'observe').mockRejectedValue(new Error('controller down'));
    const during = (await app.inject({ method: 'GET', url: '/api/computers' })).json();
    expect(during.controllerConnected).toBe(false);
    expect(during.computers[0]).toMatchObject({ id: partial.id, state: 'creating' }); // unknown, not failed
    outage.mockRestore();
    const after = (await app.inject({ method: 'GET', url: '/api/computers' })).json();
    expect(after.computers[0]).toMatchObject({ id: partial.id, state: 'failed' }); // controller answered and has no such container
  } finally {
    await app.close();
    await database.close();
  }
});

it('marks a computer as deleting before releasing its holder, so nobody can claim it in between', async () => {
  const { database, controller } = await fixture();
  const states: string[] = [];
  const runtime = {
    async cancel(id: string) {
      states.push((await database.client.computer.findUnique({ where: { id } }))!.state);
    },
    capture: async () => {
      throw new Error('unused');
    },
    execute: async () => {
      throw new Error('unused');
    },
  };
  const app = await buildApp({ database, computerController: { ...controller, runtime } });
  try {
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/computers',
        payload: { name: 'Held', requestKey: crypto.randomUUID() },
      })
    ).json();
    const agent = await database.createAgent({ name: 'Holder', endpointId: 'e', model: 'm', thinkingLevel: 'off' });
    await database.client.computerAssignment.create({ data: { agentId: agent.id, computerId: created.id } });
    await database.client.computerClaim.create({ data: { agentId: agent.id, computerId: created.id } });
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/computers/${created.id}`,
      payload: { confirmation: 'Held' },
    });
    expect(removed.statusCode).toBe(200);
    expect(states).toContain('deleting'); // the release ran while the computer could no longer be claimed
    expect(states.every(state => state === 'deleting')).toBe(true);
    expect(await database.client.computerClaim.count()).toBe(0);
  } finally {
    await app.close();
  }
});

it('sends the shared secret on every controller call, HTTP and WebSocket, and omits it when none is configured', async () => {
  const { createServer } = await import('node:http');
  const { HttpComputerController } = await import('./computer-controller-client');
  const { fetchComputerFile } = await import('./computer-files');
  const seen: { what: string; token: string | undefined }[] = [];
  const server = createServer((request, response) => {
    seen.push({
      what: `${request.method} ${request.url}`,
      token: request.headers['x-controller-token'] as string | undefined,
    });
    response.setHeader('content-type', request.url?.includes('preview') ? 'image/jpeg' : 'application/json');
    response.end(
      request.url?.includes('preview')
        ? Buffer.from([0xff, 0xd8, 0xff, 0xd9])
        : JSON.stringify({ computers: [], started: true, settled: true, valid: true, validationToken: 'x' }),
    );
  });
  server.on('upgrade', (request, socket) => {
    seen.push({ what: 'UPGRADE', token: request.headers['x-controller-token'] as string | undefined });
    socket.destroy();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const previous = process.env.COMPUTER_CONTROLLER_TOKEN;
  try {
    process.env.COMPUTER_CONTROLLER_TOKEN = 'shared-secret';
    const controller = new HttpComputerController(base);
    const id = '4a18018a-4689-4fa5-86ca-4dc080d41fb4';
    await controller.observe();
    await controller.preview(id);
    await controller.runtime.cancel(id).catch(() => {});
    await fetchComputerFile(fetch, base, id, 'files', { path: '/workspace' }).catch(() => {});
    const socket = controller.terminalSocket!(id, id);
    socket.onerror = () => {};
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(seen.length).toBeGreaterThanOrEqual(5);
    expect(seen.map(entry => entry.token)).toEqual(seen.map(() => 'shared-secret'));
    expect(seen.map(entry => entry.what.split(' ')[0])).toEqual(expect.arrayContaining(['GET', 'POST', 'UPGRADE']));
    seen.length = 0;
    delete process.env.COMPUTER_CONTROLLER_TOKEN;
    await new HttpComputerController(base).observe();
    expect(seen[0].token).toBeUndefined();
  } finally {
    if (previous === undefined) delete process.env.COMPUTER_CONTROLLER_TOKEN;
    else process.env.COMPUTER_CONTROLLER_TOKEN = previous;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

it('tells the dashboard which computers are portal-free X11 and what the computer cap is', async () => {
  const { app, database, observed, controller } = await fixture();
  try {
    const store = new ComputerStore(database);
    const x11 = (await store.reserve('X11 desk', crypto.randomUUID())).computer,
      wayland = (await store.reserve('Wayland desk', crypto.randomUUID())).computer;
    await store.markRunning(x11.id);
    await store.markRunning(wayland.id);
    const base = { status: 'running', cpuPercent: 1, memoryBytes: 1, memoryLimitBytes: 4_294_967_296, cpuCount: 2 };
    observed.set(x11.id, { ...base, displayServer: 'x11' });
    observed.set(wayland.id, { ...base, displayServer: 'wayland' });
    const listed = (await app.inject({ method: 'GET', url: '/api/computers' })).json().computers as {
      id: string;
      portalFree: boolean | null;
    }[];
    expect(listed.find(row => row.id === x11.id)!.portalFree).toBe(true);
    expect(listed.find(row => row.id === wayland.id)!.portalFree).toBe(false);
    vi.spyOn(controller, 'observe').mockRejectedValue(new Error('down'));
    expect(
      (await app.inject({ method: 'GET', url: '/api/computers' }))
        .json()
        .computers.every((row: { portalFree: unknown }) => row.portalFree === null),
    ).toBe(true); // unknown offline
    vi.spyOn(controller, 'limits').mockResolvedValue({
      cpuCores: { min: 1, max: 8, default: 2 },
      memoryGiB: { min: 1, max: 16, default: 4 },
      timezoneDefault: 'UTC',
    });
    // The computer count comes from Settings → Swarm, not the controller.
    expect((await app.inject({ method: 'GET', url: '/api/computers/settings-limits' })).json().maxComputers).toBe(4);
    await app.inject({ method: 'PATCH', url: '/api/settings/swarm', payload: { maxComputers: 7 } });
    expect((await app.inject({ method: 'GET', url: '/api/computers/settings-limits' })).json().maxComputers).toBe(7);
  } finally {
    await app.close();
    await database.close();
  }
});
