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
  diskstats(): Promise<string>;
  /** /proc/uptime: the host's uptime in seconds (host-wide in a container). */
  uptime(): Promise<string>;
  /** The host-net sidecar's file; null when it is not running (no network figures then). */
  hostNet(): Promise<string | null>;
  /** A whole disk's model (or vendor) and size, from /sys/block (host-wide in a container). */
  blockInfo(device: string): Promise<{ model: string | null; bytes: number | null }>;
  mountinfo(): Promise<string>;
  statfs(path: string): Promise<{ bsize: number; blocks: number; bfree: number; bavail: number }>;
  realpath(path: string): Promise<string>;
};
export const procReaders: HostReaders = {
  procStat: () => readFile('/proc/stat', 'utf8'),
  meminfo: () => readFile('/proc/meminfo', 'utf8'),
  diskstats: () => readFile('/proc/diskstats', 'utf8'),
  uptime: () => readFile('/proc/uptime', 'utf8'),
  hostNet: () => readFile(process.env.HOST_NET_FILE ?? '/app/host-net/net', 'utf8').catch(() => null),
  blockInfo: async device => {
    const read = (name: string) =>
      readFile(`/sys/block/${device}/${name}`, 'utf8').then(
        text => text.trim() || null,
        () => null,
      );
    const [model, vendor, sectors] = await Promise.all([read('device/model'), read('device/vendor'), read('size')]);
    return { model: model ?? vendor, bytes: sectors ? Number(sectors) * 512 : null };
  },
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

/** Whole physical disks in /proc/diskstats (no partitions, loop, ram, zram or device-mapper devices). */
const WHOLE_DISK = /^(nvme\d+n\d+|sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|mmcblk\d+)$/;

/** Bytes read and written so far per whole disk (sectors are 512 bytes in /proc/diskstats). */
export function parseDiskstats(text: string) {
  const disks = new Map<string, { read: number; write: number }>();
  for (const line of text.split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 10 || !WHOLE_DISK.test(fields[2]!)) continue;
    const read = Number(fields[5]) * 512,
      write = Number(fields[9]) * 512;
    if (Number.isFinite(read) && Number.isFinite(write)) disks.set(fields[2]!, { read, write });
  }
  return disks;
}

/**
 * The host's physical network interfaces and their byte counters, from the `host-net` sidecar's file (compose.yaml):
 * the interface names with a device behind them, `---`, then the host's /proc/net/dev. The backend's own
 * /proc/net/dev would only show its container's network.
 */
export function parseHostNet(text: string) {
  const [head = '', table = ''] = text.split('\n---\n');
  const lines = head.split('\n').map(line => line.trim());
  // The first line is the host's uptime when the sidecar took the snapshot (seconds), so rates use its own clock.
  const stamp = /^\d+(\.\d+)?$/.test(lines[0] ?? '') ? Number(lines.shift()) : null;
  const physical = new Set(lines.filter(Boolean));
  const interfaces = new Map<string, { rx: number; tx: number }>();
  for (const line of table.split('\n')) {
    const at = line.indexOf(':');
    if (at < 0) continue;
    const name = line.slice(0, at).trim();
    if (!physical.has(name)) continue;
    const fields = line
      .slice(at + 1)
      .trim()
      .split(/\s+/)
      .map(Number);
    if (fields.length >= 9 && Number.isFinite(fields[0]) && Number.isFinite(fields[8]))
      interfaces.set(name, { rx: fields[0]!, tx: fields[8]! });
  }
  return Object.assign(interfaces, { at: stamp });
}

/** Sums of counters across devices, and per-second rates between two readings (a counter reset gives null). */
export const totals = <T extends Record<string, number>>(values: Map<string, T>, keys: (keyof T)[]) =>
  Object.fromEntries(keys.map(key => [key, [...values.values()].reduce((sum, value) => sum + value[key]!, 0)])) as {
    [K in keyof T]: number;
  };
export function rate(previous: number | null | undefined, next: number | null | undefined, seconds: number) {
  if (previous == null || next == null || seconds <= 0 || next < previous) return null;
  return (next - previous) / seconds;
}

/** "sda · SABRENT · 1.4 TB": the device, what it is, its size (decimal, as drives are sold). */
export function diskLabel(device: string, info: { model: string | null; bytes: number | null }) {
  const size = info.bytes
    ? info.bytes >= 1e12
      ? `${(info.bytes / 1e12).toFixed(1)} TB`
      : `${Math.round(info.bytes / 1e9)} GB`
    : null;
  return [device, info.model, size].filter(Boolean).join(' · ');
}
