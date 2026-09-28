import { expect, it, vi } from 'vitest';
import { join } from 'node:path';
import Fastify from 'fastify';
import { prepareDatabase } from '../test-database';
import { ComputerUseService, type ComputerRuntime } from './service';
import { createTerminalTools } from './terminal-tools';
import { registerComputerTerminalRoutes } from '../computer-terminal-routes';

it('requires a current claim for all eight tools; operator access neither acquires nor releases one', async () => {
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
  const args: Record<string, object> = {
    create: { name: 'build' },
    list: {},
    view: { session: crypto.randomUUID() },
    type: { session: crypto.randomUUID(), text: 'literal' },
    press: { session: crypto.randomUUID(), key: 'Enter' },
    interrupt: { session: crypto.randomUUID() },
    delete: { session: crypto.randomUUID() },
    status: { session: crypto.randomUUID() },
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
    expect(core.mock.calls).toHaveLength(10);
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
    expect(core.mock.calls).toHaveLength(12);
    await service.assign(agent.id, []);
    for (let i = 0; i < tools.length; i++) await expect(invoke(i)).rejects.toThrow(/use_computer/);
    await db.client.computer.update({ where: { id: computer.id }, data: { desiredState: 'exited' } });
    expect((await list()).statusCode).toBe(409);
  } finally {
    await app.close();
    await db.close();
  }
});
