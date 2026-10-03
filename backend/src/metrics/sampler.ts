import type { ComputerController } from '../computer-controller-client';
import { computerStorageFolders } from '../computer-storage-routes';
import type { PlatformStore } from '../platform-store';
import { groupDisks, type DiskMeasurement, type DiskUse } from './disks';
import {
  cpuPercent,
  measureFolder,
  parseMeminfo,
  parseProcStat,
  procReaders,
  type CpuTimes,
  type HostReaders,
} from './host';

/**
 * The dashboard's resource history: host CPU/memory and each running computer once a minute, the disks the platform
 * uses every five minutes, samples kept two weeks. Sampling never throws or blocks the backend: a failed sample is
 * logged and skipped. Nothing runs until `start()` (index.ts), so tests sample only when they ask.
 */
export const SAMPLE_INTERVAL_MS = 60_000;
export const DISK_INTERVAL_MS = 5 * 60_000;
export const PRUNE_INTERVAL_MS = 3_600_000;
export const SAMPLE_RETENTION_DAYS = 14;
const PRUNE_BATCH = 500;

type Log = { error(object: unknown, message: string): void };
export type SamplerOptions = { readers?: HostReaders; log?: Log; now?: () => Date };

export class MetricsSampler {
  private readonly readers: HostReaders;
  private readonly log: Log;
  private readonly now: () => Date;
  private previousCpu: CpuTimes | null = null;
  private readonly busy = new Set<string>();

  constructor(
    private readonly database: PlatformStore,
    private readonly controller: ComputerController | null,
    options: SamplerOptions = {},
  ) {
    this.readers = options.readers ?? procReaders;
    this.log = options.log ?? { error: (object, message) => console.error(message, object) };
    this.now = options.now ?? (() => new Date());
  }

  /** Host CPU since the previous call and memory now. The first call only takes the CPU baseline. */
  async sampleSystem() {
    const times = parseProcStat(await this.readers.procStat());
    const memory = parseMeminfo(await this.readers.meminfo());
    const previous = this.previousCpu;
    this.previousCpu = times;
    if (!times || !previous || !memory) return false;
    const percent = cpuPercent(previous, times);
    if (percent === null) return false;
    await this.database.initialize();
    await this.database.client.systemSample.create({
      data: { at: this.now(), cpuPercent: percent, memUsed: BigInt(memory.used), memTotal: BigInt(memory.total) },
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
        const result = await this.controller.diskUsage([...folders.keys()]);
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
    return rows.length;
  }

  /** Deletes samples older than the retention, a small batch per short transaction. */
  async prune(retentionDays = SAMPLE_RETENTION_DAYS) {
    await this.database.initialize();
    const before = new Date(this.now().getTime() - retentionDays * 86_400_000);
    const client = this.database.client;
    const tables = [client.systemSample, client.diskSample, client.computerSample] as unknown as {
      findMany(args: object): Promise<{ sequence: number }[]>;
      deleteMany(args: object): Promise<{ count: number }>;
    }[];
    let removed = 0;
    for (const table of tables)
      while (true) {
        const batch = await table.findMany({
          where: { at: { lt: before } },
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
