import { readFile, realpath, statfs } from 'node:fs/promises';

/**
 * Host CPU, memory and the platform data folder's filesystem, read from /proc and statfs. The backend's container
 * has no lxcfs, so /proc/stat and /proc/meminfo describe the whole host.
 */
export type CpuTimes = { idle: number; total: number };

/** The aggregate "cpu" line of /proc/stat: idle includes iowait; guest time is already counted in user/nice. */
export function parseProcStat(text: string): CpuTimes | null {
  const line = text.split('\n').find(item => item.startsWith('cpu '));
  if (!line) return null;
  const fields = line.trim().split(/\s+/).slice(1, 9).map(Number);
  if (fields.length < 4 || !fields.every(Number.isFinite)) return null;
  const [, , , idle, iowait = 0] = fields;
  return { idle: idle + iowait, total: fields.reduce((sum, value) => sum + value, 0) };
}

/** Busy share of all CPUs between two readings, 0–100 with one decimal; null without elapsed time. */
export function cpuPercent(previous: CpuTimes, next: CpuTimes): number | null {
  const elapsed = next.total - previous.total;
  if (elapsed <= 0) return null;
  const busy = elapsed - (next.idle - previous.idle);
  return Math.round(Math.min(100, Math.max(0, (busy / elapsed) * 100)) * 10) / 10;
}

/** Used = MemTotal − MemAvailable (what programs could not get back), in bytes. */
export function parseMeminfo(text: string): { used: number; total: number } | null {
  const kib = (name: string) => {
    const match = new RegExp(`^${name}:\\s+(\\d+) kB`, 'm').exec(text);
    return match ? Number(match[1]) * 1024 : null;
  };
  const total = kib('MemTotal'),
    available = kib('MemAvailable');
  if (total === null || available === null) return null;
  return { used: Math.max(0, total - available), total };
}

export type Mount = { mountpoint: string; fstype: string; source: string };
const unescape = (value: string) =>
  value.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
/** /proc/self/mountinfo: "id parent major:minor root mountpoint options [optional…] - fstype source superoptions". */
export function parseMountinfo(text: string): Mount[] {
  const mounts: Mount[] = [];
  for (const line of text.split('\n')) {
    const fields = line.split(' ');
    const separator = fields.indexOf('-', 6);
    if (separator < 0 || fields.length < separator + 3) continue;
    mounts.push({
      mountpoint: unescape(fields[4]),
      fstype: fields[separator + 1],
      source: unescape(fields[separator + 2]),
    });
  }
  return mounts;
}

/** The mount a path lives on: the deepest mount point containing it (the last one wins when stacked). */
export function mountOf(mounts: Mount[], path: string) {
  const within = (mountpoint: string) => mountpoint === '/' || path === mountpoint || path.startsWith(`${mountpoint}/`);
  let found: Mount | null = null;
  for (const mount of mounts)
    if (within(mount.mountpoint) && (!found || mount.mountpoint.length >= found.mountpoint.length)) found = mount;
  return found;
}

export type HostReaders = {
  procStat(): Promise<string>;
  meminfo(): Promise<string>;
  mountinfo(): Promise<string>;
  statfs(path: string): Promise<{ bsize: number; blocks: number; bfree: number; bavail: number }>;
  realpath(path: string): Promise<string>;
};
export const procReaders: HostReaders = {
  procStat: () => readFile('/proc/stat', 'utf8'),
  meminfo: () => readFile('/proc/meminfo', 'utf8'),
  mountinfo: () => readFile('/proc/self/mountinfo', 'utf8'),
  statfs: path => statfs(path),
  realpath: path => realpath(path),
};

/** Where the platform data folder lives (its filesystem's source device or ZFS dataset) and how full that is. */
export async function measureFolder(readers: HostReaders, folder: string) {
  const path = await readers.realpath(folder);
  const mount = mountOf(parseMountinfo(await readers.mountinfo()), path);
  if (!mount) return null;
  const stats = await readers.statfs(path);
  return {
    source: mount.source,
    fstype: mount.fstype,
    size: stats.blocks * stats.bsize,
    used: (stats.blocks - stats.bfree) * stats.bsize,
    avail: stats.bavail * stats.bsize,
  };
}
