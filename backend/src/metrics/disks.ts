/**
 * Groups measured host paths by the physical storage they live on, so each disk shows once with everything the
 * platform keeps there. A block-device filesystem is keyed by its source device (/dev/nvme0n1p2); ZFS datasets by
 * their pool (bulk/drive-2026 → bulk). A ZFS pool's used space is the sum of the distinct datasets seen (each df
 * "used" is what that dataset itself references, so nothing counts twice) and its total adds the pool's shared free
 * space. Snapshots and datasets not mounted beneath a measured path are not counted: list a pool's root folder in
 * DASHBOARD_EXTRA_DISKS to see all of it.
 */
export const DISK_USES = ['docker', 'platform data', 'computer keep', 'computer cache', 'listed'] as const;
export type DiskUse = (typeof DISK_USES)[number];
export type DiskMeasurement = {
  uses: DiskUse[];
  source: string;
  fstype: string;
  size: number;
  used: number;
  avail: number;
};
export type ZfsDataset = { dataset: string; used: number; avail: number };
export type DiskRow = { disk: string; label: string; uses: DiskUse[]; used: number; total: number };

const poolOf = (dataset: string) => dataset.split('/')[0];

export function groupDisks(measurements: DiskMeasurement[], datasets: ZfsDataset[] = []): DiskRow[] {
  type Group = { label: string; uses: Set<DiskUse>; used: number; total: number; datasets?: Map<string, ZfsDataset> };
  const groups = new Map<string, Group>();
  for (const measurement of measurements) {
    const zfs = measurement.fstype === 'zfs';
    const disk = zfs ? poolOf(measurement.source) : measurement.source;
    if (!disk) continue;
    let group = groups.get(disk);
    if (!group) {
      const label = zfs
        ? `${disk} (ZFS)`
        : measurement.source.startsWith('/dev/')
          ? measurement.source.split('/').pop()!
          : measurement.source;
      group = { label, uses: new Set(), used: 0, total: 0, ...(zfs ? { datasets: new Map() } : {}) };
      groups.set(disk, group);
    }
    for (const use of measurement.uses) group.uses.add(use);
    if (group.datasets)
      group.datasets.set(measurement.source, {
        dataset: measurement.source,
        used: measurement.used,
        avail: measurement.avail,
      });
    else {
      // The same filesystem measured through different paths: identical figures, a moment apart.
      group.used = Math.max(group.used, measurement.used);
      group.total = Math.max(group.total, measurement.size);
    }
  }
  for (const dataset of datasets) groups.get(poolOf(dataset.dataset))?.datasets?.set(dataset.dataset, dataset);
  return [...groups].map(([disk, group]) => {
    let { used, total } = group;
    if (group.datasets) {
      const all = [...group.datasets.values()];
      used = all.reduce((sum, item) => sum + item.used, 0);
      total = used + Math.max(0, ...all.map(item => item.avail));
    }
    return { disk, label: group.label, uses: DISK_USES.filter(use => group.uses.has(use)), used, total };
  });
}
