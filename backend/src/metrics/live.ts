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

/** A reading every quarter second, the last minute of them kept. */
export const LIVE_INTERVAL_MS = 250;
export const LIVE_POINTS = 60_000 / LIVE_INTERVAL_MS;
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
 * The Dashboard's live minute: host CPU, memory, network and disk throughput four times a second, kept in memory (the
 * last minute of readings, nothing stored) and pushed to whoever follows the stream. Cheap: a few small /proc reads
 * each time. Runs only while the server listens.
 */
export class LiveMetrics {
  readonly points: LivePoint[] = [];
  /** Logical CPUs (the cpuN lines of /proc/stat). */
  cores: number | null = null;
  private previous: { at: number; cpu: CpuTimes | null; io: HostIo | null } | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private readonly listeners = new Set<(point: LivePoint) => void>();
  /** The last network snapshot that changed, when we took it, and the rate it gave. */
  private net: { snapshot: NonNullable<HostIo['net']>; at: number; rx: number | null; tx: number | null } | null = null;

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
      const point: LivePoint = {
        t: at,
        cpuPercent: before.cpu && cpu ? cpuPercent(before.cpu, cpu) : null,
        memUsed: memory?.used ?? null,
        memTotal: memory?.total ?? null,
        ...this.netRates(io?.net ?? null, at),
        disks: Object.fromEntries(ioRates(before.io, io, (at - before.at) / 1000).disks),
      };
      this.points.push(point);
      if (this.points.length > LIVE_POINTS) this.points.splice(0, this.points.length - LIVE_POINTS);
      for (const listener of this.listeners) listener(point);
    } finally {
      this.running = false;
    }
  }

  /**
   * The sidecar writes its snapshot about as often as we read it, out of step: a snapshot we already have keeps the
   * rate it gave for up to a second (the network did not pause), and the next new one is measured from it by the
   * sidecar's own clock.
   */
  private netRates(snapshot: HostIo['net'], at: number) {
    const previous = this.net;
    if (!snapshot) {
      this.net = null;
      return { netRx: null, netTx: null };
    }
    if (previous && snapshot.at != null && snapshot.at === previous.snapshot.at)
      // Held for a few of the sidecar's intervals; longer means it stopped, and that is a gap, not a flat line.
      return at - previous.at < 1000 ? { netRx: previous.rx, netTx: previous.tx } : { netRx: null, netTx: null };
    const { netRx, netTx } = previous
      ? ioRates(
          { net: previous.snapshot, disks: new Map() },
          { net: snapshot, disks: new Map() },
          (at - previous.at) / 1000,
        )
      : { netRx: null, netTx: null };
    this.net = { snapshot, at, rx: netRx, tx: netTx };
    return { netRx, netTx };
  }

  /** Each new reading as it is taken; returns the unsubscribe. */
  subscribe(listener: (point: LivePoint) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
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
    this.timer ??= setInterval(() => void this.tick(), LIVE_INTERVAL_MS);
    this.timer.unref?.();
    void this.tick();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
