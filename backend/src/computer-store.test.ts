import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from './test-database';
import { ComputerStore } from './computer-store';

async function fixture() {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  return { database, computers: new ComputerStore(database) };
}

describe('computer identity and lifecycle', () => {
  it('persists a computer independently of agents, normalizes its name, and deduplicates retries', async () => {
    const { database, computers } = await fixture();
    try {
      const key = crypto.randomUUID();
      const first = await computers.reserve('  Design machine  ', key);
      expect(first.created).toBe(true);
      expect(first.computer).toMatchObject({ name: 'Design machine', state: 'creating', requestKey: key });
      const again = await computers.reserve('Design machine', key);
      expect(again).toMatchObject({ computer: { id: first.computer.id }, created: false });
      await expect(computers.reserve('Different name', key)).rejects.toThrow('different name');
      expect((await computers.list()).map(item => item.id)).toEqual([first.computer.id]);
      expect(await database.client.agent.count()).toBe(0);
      expect(await computers.markRunning(first.computer.id)).toBe(true);
      expect(await computers.get(first.computer.id)).toMatchObject({ state: 'running' });
    } finally {
      await database.close();
    }
  });

  it('persists per-computer choices and rejects an idempotency key reused with different settings', async () => {
    const { database, computers } = await fixture();
    try {
      const key = crypto.randomUUID();
      const settings = { cpuCores: 3, memoryGiB: 6, timezone: 'America/Toronto' };
      const first = await computers.reserve('Configurable', key, settings);
      expect(first.computer).toMatchObject(settings);
      expect((await computers.reserve('Configurable', key, settings)).created).toBe(false);
      await expect(computers.reserve('Configurable', key, { ...settings, memoryGiB: 7 })).rejects.toThrow(
        'different settings',
      );
      expect(await computers.get(first.computer.id)).toMatchObject(settings);
      // Legacy records remain unknown, not silently backfilled with a false
      // 4-GiB/Toronto claim when their actual Docker quota/env may differ.
      const legacy = await computers.reserve('Legacy', crypto.randomUUID());
      expect(legacy.computer).toMatchObject({ cpuCores: null, memoryGiB: null, timezone: null });
    } finally {
      await database.close();
    }
  });

  it('requires the exact current name and a completed create before deleting data', async () => {
    const { database, computers } = await fixture();
    try {
      const { computer } = await computers.reserve('Work Machine', crypto.randomUUID());
      await expect(computers.markDeleting(computer.id, 'work machine')).rejects.toThrow('exact');
      await expect(computers.markDeleting(computer.id, 'Work Machine')).rejects.toThrow('being created');
      expect(await computers.markRunning(computer.id)).toBe(true);
      expect(await computers.markDeleting(computer.id, 'Work Machine')).toMatchObject({ state: 'deleting' });
      expect(await computers.markDeleting(computer.id, 'Work Machine')).toMatchObject({ state: 'deleting' }); // retry after uncertain controller result
      expect(await computers.markRunning(computer.id)).toBe(false); // a delayed create cannot revive a deletion
      expect(await computers.finalizeDelete(computer.id, 'Work Machine')).toBe(true);
      expect(await computers.get(computer.id)).toBeNull();
      await expect(computers.markDeleting(computer.id, 'Work Machine')).rejects.toThrow('not found');
    } finally {
      await database.close();
    }
  });

  it('rejects a name that only differs in case from an existing computer', async () => {
    const { database, computers } = await fixture();
    try {
      await computers.reserve('Workspace-NGABCD', crypto.randomUUID());
      await expect(computers.reserve('workspace-ngabcd', crypto.randomUUID())).rejects.toThrow('already in use');
      await expect(computers.reserve('  Workspace-NGABCD  ', crypto.randomUUID())).rejects.toThrow('already in use');
      const distinct = await computers.reserve('Workspace-NGWXYZ', crypto.randomUUID());
      expect(distinct.created).toBe(true);
      expect(await database.client.computer.count()).toBe(2);
    } finally {
      await database.close();
    }
  });

  it('bounds retained computer records without breaking idempotent retries at the cap', async () => {
    const { database, computers } = await fixture();
    try {
      const key = crypto.randomUUID();
      await database.client.computer.createMany({
        data: [
          { name: 'Original', requestKey: key, state: 'failed' },
          ...Array.from({ length: 99 }, (_, index) => ({
            name: `Other ${index}`,
            requestKey: crypto.randomUUID(),
            state: 'failed',
          })),
        ],
      });
      await expect(computers.reserve('Overflow', crypto.randomUUID())).rejects.toThrow('limit');
      expect((await computers.reserve('Original', key)).created).toBe(false);
    } finally {
      await database.close();
    }
  });

  it('retains a failed create for operator recovery and allows exact-name cleanup', async () => {
    const { database, computers } = await fixture();
    try {
      const { computer } = await computers.reserve('Failed machine', crypto.randomUUID());
      await computers.markFailed(computer.id);
      expect(await computers.get(computer.id)).toMatchObject({ state: 'failed' });
      await computers.markDeleting(computer.id, 'Failed machine');
      await computers.finalizeDelete(computer.id, 'Failed machine');
      expect(await database.client.computer.count()).toBe(0);
    } finally {
      await database.close();
    }
  });
});

describe('computer resource settings', () => {
  it('updates saved CPU and RAM without changing timezone, identity or power intent', async () => {
    const { database, computers } = await fixture();
    try {
      const { computer } = await computers.reserve('Editable', crypto.randomUUID(), {
        cpuCores: 4,
        memoryGiB: 4,
        timezone: 'America/Toronto',
      });
      await computers.markRunning(computer.id);
      expect(await computers.updateResources(computer.id, { cpuCores: 2, memoryGiB: 6 })).toMatchObject({
        id: computer.id,
        cpuCores: 2,
        memoryGiB: 6,
        timezone: 'America/Toronto',
        desiredState: 'running',
      });
      await expect(computers.updateResources('missing-id', { cpuCores: 2, memoryGiB: 6 })).rejects.toThrow('not found');
    } finally {
      await database.close();
    }
  });
});

describe('computer power intent', () => {
  it('records an explicit stop so controller reconciliation cannot revive it, and a start clears it', async () => {
    const { database, computers } = await fixture();
    try {
      const { computer } = await computers.reserve('Powered desk', crypto.randomUUID());
      await computers.markRunning(computer.id);
      expect(computer.desiredState).toBe('running');
      expect(await computers.setDesiredState(computer.id, 'stopped')).toMatchObject({ desiredState: 'stopped' });
      expect((await computers.get(computer.id))?.desiredState).toBe('stopped');
      // Reconciliation only ever considers computers the operator left on.
      expect(await computers.stoppedIds()).toEqual([computer.id]);
      expect(await computers.setDesiredState(computer.id, 'running')).toMatchObject({ desiredState: 'running' });
      expect(await computers.stoppedIds()).toEqual([]);
      await expect(computers.setDesiredState('missing-id', 'stopped')).rejects.toThrow('not found');
    } finally {
      await database.close();
    }
  });
});
