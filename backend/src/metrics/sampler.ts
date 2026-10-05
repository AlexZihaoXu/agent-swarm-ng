import type { ComputerController } from '../computer-controller-client';
import { computerStorageFolders } from '../computer-storage-routes';
import type { PlatformStore } from '../platform-store';
import { DISK_FULL } from '../security/alerts';

/** Below this share a full disk counts as freed, and crossing DISK_FULL again notifies again. */
const DISK_REARM = 0.88;
import { groupDisks, type DiskMeasurement, type DiskUse } from './disks';
import {
  cpuPercent,
  measureFolder,
  parseMeminfo,
  parseDiskstats,
  parseHostNet,
  parseProcStat,
  procReaders,
  rate,
  totals,
  type CpuTimes,
  type HostReaders,
} from './host';

/**
 * The dashboard's resource history: host CPU/memory and each running computer once a minute, the disks the platform
 * uses every five minutes, samples kept two weeks (model usage and run spans 400 days). Sampling never throws or
 * blocks the backend: a failed sample is logged and skipped. Nothing runs until `start()` (index.ts), so tests sample only when they ask.
 */
export const SAMPLE_INTERVAL_MS = 60_000;
export const DISK_INTERVAL_MS = 5 * 60_000;
export const PRUNE_INTERVAL_MS = 3_600_000;
export const SAMPLE_RETENTION_DAYS = 14;
/** Model usage and agent run spans: long enough for a year-on-year look back. */
export const USAGE_RETENTION_DAYS = 400;
/** The controller measures at most this many requested folders (computer-controller/src/disks.ts). */
export const MAX_REQUESTED_DISKS = 16;
const PRUNE_BATCH = 500;

type Log = { error(object: unknown, message: string): void };
export type SamplerOptions = {
  readers?: HostReaders;
  log?: Log;
  now?: () => Date;
  /** A disk crossed DISK_FULL (again only after dropping below 88%, or after a restart): notifies admin. */
  onDiskFull?: (disk: { label: string; percent: number }) => void;
};

export class MetricsSampler {
  private readonly readers: HostReaders;
  private readonly log: Log;
  private readonly now: () => Date;
  private previousCpu: CpuTimes | null = null;
  private previousIo: { at: number; io: HostIo } | null = null;
  private readonly busy = new Set<string>();
  private readonly full = new Set<string>();

  constructor(
    private readonly database: PlatformStore,
    private readonly controller: ComputerController | null,
    options: SamplerOptions = {},
  ) {
    this.readers = options.readers ?? procReaders;
    this.log = options.log ?? { error: (object, message) => console.error(message, object) };
    this.now = options.now ?? (() => new Date());
    this.onDiskFull = options.onDiskFull;
  }
  private readonly onDiskFull: SamplerOptions['onDiskFull'];

  /** Host CPU since the previous call and memory now. The first call only takes the CPU baseline. */
  async sampleSystem() {
    const times = parseProcStat(await this.readers.procStat());
    const memory = parseMeminfo(await this.readers.meminfo());
    const previous = this.previousCpu;
    this.previousCpu = times;
    if (!previous) {
      // The first call takes the baselines (CPU, and the network and disk counters) and stores nothing.
      const io = await readIo(this.readers).catch(() => null);
      this.previousIo = io ? { at: this.now().getTime(), io } : null;
      return false;
    }
    if (!times || !memory) return false;
    const percent = cpuPercent(previous, times);
    if (percent === null) return false;
    // Network and disk throughput over the minute, from the counters' change since the previous sample.
    const at = this.now();
    const io = await readIo(this.readers).catch(() => null);
    const before = this.previousIo;
    this.previousIo = io ? { at: at.getTime(), io } : null;
    const seconds = before ? (at.getTime() - before.at) / 1000 : 0;
    const rates = ioRates(before?.io, io, seconds);
    await this.database.initialize();
    await this.database.client.systemSample.create({
      data: {
        at,
        cpuPercent: percent,
        memUsed: BigInt(memory.used),
        memTotal: BigInt(memory.total),
        netRx: rates.netRx,
        netTx: rates.netTx,
      },
    });
    if (rates.disks.size)
      await this.database.client.diskIoSample.createMany({
        data: [...rates.disks].map(([device, value]) => ({ at, device, ...value })),
      });
    return true;
  }

