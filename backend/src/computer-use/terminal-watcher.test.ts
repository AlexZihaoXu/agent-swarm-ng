import { expect, it } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from '../test-database';
import { ComputerUseService, type ComputerRuntime } from './service';
import { TerminalWatcher } from './terminal-watcher';

it('tells the holder when a terminal exits or is closed by someone else, but not about its own deletes', async () => {
  const db = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const agent = await db.createAgent({ name: 'A', endpointId: 'mock', model: 'model', thinkingLevel: 'off' });
  const computer = await db.client.computer.create({
    data: { name: 'Desk', requestKey: crypto.randomUUID(), state: 'running' },
  });
  const [build, server, scratch] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  let sessions: { id: string; name: string; alive: boolean; exitCode: number | null }[] = [
    { id: build, name: 'build', alive: true, exitCode: null },
    { id: server, name: 'server', alive: true, exitCode: null },
    { id: scratch, name: 'scratch', alive: true, exitCode: null },
  ];
  const runtime: ComputerRuntime = {
    capture: async () => ({ mimeType: 'image/jpeg', data: new Uint8Array(), width: 1, height: 1, bounds: [] }),
    execute: async () => ({ started: true, completed: 1, error: null }),
    prepareCore: async (_id, request) => request,
    core: async (_id, request: any) => ({
      started: true,
      settled: true as const,
      result: request.operation === 'list' ? { type: 'terminal', sessions } : { type: 'terminal', deleted: true },
    }),
    cancel: async () => {},
  };
  const service = new ComputerUseService(db, runtime);
  const events: { agentId: string; text: string }[] = [];
  const watcher = new TerminalWatcher(db, service, async (agentId, text) => events.push({ agentId, text }));
  try {
    await watcher.tick(); // nobody holds the computer: nothing watched
    await service.assign(agent.id, [computer.id]);
    await service.use(agent.id, computer.id, true);
    await watcher.tick(); // first look is the baseline
    expect(events).toEqual([]);
    // build finishes, the human closes server, the agent deletes scratch itself
    await service.core(agent.id, { kind: 'terminal', operation: 'delete', session: scratch });
    sessions = [{ id: build, name: 'build', alive: false, exitCode: 2 }];
    await watcher.tick();
    expect(events).toHaveLength(1);
    expect(events[0].agentId).toBe(agent.id);
    expect(events[0].text).toContain(`Terminal "build" (${build}) on computer "Desk" exited with code 2`);
    expect(events[0].text).toContain(`Terminal "server" (${server}) on computer "Desk" was closed by someone else`);
    expect(events[0].text).not.toContain('scratch');
    await watcher.tick(); // nothing new
    expect(events).toHaveLength(1);
  } finally {
    watcher.close();
    await db.close();
  }
});
