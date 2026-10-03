import { expect, it } from 'vitest';
import {
  cpuPercent,
  measureFolder,
  mountOf,
  parseMeminfo,
  parseMountinfo,
  parseProcStat,
  type HostReaders,
} from './host';

it('reads the aggregate CPU line and computes the busy share between readings', () => {
  const first = parseProcStat('cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 1 2 3 4 5 6 7 8 0 0\n');
  expect(first).toEqual({ idle: 850, total: 1000 });
  // 1000 more jiffies, 250 of them idle or waiting: 75 % busy.
  const second = parseProcStat('cpu  800 0 100 1000 100 0 0 0 0 0\n');
  expect(cpuPercent(first!, second!)).toBe(75);
  expect(cpuPercent(second!, second!)).toBeNull();
  expect(parseProcStat('intr 1 2 3')).toBeNull();
});

it('reads memory as total minus available, in bytes', () => {
  const text = 'MemTotal:       32000000 kB\nMemFree:         1000000 kB\nMemAvailable:   24000000 kB\n';
  expect(parseMeminfo(text)).toEqual({ used: 8000000 * 1024, total: 32000000 * 1024 });
  expect(parseMeminfo('MemTotal: 1 kB\n')).toBeNull();
});

const mountinfo = [
  '850 820 0:52 / / rw,relatime master:1 - overlay overlay rw,lowerdir=/x',
  '879 850 259:2 /home/user/services/agent-swarm-ng/.local /app/.local rw,relatime - ext4 /dev/nvme0n1p2 rw',
  '880 850 0:60 / /srv/my\\040data rw - zfs bulk/data rw',
].join('\n');

it('finds the mount a folder lives on from mountinfo', () => {
  const mounts = parseMountinfo(mountinfo);
  expect(mounts[2]).toEqual({ mountpoint: '/srv/my data', fstype: 'zfs', source: 'bulk/data' });
  expect(mountOf(mounts, '/app/.local')?.source).toBe('/dev/nvme0n1p2');
  expect(mountOf(mounts, '/app/.local/files')?.source).toBe('/dev/nvme0n1p2');
  expect(mountOf(mounts, '/app/.localx')?.source).toBe('overlay');
});

it('measures the platform data folder with statfs', async () => {
  const readers = {
    realpath: async (path: string) => path,
    mountinfo: async () => mountinfo,
    statfs: async () => ({ bsize: 4096, blocks: 1000, bfree: 400, bavail: 350 }),
  } as unknown as HostReaders;
  expect(await measureFolder(readers, '/app/.local')).toEqual({
    source: '/dev/nvme0n1p2',
    fstype: 'ext4',
    size: 1000 * 4096,
    used: 600 * 4096,
    avail: 350 * 4096,
  });
});
