import { posix } from 'node:path';
import { ResourceError } from './resources';

/**
 * Dashboard disk usage: which filesystem each host path the platform uses lives on, and how full it is. The backend
 * asks only for the Keep/Cache folders chosen in Settings; the controller adds Docker's data root itself and the
 * operator's DASHBOARD_EXTRA_DISKS list from its environment (never anything the dashboard chooses). A short-lived
 * helper container mounts each path read-only and runs `df`; ZFS datasets mounted beneath a path come along so the
 * backend can add them up per pool.
 */
export type DiskUse = 'docker' | 'listed' | 'requested';
export type DiskPath = { path: string; use: DiskUse };
export type MeasuredDisk = DiskPath &
  ({ source: string; fstype: string; size: number; used: number; avail: number } | { error: 'unavailable' });
export type ZfsDataset = { dataset: string; used: number; avail: number };

export const MAX_DISK_PATHS = 16;

/** An absolute, normalized host path with plain characters (no "..", nothing Docker's bind syntax could misread). */
export function validDiskPath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length <= 1024 &&
    /^\/[A-Za-z0-9._@+/-]*$/.test(path) &&
    posix.normalize(path) === path &&
    (path === '/' || !path.endsWith('/')) &&
    !path.split('/').includes('..')
  );
}

export function validateRequestedPaths(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > MAX_DISK_PATHS || !input.every(validDiskPath))
    throw new ResourceError(400, 'Invalid disk paths.');
  return [...new Set(input)];
}

/** DASHBOARD_EXTRA_DISKS: comma-separated absolute host paths; invalid entries are skipped (and reported). */
export function parseExtraDisks(raw: string | undefined) {
  const paths: string[] = [],
    invalid: string[] = [];
  for (const entry of (raw ?? '').split(',').map(item => item.trim())) {
    if (!entry) continue;
    if (validDiskPath(entry)) {
      if (!paths.includes(entry)) paths.push(entry);
    } else invalid.push(entry);
  }
  return { paths: paths.slice(0, MAX_DISK_PATHS), invalid };
}

/** The helper's script: the paths it mounts at /m/<index>, then every ZFS dataset it can see beneath them. */
export function diskScript(count: number) {
  const targets = Array.from({ length: count }, (_, index) => `/m/${index}`).join(' ');
  return `df -P -k -T ${targets} 2>/dev/null; echo ---; df -P -k -T -t zfs 2>/dev/null; true`;
}

type DfRow = { source: string; fstype: string; size: number; used: number; avail: number; mountpoint: string };
function dfRows(text: string): DfRow[] {
  const rows: DfRow[] = [];
  for (const line of text.split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 7 || fields[0] === 'Filesystem') continue;
    const [source, fstype, blocks, used, avail] = fields;
    const numbers = [blocks, used, avail].map(Number);
    if (!numbers.every(Number.isFinite)) continue;
    rows.push({
      source,
      fstype,
      size: numbers[0] * 1024,
      used: numbers[1] * 1024,
      avail: numbers[2] * 1024,
      mountpoint: fields.slice(6).join(' '),
    });
  }
  return rows;
}

/** Reads the helper's output back onto the requested paths (mounted in order at /m/0, /m/1, …). */
export function parseDiskOutput(output: string, paths: DiskPath[]) {
  const [measured = '', zfsPart = ''] = output.split(/^---$/m);
  const rows = dfRows(measured);
  const disks: MeasuredDisk[] = paths.map((entry, index) => {
    const row = rows.find(item => item.mountpoint === `/m/${index}`);
    return row
      ? { ...entry, source: row.source, fstype: row.fstype, size: row.size, used: row.used, avail: row.avail }
      : { ...entry, error: 'unavailable' };
  });
  const zfs = new Map<string, ZfsDataset>();
  for (const row of dfRows(zfsPart))
    if (row.fstype === 'zfs') zfs.set(row.source, { dataset: row.source, used: row.used, avail: row.avail });
  return { disks, zfs: [...zfs.values()] };
}
