import { expect, it } from 'vitest';
import { groupDisks } from './disks';

const GiB = 1024 ** 3;

it('shows each physical disk once: NVMe by device, ZFS datasets by pool, uses combined', () => {
  const nvme = { source: '/dev/nvme0n1p2', fstype: 'ext4', size: 468 * GiB, used: 372 * GiB, avail: 71 * GiB };
  const rows = groupDisks(
    [
      { uses: ['platform data'], ...nvme },
      { uses: ['docker'], ...nvme, used: 372 * GiB + 5 },
      {
        uses: ['computer keep'],
        source: 'tank/agent-swarm-ng',
        fstype: 'zfs',
        size: 0,
        used: 1 * GiB,
        avail: 392 * GiB,
      },
      {
        uses: ['computer cache'],
        source: 'bulk/agent-swarm-ng',
        fstype: 'zfs',
        size: 0,
        used: 2 * GiB,
        avail: 567 * GiB,
      },
      { uses: ['listed'], source: 'bulk', fstype: 'zfs', size: 0, used: 1, avail: 567 * GiB },
      { uses: ['listed'], source: 'tank', fstype: 'zfs', size: 0, used: 1, avail: 392 * GiB },
      {
        uses: ['computer cache'],
        source: 'bulk/agent-swarm-ng',
        fstype: 'zfs',
        size: 0,
        used: 2 * GiB,
        avail: 567 * GiB,
      },
    ],
    [
      // Datasets the helper saw beneath the listed pool folders (the measured ones again, counted once).
      { dataset: 'bulk/agent-swarm-ng', used: 2 * GiB, avail: 567 * GiB },
      { dataset: 'bulk/drive-2026', used: 200 * GiB, avail: 567 * GiB },
      { dataset: 'bulk/uwlearn/backups', used: 1 * GiB, avail: 567 * GiB },
      { dataset: 'other/x', used: 9 * GiB, avail: 1 },
    ],
  );
  expect(rows).toEqual([
    {
      disk: '/dev/nvme0n1p2',
      label: 'nvme0n1p2',
      uses: ['docker', 'platform data'],
      used: 372 * GiB + 5,
      total: 468 * GiB,
    },
    { disk: 'tank', label: 'tank (ZFS)', uses: ['computer keep', 'listed'], used: 1 * GiB + 1, total: 393 * GiB + 1 },
    {
      disk: 'bulk',
      label: 'bulk (ZFS)',
      uses: ['computer cache', 'listed'],
      used: 203 * GiB + 1,
      total: 770 * GiB + 1,
    },
  ]);
});

it('keys other filesystems by their source', () => {
  expect(
    groupDisks([{ uses: ['listed'], source: 'nas:/export', fstype: 'nfs4', size: 100, used: 40, avail: 60 }]),
  ).toEqual([{ disk: 'nas:/export', label: 'nas:/export', uses: ['listed'], used: 40, total: 100 }]);
  expect(groupDisks([])).toEqual([]);
});