  /**
   * Each running computer's CPU (as a share of its own CPU quota, 0–100, like its card's dial) and memory. Docker
   * reports CPU summed across cores, so it is divided by the computer's core count when known.
   */
  async sampleComputers() {
    if (!this.controller) return 0;
    const observed = await this.controller.observe();
    const at = this.now();
    const data = [...observed]
      .filter(([, item]) => item.status === 'running' && item.cpuPercent !== null && item.memoryBytes !== null)
      .map(([computerId, item]) => ({
        at,
        computerId,
        cpuPercent: Math.round((item.cpuPercent! / Math.max(1, item.cpuCount ?? 1)) * 10) / 10,
        memUsed: BigInt(Math.round(item.memoryBytes!)),
        memLimit: item.memoryLimitBytes === null ? null : BigInt(Math.round(item.memoryLimitBytes)),
        memPercent: item.memoryLimitBytes ? Math.round((item.memoryBytes! / item.memoryLimitBytes) * 1000) / 10 : null,
      }));
    if (!data.length) return 0;
    await this.database.initialize();
    await this.database.client.computerSample.createMany({ data });
    return data.length;
  }

  /** The Keep/Cache folders in use: chosen in Settings now, or by existing computers when they were made. */
  private async storageFolders() {
    const settings = await computerStorageFolders(this.database);
    const computers = await this.database.client.computer.findMany({ select: { keepFolder: true, cacheFolder: true } });
    const uses = new Map<string, Set<DiskUse>>();
    const add = (folder: string | null, use: DiskUse) => {
      if (folder) uses.set(folder, (uses.get(folder) ?? new Set()).add(use));
    };
    for (const row of [settings, ...computers]) {
      add(row.keepFolder, 'computer keep');
      add(row.cacheFolder, 'computer cache');
    }
    return uses;
  }

  /** Each storage device the platform uses, once, with what lives there. */
  async sampleDisks() {
    const measurements: DiskMeasurement[] = [];
    let datasets: { dataset: string; used: number; avail: number }[] = [];
    try {
      const platform = await measureFolder(this.readers, this.database.dataDirectory);
      if (platform) measurements.push({ uses: ['platform data'], ...platform });
    } catch (error) {
      this.log.error(error, 'Measuring the platform data folder failed');
    }
    // Host paths need the controller (it holds the Docker socket); without it the platform folder's disk still counts.
    if (this.controller?.diskUsage)
      try {
        const folders = await this.storageFolders();
        // Settings' folders first; beyond the controller's limit the rest are left out rather than failing them all.
        const result = await this.controller.diskUsage([...folders.keys()].slice(0, MAX_REQUESTED_DISKS));
        for (const disk of result.disks) {
          if ('error' in disk) continue;
          const uses: DiskUse[] =
            disk.use === 'docker'
              ? ['docker']
              : disk.use === 'listed'
                ? ['listed']
                : [...(folders.get(disk.path) ?? [])];
          const { source, fstype, size, used, avail } = disk;
          measurements.push({ uses, source, fstype, size, used, avail });
        }
        datasets = result.zfs;
      } catch (error) {
        this.log.error(error, 'Measuring host disks through the computer controller failed');
      }
    const rows = groupDisks(measurements, datasets);
    if (!rows.length) return 0;
    const at = this.now();
    await this.database.initialize();
    await this.database.client.diskSample.createMany({
      data: rows.map(row => ({
        at,
        disk: row.disk,
        label: row.label,
        uses: JSON.stringify(row.uses),
        used: BigInt(row.used),
        total: BigInt(row.total),
      })),
    });
    for (const row of rows) {
      const share = row.total > 0 ? row.used / row.total : 0;
      if (share >= DISK_FULL && !this.full.has(row.disk)) {
        this.full.add(row.disk);
        this.onDiskFull?.({ label: row.label, percent: Math.round(share * 100) });
      }
      // Told again only after it had real room: a disk hovering around 90% is not news every sample.
      if (share < DISK_REARM) this.full.delete(row.disk);
    }
    return rows.length;
  }

