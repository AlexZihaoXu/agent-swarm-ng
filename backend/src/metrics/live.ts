import {
  cpuPercent,
  diskLabel,
  parseMeminfo,
  parseProcStat,
  procReaders,
  type CpuTimes,
  type HostReaders,
} from './host';
import { ioRates, readIo, type HostIo } from './sampler';

export const LIVE_POINTS = 60;
export type LivePoint = {
  t: number;
  cpuPercent: number | null;
  memUsed: number | null;
  memTotal: number | null;
  netRx: number | null;
  netTx: number | null;
  /** Bytes per second read and written per physical disk. */
  disks: Record<string, { read: number; write: number }>;
};

/**
 * The Dashboard's live minute: host CPU, memory, network and disk throughput every second, kept in memory (the last
 * 60 readings, nothing stored). Cheap: a few small /proc reads a second. Runs only while the server listens.
 */
export class LiveMetrics {
  readonly points: LivePoint[] = [];
  /** Logical CPUs (the cpuN lines of /proc/stat). */
  cores: number | null = null;
  private previous: { at: number; cpu: CpuTimes | null; io: HostIo | null } | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly readers: HostReaders = procReaders,
    private readonly now: () => number = Date.now,
  ) {}

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const at = this.now();
      const [stat, meminfo, io] = await Promise.all([
        this.readers.procStat().catch(() => ''),
        this.readers.meminfo().catch(() => ''),
        readIo(this.readers).catch(() => null),
      ]);
      const cpu = parseProcStat(stat);
      this.cores = stat.match(/^cpu\d+ /gm)?.length || this.cores;
      const memory = parseMeminfo(meminfo);
      const before = this.previous;
      this.previous = { at, cpu, io };
      if (!before) return;
      const seconds = (at - before.at) / 1000;
      this.points.push({
        t: at,
        cpuPercent: before.cpu && cpu ? cpuPercent(before.cpu, cpu) : null,
        memUsed: memory?.used ?? null,
        memTotal: memory?.total ?? null,
        ...(({ disks, ...net }) => ({ ...net, disks: Object.fromEntries(disks) }))(ioRates(before.io, io, seconds)),
      });
      if (this.points.length > LIVE_POINTS) this.points.splice(0, this.points.length - LIVE_POINTS);
    } finally {
      this.running = false;
    }
  }

  private labels = new Map<string, string>();
  /** Each physical disk's label ("sda · SABRENT · 1.4 TB"), read once per device. */
  async labelOf(device: string) {
    let label = this.labels.get(device);
    if (!label) {
      label = diskLabel(device, await this.readers.blockInfo(device).catch(() => ({ model: null, bytes: null })));
      this.labels.set(device, label);
    }
    return label;
  }

  start() {
    this.timer ??= setInterval(() => void this.tick(), 1000);
    this.timer.unref?.();
    void this.tick();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
