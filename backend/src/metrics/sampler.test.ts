import { expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from '../test-database';
import type { ComputerController, ComputerObservation, ControllerDisks } from '../computer-controller-client';
import type { HostReaders } from './host';
import { MetricsSampler } from './sampler';

const database = () => prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
const GiB = 1024 ** 3;
const NOW = new Date('2026-10-03T12:00:00Z');

function readers(stats: string[]): HostReaders {
  return {
    procStat: async () => stats.shift() ?? '',
    meminfo: async () => 'MemTotal: 16000000 kB\nMemAvailable: 12000000 kB\n',
    mountinfo: async () => '879 850 259:2 /x/.local /app/.local rw - ext4 /dev/nvme0n1p2 rw',
    statfs: async () => ({ bsize: 1024, blocks: 468 * 1024 ** 2, bfree: 96 * 1024 ** 2, bavail: 71 * 1024 ** 2 }),
    realpath: async () => '/app/.local',
  };
}
const quiet = { error: vi.fn() };

it('samples host CPU against the previous reading, and memory', async () => {
  const store = await database();
  const sampler = new MetricsSampler(store, null, {
    readers: readers(['cpu  100 0 0 900 0 0 0 0 0 0\n', 'cpu  400 0 0 1600 0 0 0 0 0 0\n']),
    now: () => NOW,
    log: quiet,
  });
  expect(await sampler.sampleSystem()).toBe(false); // baseline only
  expect(await sampler.sampleSystem()).toBe(true);
  expect(await store.client.systemSample.findMany({ omit: { sequence: true } })).toEqual([
    { at: NOW, cpuPercent: 30, memUsed: BigInt(4000000 * 1024), memTotal: BigInt(16000000 * 1024) },
  ]);
  // Without a controller, computers are simply not sampled.
  expect(await sampler.sampleComputers()).toBe(0);
});

it('samples running computers as a share of their own CPU quota', async () => {
  const store = await database();
  const observation = (status: string, cpuPercent: number | null): ComputerObservation => ({
    status,
    cpuPercent,
    memoryBytes: 2 * GiB,
    memoryLimitBytes: 4 * GiB,
    cpuCount: 4,
  });
  const controller = {
    observe: async () =>
      new Map([
        ['running-one', observation('running', 250)],
        ['stopped-one', observation('exited', null)],
        ['no-stats-yet', observation('running', null)],
        ['no-limit', { ...observation('running', 100), memoryLimitBytes: null }],
      ]),
  } as unknown as ComputerController;
  const sampler = new MetricsSampler(store, controller, { readers: readers([]), now: () => NOW, log: quiet });
  expect(await sampler.sampleComputers()).toBe(2);
  // Memory is kept as a share of the limit at that moment, so a later limit change never rewrites history.
  expect(
    await store.client.computerSample.findMany({ omit: { sequence: true }, orderBy: { sequence: 'asc' } }),
  ).toEqual([
    {
      at: NOW,
      computerId: 'running-one',
      cpuPercent: 62.5,
      memUsed: BigInt(2 * GiB),
      memLimit: BigInt(4 * GiB),
      memPercent: 50,
    },
    { at: NOW, computerId: 'no-limit', cpuPercent: 25, memUsed: BigInt(2 * GiB), memLimit: null, memPercent: null },
  ]);
});

it('samples each disk once with what lives there, asking the controller only for Keep/Cache folders', async () => {
  const store = await database();
  await store.client.swarmSettings.upsert({
    where: { id: 1 },
    create: { id: 1, computerKeepFolder: '/drives/tank/swarm', computerCacheFolder: '/drives/bulk/swarm' },
    update: { computerKeepFolder: '/drives/tank/swarm', computerCacheFolder: '/drives/bulk/swarm' },
  });
  const asked: string[][] = [];
  const disks: ControllerDisks = {
    disks: [
      {
        path: '/var/lib/docker',
        use: 'docker',
        source: '/dev/nvme0n1p2',
        fstype: 'ext4',
        size: 468 * GiB,
        used: 372 * GiB,
        avail: 71 * GiB,
      },
      { path: '/drives/bulk', use: 'listed', source: 'bulk', fstype: 'zfs', size: 0, used: 0, avail: 500 * GiB },
      { path: '/drives/gone', use: 'listed', error: 'unavailable' },
      {
        path: '/drives/tank/swarm',
        use: 'requested',
        source: 'tank/swarm',
        fstype: 'zfs',
        size: 0,
        used: GiB,
        avail: 300 * GiB,
      },
      {
        path: '/drives/bulk/swarm',
        use: 'requested',
        source: 'bulk/swarm',
        fstype: 'zfs',
        size: 0,
        used: 2 * GiB,
        avail: 500 * GiB,
      },
    ],
    zfs: [{ dataset: 'bulk/media', used: 100 * GiB, avail: 500 * GiB }],
  };
  const controller = {
    diskUsage: async (paths: string[]) => (asked.push(paths), disks),
  } as unknown as ComputerController;
  const sampler = new MetricsSampler(store, controller, { readers: readers([]), now: () => NOW, log: quiet });
  expect(await sampler.sampleDisks()).toBe(3);
  expect(asked).toEqual([['/drives/tank/swarm', '/drives/bulk/swarm']]);
  const rows = await store.client.diskSample.findMany({ omit: { sequence: true }, orderBy: { sequence: 'asc' } });
  expect(rows).toEqual([
    {
      at: NOW,
      disk: '/dev/nvme0n1p2',
      label: 'nvme0n1p2',
      uses: '["docker","platform data"]',
      used: BigInt(372 * GiB),
      total: BigInt(468 * GiB),
    },
    {
      at: NOW,
      disk: 'bulk',
      label: 'bulk (ZFS)',
      uses: '["computer cache","listed"]',
      used: BigInt(102 * GiB),
      total: BigInt(602 * GiB),
    },
    {
      at: NOW,
      disk: 'tank',
      label: 'tank (ZFS)',
      uses: '["computer keep"]',
      used: BigInt(GiB),
      total: BigInt(301 * GiB),
    },
  ]);

  // A controller outage still records the platform data folder's disk, and is logged rather than thrown.
  const failing = new MetricsSampler(
    store,
    { diskUsage: async () => Promise.reject(new Error('down')) } as unknown as ComputerController,
    { readers: readers([]), now: () => NOW, log: quiet },
  );
  expect(await failing.sampleDisks()).toBe(1);
  expect(quiet.error).toHaveBeenCalled();
});

it('asks the controller for at most 16 distinct Keep/Cache folders, the Settings ones first', async () => {
  const store = await database();
  await store.client.swarmSettings.upsert({
    where: { id: 1 },
    create: { id: 1, computerKeepFolder: '/keep/main', computerCacheFolder: '/cache/main' },
    update: { computerKeepFolder: '/keep/main', computerCacheFolder: '/cache/main' },
  });
  await store.client.computer.createMany({
    data: Array.from({ length: 20 }, (_, index) => ({
      name: `c${index}`,
      requestKey: `r${index}`,
      keepFolder: `/keep/${index}`,
      cacheFolder: '/cache/main',
    })),
  });
  const asked: string[][] = [];
  const controller = {
    diskUsage: async (paths: string[]) => (asked.push(paths), { disks: [], zfs: [] }),
  } as unknown as ComputerController;
  await new MetricsSampler(store, controller, { readers: readers([]), now: () => NOW, log: quiet }).sampleDisks();
  expect(asked[0]).toHaveLength(16);
  expect(asked[0].slice(0, 3)).toEqual(['/keep/main', '/cache/main', '/keep/0']);
  expect(new Set(asked[0]).size).toBe(16);
});

it('deletes samples older than two weeks and usage/run spans older than 400 days in batches', async () => {
  const store = await database();
  const day = 86_400_000;
  const old = new Date(NOW.getTime() - 15 * day),
    recent = new Date(NOW.getTime() - 13 * day);
  await store.client.systemSample.createMany({
    data: Array.from({ length: 1201 }, () => ({ at: old, cpuPercent: 1, memUsed: 1n, memTotal: 2n })),
  });
  await store.client.systemSample.create({ data: { at: recent, cpuPercent: 2, memUsed: 1n, memTotal: 2n } });
  await store.client.diskSample.create({ data: { at: old, disk: 'd', label: 'd', uses: '[]', used: 1n, total: 2n } });
  await store.client.computerSample.create({ data: { at: old, computerId: 'c', cpuPercent: 1, memUsed: 1n } });
  await store.client.computerSample.create({ data: { at: recent, computerId: 'c', cpuPercent: 1, memUsed: 1n } });
  const ago = (days: number) => new Date(NOW.getTime() - days * day);
  const usage = (at: Date) => ({
    at,
    agentId: 'a',
    provider: 'p',
    model: 'm',
    purpose: 'turn',
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    cost: 0,
  });
  await store.client.usageEvent.createMany({ data: [usage(ago(401)), usage(ago(15)), usage(ago(399))] });
  await store.client.agentRunSpan.createMany({
    data: [
      { agentId: 'a', runId: 'old', startedAt: ago(401), endedAt: ago(401) },
      { agentId: 'a', runId: 'kept', startedAt: ago(399), endedAt: ago(399) },
    ],
  });
  const sampler = new MetricsSampler(store, null, { readers: readers([]), now: () => NOW, log: quiet });
  expect(await sampler.prune()).toBe(1205);
  expect(await store.client.systemSample.findMany({ select: { cpuPercent: true } })).toEqual([{ cpuPercent: 2 }]);
  expect(await store.client.diskSample.count()).toBe(0);
  expect(await store.client.computerSample.count()).toBe(1);
  expect(await store.client.usageEvent.count()).toBe(2);
  expect(await store.client.agentRunSpan.findMany({ select: { runId: true } })).toEqual([{ runId: 'kept' }]);
});

it('starts nothing until asked, and a failing sample never throws', async () => {
  vi.useFakeTimers();
  try {
    const store = await database();
    const log = { error: vi.fn() };
    const broken = { ...readers([]), procStat: () => Promise.reject(new Error('no /proc')) };
    const sampler = new MetricsSampler(store, null, { readers: broken, now: () => NOW, log });
    const stop = sampler.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(log.error).toHaveBeenCalledWith(expect.any(Error), 'Dashboard system sampling failed');
    stop();
  } finally {
    vi.useRealTimers();
  }
});
