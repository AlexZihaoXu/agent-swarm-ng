import type { DockerApi } from './docker-api';

/**
 * LXCFS (docs/computers.md#lxcfs): the computer's own memory, swap, CPU count and load in these files, so `free`,
 * `top`, `getconf` and most runtimes see the computer's caps rather than the host's.
 */
export const LXCFS_FILES = [
  '/proc/meminfo',
  '/proc/cpuinfo',
  '/proc/stat',
  '/proc/loadavg',
  '/proc/diskstats',
  '/sys/devices/system/cpu/online',
] as const;

/** COMPUTER_LXCFS: on unless the operator turns it off. */
export function lxcfsEnabled(value: string | undefined) {
  return !/^(off|0|false|no)$/i.test(value?.trim() ?? '');
}

export type LxcfsOutcome = 'bound' | 'not-ready' | 'not-bound' | 'failed';
/** lxcfs/remount.c's exit statuses. */
export function lxcfsOutcome(exitCode: number | null): LxcfsOutcome {
  return exitCode === 0 ? 'bound' : exitCode === 3 ? 'not-ready' : exitCode === 4 ? 'not-bound' : 'failed';
}

type Daemon = { id: string; generation: string };

/**
 * Binds LXCFS's files into running computers. The lxcfs compose service (lxcfs/) runs the binding: it is already
 * privileged and in the host's PID namespace, so no further privileged container is ever made. Its `lxcfs-remount`
 * clones the files' mounts there and then joins only the computer's user and mount namespaces; nothing from the
 * computer is executed. Computers carry no Docker bind for LXCFS, so they always start, with or without it.
 *
 * - `attach`: right after the controller starts a computer. If LXCFS is unavailable it starts as before (host
 *   values) and a warning is logged.
 * - `refresh`: after the lxcfs service restarts, the old binds in running computers are dead ("Transport endpoint
 *   is not connected"); they are replaced in place. A computer where that fails is marked stale (restart it).
 */
export class LxcfsBinder {
  private readonly stale = new Set<string>();
  /** Started by the controller while lxcfs was not ready: bound as soon as it is. */
  private readonly pending = new Set<string>();
  /** Desktop container id → the lxcfs generation it was last bound to (or found without binds) by a refresh. */
  private readonly refreshed = new Map<string, string>();
  constructor(
    private readonly docker: DockerApi,
    private readonly namespace: string,
    readonly enabled: boolean,
    private readonly log: (message: string) => void = message => console.warn(`computer-controller: ${message}`),
  ) {}

  /** The running lxcfs service of this Compose project; its generation changes whenever it restarts. */
  private async daemon(): Promise<Daemon | null> {
    const filters = encodeURIComponent(
      JSON.stringify({
        label: [`com.docker.compose.project=${this.namespace}`, 'com.docker.compose.service=lxcfs'],
        status: ['running'],
      }),
    );
    const rows = await this.docker.json<{ Id: string }[]>('GET', `/containers/json?filters=${filters}`);
    if (rows.length !== 1) return null;
    const inspected = await this.docker.optional<{ Id: string; State?: { Running?: boolean; StartedAt?: string } }>(
      `/containers/${encodeURIComponent(rows[0].Id)}/json`,
    );
    if (!inspected?.State?.Running) return null;
    return { id: inspected.Id, generation: `${inspected.Id}:${inspected.State.StartedAt ?? ''}` };
  }

  /** The running desktop's container id and main process, or null when it is not running. */
  private async process(desktop: string) {
    const inspected = await this.docker.optional<{ Id: string; State?: { Running?: boolean; Pid?: number } }>(
      `/containers/${encodeURIComponent(desktop)}/json`,
    );
    const pid = inspected?.State?.Pid;
    if (!inspected?.State?.Running || !Number.isInteger(pid) || !pid || pid <= 1) return null;
    return { id: inspected.Id, pid };
  }

  private async bind(daemon: Daemon, desktop: { id: string; pid: number }, refresh: boolean): Promise<LxcfsOutcome> {
    const result = await this.docker.execResult(
      daemon.id,
      ['lxcfs-remount', String(desktop.pid), ...(refresh ? ['refresh'] : [])],
      'root',
      15_000,
      64 * 1024,
    );
    const outcome = lxcfsOutcome(result.exitCode);
    if (outcome === 'failed') {
      // Paths and system error names only: nothing from the computer's files or environment.
      const detail = `${result.stdout}\n${result.stderr}`.trim().split('\n').slice(-2).join('; ').slice(0, 300);
      this.log(`LXCFS bind failed for computer container ${desktop.id.slice(0, 12)}: ${detail}`);
    }
    return outcome;
  }

  /** After the controller started a computer (its container name or id): never throws, never blocks the start. */
  async attach(desktopRef: string) {
    if (!this.enabled) return;
    try {
      const desktop = await this.process(desktopRef);
      if (!desktop) return;
      this.stale.delete(desktop.id);
      this.refreshed.delete(desktop.id);
      const daemon = await this.daemon();
      const outcome = daemon ? await this.bind(daemon, desktop, false) : 'not-ready';
      if (outcome === 'bound') this.refreshed.set(desktop.id, daemon!.generation);
      else if (outcome === 'failed') this.stale.add(desktop.id);
      else {
        // Bound by a later refresh once lxcfs is up.
        this.pending.add(desktop.id);
        this.log('LXCFS is not ready; the computer shows host memory and CPUs until it is.');
      }
    } catch (error) {
      this.log(`LXCFS bind skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Called periodically with the running computers' container ids. After lxcfs (re)starts, replaces each one's
   * LXCFS binds in place; computers without binds are left alone, except ones the controller started while lxcfs
   * was not ready, which are bound now. While lxcfs is not ready, a later call tries again.
   */
  async refresh(runningDesktopIds: string[]) {
    const alive = new Set(runningDesktopIds);
    for (const id of [...this.refreshed.keys()]) if (!alive.has(id)) this.refreshed.delete(id);
    for (const set of [this.stale, this.pending]) for (const id of [...set]) if (!alive.has(id)) set.delete(id);
    if (!this.enabled) return;
    const daemon = await this.daemon();
    if (!daemon) return;
    for (const id of runningDesktopIds) {
      if (this.refreshed.get(id) === daemon.generation) continue;
      let outcome: LxcfsOutcome;
      try {
        const desktop = await this.process(id);
        if (!desktop) continue;
        outcome = await this.bind(daemon, desktop, !this.pending.has(id));
      } catch (error) {
        this.log(`LXCFS refresh failed: ${error instanceof Error ? error.message : String(error)}`);
        outcome = 'failed';
      }
      if (outcome === 'not-ready') return;
      this.refreshed.set(id, daemon.generation);
      this.pending.delete(id);
      if (outcome === 'failed') this.stale.add(id);
      else this.stale.delete(id);
    }
  }

  /** Its LXCFS view could not be restored in place: restarting the computer fixes it. */
  isStale(desktopId: string) {
    return this.stale.has(desktopId);
  }
}
