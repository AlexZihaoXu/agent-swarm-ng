import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from './test-database';
import { ComputerStore } from './computer-store';
import { reconcileStoppedComputers, watchStoppedComputers } from './computer-power';
import type { ComputerController, ComputerObservation } from './computer-controller-client';

function controller(observed: Map<string, ComputerObservation>, calls: string[]): ComputerController {
  const noop = async () => {};
  return {
    create: noop,
    remove: noop,
    updateResources: noop,
    replaceStopped: noop,
    preview: async () => null,
    pointer: noop,
    start: noop,
    limits: async () => ({
      cpuCores: { min: 1, max: 8, default: 4 },
      memoryGiB: { min: 1, max: 16, default: 4 },
      timezoneDefault: 'America/Toronto',
    }),
    observe: async () => observed,
    async stop(id) {
      calls.push(`stop:${id}`);
    },
  };
}

describe('stopped-computer reconciliation', () => {
  it('stops only what the operator powered off but a restart revived, and leaves the rest alone', async () => {
    const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
    try {
      const store = new ComputerStore(database);
      const stopped = await store.reserve('Kept off', crypto.randomUUID());
      const running = await store.reserve('Left on', crypto.randomUUID());
      const halfBuilt = await store.reserve('Half built', crypto.randomUUID());
      await store.markRunning(stopped.computer.id);
      await store.markRunning(running.computer.id);
      await store.setDesiredState(stopped.computer.id, 'stopped');
      const observed = new Map<string, ComputerObservation>([
        [
          stopped.computer.id,
          { status: 'running', cpuPercent: 5, memoryBytes: 1, memoryLimitBytes: 4_294_967_296, cpuCount: 4 },
        ],
        [
          running.computer.id,
          { status: 'running', cpuPercent: 5, memoryBytes: 1, memoryLimitBytes: 4_294_967_296, cpuCount: 4 },
        ],
        [
          halfBuilt.computer.id,
          { status: 'running', cpuPercent: 5, memoryBytes: 1, memoryLimitBytes: 4_294_967_296, cpuCount: 4 },
        ],
      ]);
      const calls: string[] = [];
      const result = await reconcileStoppedComputers(store, controller(observed, calls));
      expect(calls).toEqual([`stop:${stopped.computer.id}`]);
      expect(result).toMatchObject({ considered: 1, stopped: 1, failed: 0 });
    } finally {
      await database.close();
    }
  });

  it('reports a controller failure without throwing, so startup still completes', async () => {
    const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
    try {
      const store = new ComputerStore(database);
      const record = await store.reserve('Off desk', crypto.randomUUID());
      await store.markRunning(record.computer.id);
      await store.setDesiredState(record.computer.id, 'stopped');
      const failing = controller(
        new Map([
          [
            record.computer.id,
            { status: 'running', cpuPercent: 1, memoryBytes: 1, memoryLimitBytes: 4_294_967_296, cpuCount: 4 },
          ],
        ]),
        [],
      );
      failing.stop = async () => {
        throw new Error('controller offline');
      };
      const result = await reconcileStoppedComputers(store, failing);
      expect(result).toMatchObject({ considered: 1, stopped: 0, failed: 1 });
    } finally {
      await database.close();
    }
  });
});

describe('stopped-computer watcher', () => {
  it('turns a computer off again when only the controller restarted and revived it', async () => {
    const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
    const store = new ComputerStore(database);
    try {
      const off = await store.reserve('Kept off', crypto.randomUUID());
      await store.markRunning(off.computer.id);
      await store.setDesiredState(off.computer.id, 'stopped');
      const observed = new Map<string, ComputerObservation>([
        [
          off.computer.id,
          { status: 'exited', cpuPercent: null, memoryBytes: null, memoryLimitBytes: null, cpuCount: null },
        ],
      ]);
      const calls: string[] = [];
      const fake = controller(observed, calls);
      const stopWatching = watchStoppedComputers(() => reconcileStoppedComputers(store, fake), 50);
      try {
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(calls).toEqual([]); // nothing to correct while it stays off
        observed.set(off.computer.id, {
          status: 'running',
          cpuPercent: 1,
          memoryBytes: 1,
          memoryLimitBytes: 1,
          cpuCount: 1,
        }); // controller restarts and revives it
        await vi.waitFor(() => expect(calls).toEqual([`stop:${off.computer.id}`]), { timeout: 2000 });
      } finally {
        stopWatching();
      }
    } finally {
      await database.close();
    }
  });
});