  /**
   * Deletes samples older than their retention (14 days) and usage rows and run spans older than theirs (400 days),
   * a small batch per short transaction.
   */
  async prune(retentionDays = SAMPLE_RETENTION_DAYS, usageRetentionDays = USAGE_RETENTION_DAYS) {
    await this.database.initialize();
    const ago = (days: number) => new Date(this.now().getTime() - days * 86_400_000);
    const samples = ago(retentionDays),
      usage = ago(usageRetentionDays);
    const client = this.database.client;
    type Table = {
      findMany(args: object): Promise<{ sequence: number }[]>;
      deleteMany(args: object): Promise<{ count: number }>;
    };
    const tables: [Table, object][] = [
      [client.systemSample as unknown as Table, { at: { lt: samples } }],
      [client.diskSample as unknown as Table, { at: { lt: samples } }],
      [client.computerSample as unknown as Table, { at: { lt: samples } }],
      [client.diskIoSample as unknown as Table, { at: { lt: samples } }],
      [client.usageEvent as unknown as Table, { at: { lt: usage } }],
      [client.agentRunSpan as unknown as Table, { startedAt: { lt: usage } }],
    ];
    let removed = 0;
    for (const [table, where] of tables)
      while (true) {
        const batch = await table.findMany({
          where,
          select: { sequence: true },
          orderBy: { sequence: 'asc' },
          take: PRUNE_BATCH,
        });
        if (!batch.length) break;
        removed += (await table.deleteMany({ where: { sequence: { in: batch.map(row => row.sequence) } } })).count;
        if (batch.length < PRUNE_BATCH) break;
        await new Promise(resolve => setImmediate(resolve));
      }
    return removed;
  }

  /** One run of a task at a time, failures logged. */
  private run(name: string, task: () => Promise<unknown>) {
    if (this.busy.has(name)) return Promise.resolve();
    this.busy.add(name);
    return task()
      .catch(error => this.log.error(error, `Dashboard ${name} sampling failed`))
      .finally(() => this.busy.delete(name));
  }

  /** Starts the timers (unref'd: they never keep the process alive). Returns a stop function. */
  start() {
    const system = () => void this.run('system', () => this.sampleSystem());
    const computers = () => void this.run('computer', () => this.sampleComputers());
    const disks = () => void this.run('disk', () => this.sampleDisks());
    const prune = () => void this.run('retention', () => this.prune());
    system();
    disks();
    prune();
    const timers = [
      setInterval(() => (system(), computers()), SAMPLE_INTERVAL_MS),
      setInterval(disks, DISK_INTERVAL_MS),
      setInterval(prune, PRUNE_INTERVAL_MS),
    ];
    for (const timer of timers) timer.unref();
    return () => timers.forEach(clearInterval);
  }
}

export type HostIo = {
  /** Byte counters and the host uptime (s) when the sidecar read them; null without a fresh snapshot. */
  net: { rx: number; tx: number; at: number | null } | null;
  /** Bytes read and written so far per whole physical disk. */
  disks: Map<string, { read: number; write: number }>;
};

/** The host's network (via the host-net sidecar; null without it) and each physical disk's byte counters now. */
export async function readIo(readers: HostReaders): Promise<HostIo> {
  const [diskstats, hostNet, uptime] = await Promise.all([
    readers.diskstats(),
    readers.hostNet(),
    readers.uptime().catch(() => ''),
  ]);
  const interfaces = hostNet ? parseHostNet(hostNet) : null;
  const now = Number(uptime.split(' ')[0]);
  // A snapshot more than three seconds old means the sidecar stopped: no network figures rather than a flat zero.
  const stale = interfaces?.at != null && Number.isFinite(now) && now > 0 && now - interfaces.at > 3;
  return {
    net: interfaces?.size && !stale ? { ...totals(interfaces, ['rx', 'tx']), at: interfaces.at } : null,
    disks: parseDiskstats(diskstats),
  };
}

/** Bytes per second between two counter readings (null, or a missing disk, when unknown or a counter went back). */
export function ioRates(before: HostIo | null | undefined, after: HostIo | null, seconds: number) {
  const disks = new Map<string, { read: number; write: number }>();
  for (const [device, now] of after?.disks ?? []) {
    const then = before?.disks.get(device);
    const read = rate(then?.read, now.read, seconds),
      write = rate(then?.write, now.write, seconds);
    if (read !== null && write !== null) disks.set(device, { read, write });
  }
  // The network's interval is the sidecar's own (its snapshots are not in step with ours): the same snapshot twice is
  // no reading, not a zero followed by a double.
  const netSeconds = before?.net?.at != null && after?.net?.at != null ? after.net.at - before.net.at : seconds;
  return {
    netRx: rate(before?.net?.rx, after?.net?.rx, netSeconds),
    netTx: rate(before?.net?.tx, after?.net?.tx, netSeconds),
    disks,
  };
}
