import { expect, it } from 'vitest';
import { parseDiskstats, parseHostNet } from './host';
import { ioRates } from './sampler';
import { LiveMetrics } from './live';

const DISKSTATS = [
  '   7       0 loop0 6326 0 1000 0 776 0 2000 0 0 0 0',
  ' 259       0 nvme0n1 100 0 2000 0 50 0 4000 0 0 0 0',
  ' 259       2 nvme0n1p2 90 0 1800 0 40 0 3000 0 0 0 0',
  '   8       0 sda 10 0 100 0 5 0 200 0 0 0 0',
  ' 252       0 zram0 1 0 8 0 1 0 8 0 0 0 0',
  ' 253       0 dm-0 1 0 8 0 1 0 8 0 0 0 0',
].join('\n');

it('reads whole physical disks from /proc/diskstats, in bytes', () => {
  expect(Object.fromEntries(parseDiskstats(DISKSTATS))).toEqual({
    nvme0n1: { read: 2000 * 512, write: 4000 * 512 },
    sda: { read: 100 * 512, write: 200 * 512 },
  });
});

const NET = (rx: number, tx: number, at?: number) =>
  [
    ...(at === undefined ? [] : [String(at)]),
    'eno1',
    'wlp3s0',
    '---',
    'Inter-|   Receive |  Transmit',
    ' face |bytes packets errs drop fifo frame compressed multicast|bytes packets',
    '    lo:  89406 844 0 0 0 0 0 0 89406 844 0 0 0 0 0 0',
    `  eno1: ${rx} 2291 0 3 0 0 0 80 ${tx} 55698 0 0 0 0 0 0`,
    'wlp3s0: 1000 860 0 0 0 0 0 0 10 218 0 0 0 0 0 0',
    'tailscale0: 840975 5980 0 0 0 0 0 0 2929216 4954 0 0 0 0 0 0',
    'docker0: 5 1 0 0 0 0 0 0 5 1 0 0 0 0 0 0',
  ].join('\n');

it('counts only the physical interfaces the host-net sidecar lists', () => {
  expect(Object.fromEntries(parseHostNet(NET(500, 700)))).toEqual({
    eno1: { rx: 500, tx: 700 },
    wlp3s0: { rx: 1000, tx: 10 },
  });
  expect(parseHostNet('').size).toBe(0);
});

it('turns counters into bytes per second per disk, and a reset or missing counter into unknown', () => {
  const disks = (entries: [string, number, number][]) =>
    new Map(entries.map(([device, read, write]) => [device, { read, write }]));
  const before = {
    net: { rx: 1000, tx: 100, at: null },
    disks: disks([
      ['sda', 0, 512],
      ['nvme0n1', 100, 100],
    ]),
  };
  const after = {
    net: { rx: 7000, tx: 700, at: null },
    disks: disks([
      ['sda', 1024, 512],
      ['nvme0n1', 50, 100],
      ['sdb', 1, 1],
    ]),
  };
  const rates = ioRates(before, after, 2);
  expect(rates).toMatchObject({ netRx: 3000, netTx: 300 });
  // nvme0n1's counter went back (a reset) and sdb has no earlier reading: neither is reported.
  expect(Object.fromEntries(rates.disks)).toEqual({ sda: { read: 512, write: 0 } });
  expect(ioRates(before, { net: null, disks: new Map() }, 2)).toMatchObject({ netRx: null, netTx: null });
  expect(ioRates(null, before, 60).netRx).toBeNull();
});

it('keeps the last minute of quarter-second readings', async () => {
  let t = 1_000_000;
  let busy = 0;
  let rx = 0;
  const live = new LiveMetrics(
    {
      procStat: async () => `cpu  ${(busy += 50)} 0 0 ${busy + 100} 0 0 0 0\ncpu0 1 0 0 1\ncpu1 1 0 0 1\n`,
      meminfo: async () => 'MemTotal: 1000 kB\nMemAvailable: 250 kB\n',
      diskstats: async () => DISKSTATS,
      uptime: async () => `${t / 1000} 0`,
      hostNet: async () => NET((rx += 2048), 0),
      blockInfo: async () => ({ model: 'SABRENT', bytes: 1.44e12 }),
      mountinfo: async () => '',
      statfs: async () => ({ bsize: 0, blocks: 0, bfree: 0, bavail: 0 }),
      realpath: async path => path,
    },
    () => (t += 250),
  );
  const heard: number[] = [];
  const stop = live.subscribe(point => heard.push(point.t));
  for (let i = 0; i < 250; i++) await live.tick();
  stop();
  await live.tick();
  expect(live.points).toHaveLength(240);
  expect(heard).toHaveLength(249);
  const last = live.points.at(-1)!;
  expect(last).toMatchObject({ memUsed: 750 * 1024, memTotal: 1000 * 1024, netRx: 8192, netTx: 0 });
  expect(last.disks).toEqual({ nvme0n1: { read: 0, write: 0 }, sda: { read: 0, write: 0 } });
  expect(await live.labelOf('sda')).toBe('sda · SABRENT · 1.4 TB');
  expect(last.cpuPercent).toBe(50);
  expect(live.cores).toBe(2);
});

it("times network rates by the sidecar's own snapshots: a repeated snapshot is no reading, a stale one none", async () => {
  const { readIo, ioRates } = await import('./sampler');
  let file = NET(1000, 0, 100.0);
  let uptime = '100.5 0';
  const readers = {
    procStat: async () => '',
    meminfo: async () => '',
    diskstats: async () => '',
    uptime: async () => uptime,
    hostNet: async () => file,
    blockInfo: async () => ({ model: null, bytes: null }),
    mountinfo: async () => '',
    statfs: async () => ({ bsize: 0, blocks: 0, bfree: 0, bavail: 0 }),
    realpath: async (path: string) => path,
  };
  const first = await readIo(readers);
  // The same snapshot read again a second later: unknown, never a zero.
  uptime = '101.5 0';
  expect(ioRates(first, await readIo(readers), 1).netRx).toBeNull();
  // The next snapshot, 1.2 s after the first by the sidecar's clock.
  file = NET(1000 + 1200, 0, 101.2);
  expect(ioRates(first, await readIo(readers), 1).netRx).toBeCloseTo(1000);
  // The sidecar stopped: its last snapshot is more than three seconds old.
  uptime = '110 0';
  expect((await readIo(readers)).net).toBeNull();
});

it('holds the network rate while the sidecar has not written a new snapshot', async () => {
  let t = 100_000;
  let file = NET(0, 0, 100);
  const live = new LiveMetrics(
    {
      procStat: async () => '',
      meminfo: async () => '',
      diskstats: async () => '',
      uptime: async () => `${t / 1000} 0`,
      hostNet: async () => file,
      blockInfo: async () => ({ model: null, bytes: null }),
      mountinfo: async () => '',
      statfs: async () => ({ bsize: 0, blocks: 0, bfree: 0, bavail: 0 }),
      realpath: async path => path,
    },
    () => (t += 250),
  );
  await live.tick();
  await live.tick();
  file = NET(500, 50, 100.5);
  await live.tick();
  await live.tick(); // the same snapshot again
  file = NET(1500, 150, 101);
  await live.tick();
  // The sidecar stops: its last rate is held for up to a second, then a gap.
  for (let i = 0; i < 4; i++) await live.tick();
  expect(live.points.map(point => [point.netRx, point.netTx])).toEqual([
    [null, null],
    [1000, 100],
    [1000, 100],
    [2000, 200],
    [2000, 200],
    [2000, 200],
    [2000, 200],
    [null, null],
  ]);
});
