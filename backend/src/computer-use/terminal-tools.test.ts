import { expect, it, vi } from 'vitest';
import { join } from 'node:path';
import Fastify from 'fastify';
import { prepareDatabase } from '../test-database';
import { ComputerUseError, ComputerUseService, type ComputerRuntime } from './service';
import { createTerminalTools } from './terminal-tools';
import { registerComputerTerminalRoutes } from '../computer-terminal-routes';

it('requires a current claim for every terminal tool; operator access neither acquires nor releases one', async () => {
  const db = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const agent = await db.createAgent({ name: 'A', endpointId: 'mock', model: 'model', thinkingLevel: 'off' });
  const computer = await db.client.computer.create({
    data: { name: 'Desk', requestKey: crypto.randomUUID(), state: 'running' },
  });
  const core = vi.fn(async () => ({
    started: true,
    settled: true as const,
    result: { type: 'terminal', sessions: [] },
  }));
  const cancel = vi.fn(async () => {});
  const runtime: ComputerRuntime = {
    capture: async () => ({ mimeType: 'image/jpeg', data: new Uint8Array(), width: 1, height: 1, bounds: [] }),
    execute: async () => ({ started: true, completed: 1, error: null }),
    prepareCore: async (_id, request) => request,
    core,
    cancel,
  };
  const service = new ComputerUseService(db, runtime);
  const tools = createTerminalTools(service, agent.id);
  const viewed = crypto.randomUUID();
  const args: Record<string, object> = {
    create: { name: 'build' },
    list: {},
    view: { session: viewed },
    delete: { session: crypto.randomUUID() },
    status: { session: crypto.randomUUID() },
    resize: { session: crypto.randomUUID(), columns: 100, rows: 30 },
    run_actions: { session: viewed, actions: [{ name: 'keyboard.press', params: { key: 'Enter' } }] },
  };
  const invoke = (i: number) => tools[i].execute('call', Object.values(args)[i], undefined, undefined, {} as any);
  const app = Fastify();
  registerComputerTerminalRoutes(app, service);
  try {
    expect(tools.map(t => t.name)).toEqual(Object.keys(args).map(name => `terminal_${name}`));
    await service.assign(agent.id, [computer.id]);
    for (let i = 0; i < tools.length; i++) await expect(invoke(i)).rejects.toThrow(/use_computer/);
    expect(core).not.toHaveBeenCalled();
    const list = () =>
      app.inject({ method: 'POST', url: `/api/computers/${computer.id}/terminals`, payload: { operation: 'list' } });
    expect((await list()).statusCode).toBe(200);
    expect(await db.client.computerClaim.count()).toBe(0);
    // Default Fastify/Ajv must not strip session while trying the create/list union branches.
    const snapshot = await app.inject({
      method: 'POST',
      url: `/api/computers/${computer.id}/terminals`,
      payload: { operation: 'view', session: crypto.randomUUID() },
    });
    expect(snapshot.statusCode).toBe(200);
    await service.use(agent.id, computer.id);
    for (let i = 0; i < tools.length; i++) await invoke(i);
    expect(core.mock.calls).toHaveLength(9);
    await service.capture(agent.id, {});
    await list();
    await service.run(agent.id, {}); // readonly human snapshots preserve GUI allowance
    await service.operatorTerminal(computer.id, { operation: 'type', session: crypto.randomUUID(), text: 'x' });
    await expect(service.run(agent.id, {})).rejects.toThrow(/look/i);
    expect((await db.client.computerClaim.findUnique({ where: { computerId: computer.id } }))?.agentId).toBe(agent.id);
    const malformed = await app.inject({
      method: 'POST',
      url: `/api/computers/${computer.id}/terminals`,
      payload: { operation: 'list', computerId: 'host' },
    });
    expect(malformed.statusCode).toBe(400);
    const restart = new ComputerUseService(db, runtime);
    await restart.ready();
    expect(cancel).toHaveBeenCalled();
    await expect(restart.core(agent.id, { kind: 'terminal', operation: 'list' })).rejects.toThrow(/use_computer/);
    // Restart releases claims only, never sends terminal delete/interrupt or fabricates restored processes.
    expect(core.mock.calls).toHaveLength(11);
    await service.assign(agent.id, []);
    for (let i = 0; i < tools.length; i++) await expect(invoke(i)).rejects.toThrow(/use_computer/);
    await db.client.computer.update({ where: { id: computer.id }, data: { desiredState: 'exited' } });
    expect((await list()).statusCode).toBe(409);
  } finally {
    await app.close();
    await db.close();
  }
});

it('terminal_view accepts a bounded scroll window and rejects anything larger', async () => {
  const { Value } = await import('@sinclair/typebox/value');
  const { terminalParameters } = await import('./terminal-tools');
  const session = crypto.randomUUID();
  for (const extra of [{}, { rows: 1 }, { rows: 200, up: 10000 }, { up: 0 }])
    expect(Value.Check(terminalParameters.view, { session, ...extra })).toBe(true);
  for (const extra of [{ rows: 0 }, { rows: 201 }, { up: -1 }, { up: 10001 }, { rows: 1.5 }, { scroll: 'up' }])
    expect(Value.Check(terminalParameters.view, { session, ...extra })).toBe(false);
});

it('a terminal view allows five combos on that session for 90 real seconds; invalid combos spend nothing', async () => {
  const db = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const agent = await db.createAgent({ name: 'A', endpointId: 'mock', model: 'model', thinkingLevel: 'off' });
  const computer = await db.client.computer.create({
    data: { name: 'Desk', requestKey: crypto.randomUUID(), state: 'running' },
  });
  let clock = 0;
  let reject = false;
  const core = vi.fn(async (_id: string, request: any) => ({
    started: true,
    settled: true as const,
    result: { type: 'terminal', operation: request.operation },
  }));
  const runtime: ComputerRuntime = {
    capture: async () => ({ mimeType: 'image/jpeg', data: new Uint8Array(), width: 1, height: 1, bounds: [] }),
    execute: async () => ({ started: true, completed: 1, error: null }),
    prepareCore: async (_id, request) => {
      if (reject) throw new ComputerUseError('This combo would take 40.0 seconds.', 400);
      return request;
    },
    core,
    cancel: async () => {},
  };
  const service = new ComputerUseService(db, runtime, () => clock);
  const session = crypto.randomUUID();
  const combo = (target = session) =>
    service.terminalActions(agent.id, {
      kind: 'terminal',
      operation: 'actions',
      session: target,
      actions: [
        { type: 'type', text: 'ls', cpm: 'instant' },
        { type: 'press', key: 'Enter' },
      ],
    });
  try {
    await service.assign(agent.id, [computer.id]);
    await service.use(agent.id, computer.id);
    await expect(combo()).rejects.toThrow(/View this terminal first/);
    await service.terminalView(agent.id, { kind: 'terminal', operation: 'view', session } as any);
    await expect(combo(crypto.randomUUID())).rejects.toThrow(/View this terminal first/);
    reject = true;
    await expect(combo()).rejects.toThrow(/40.0 seconds/);
    reject = false;
    for (let i = 0; i < 5; i++) await combo();
    await expect(combo()).rejects.toThrow(/View this terminal first/);
    await service.terminalView(agent.id, { kind: 'terminal', operation: 'view', session } as any);
    clock += 90_001;
    await expect(combo()).rejects.toThrow(/View this terminal first/);
    expect(core.mock.calls.filter(([, request]: any) => request.operation === 'actions')).toHaveLength(5);
  } finally {
    await db.close();
  }
});
