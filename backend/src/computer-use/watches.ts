import { createHash } from 'node:crypto';
import type { ImageContent } from '@earendil-works/pi-ai';
import type { PlatformStore } from '../platform-store';
import { WatchClaimError, type ComputerUseError, type ComputerUseService, type ScreenFrame } from './service';
import { terminalParameters, viewResult, viewTerminal } from './terminal-tools';
import { lookParameters } from './tools';
import type { AgentTool, Verdict } from './watch-judge';
import type { ComputerMonitors } from './monitors';

export const WATCH_MIN_SECONDS = 30;
export const WATCH_MAX_SECONDS = 3600;
/** A fork check re-sends the agent's whole context; it pays off only while the provider still caches it. */
export const WATCH_FORK_BELOW_SECONDS = 150;
export const WATCH_DEFAULT_TIMEOUT_SECONDS = 600;
export const WATCH_MAX_TIMEOUT_SECONDS = 24 * 60 * 60;
export const WATCH_UNTIL_MAX = 1000;
export const WATCH_MAX_ACTIVE = 3;
/** Repeating watches: the least time between two wake-ups by default, and how many firings at most. */
export const WATCH_REPEAT_DEFAULT_COOLDOWN_SECONDS = 60;
export const WATCH_REPEAT_DEFAULT_MAX_FIRES = 20;
export const WATCH_REPEAT_MAX_FIRES = 100;
/** A repeating watch survives this many failed checks in a row (with growing pauses) before it ends. */
const REPEAT_FAILURES = 3;
const REPEAT_BACKOFF_MAX_MS = 10 * 60 * 1000;

export class WatchError extends Error {}
/** A reason the watch cannot go on (not a failed check): it ends with this message. */
export class WatchEnd extends Error {}
/** The watched computer can no longer be used by this watch. */
class WatchLost extends Error {
  constructor(
    message: string,
    readonly next: string,
  ) {
    super(message);
  }
}
const lost = (error: ComputerUseError) =>
  /not running/i.test(error.message)
    ? new WatchLost(
        'the computer is not running (it was powered off)',
        'Ask the human to power it on (Computers tab) if you still need it, then claim it and set a new watch.',
      )
    : /uncertain/i.test(error.message)
      ? new WatchLost(
          'the computer is blocked after an operation whose outcome is uncertain',
          'Ask the human to Force release it, then claim it again and look before continuing.',
        )
      : new WatchLost(
          'you no longer hold that computer (the human force released it, or its assignment was removed)',
          'Claim it again with use_computer and set a new watch if you still need one.',
        );
export type Region = { x: number; y: number; size: number };
export type WatchSpec = {
  kind: 'terminal' | 'desktop';
  session?: string;
  region?: Region;
  until: string;
  everySeconds: number;
  timeoutSeconds?: number;
  checkNow?: boolean;
  context?: 'fresh' | 'fork';
  /** Keep watching after a firing (see Repeat). */
  repeat?: { cooldownSeconds?: number; maxFires?: number };
  human: boolean;
};
/**
 * A repeating watch fires once per occurrence: after a firing it re-arms only when a check no longer sees the
 * condition (`armed`), wakes the agent at most once per cooldown (firings meanwhile merge into `pending`), and
 * checks nothing while the agent's turn that received a wake-up is still running (`paused`).
 */
type Repeat = {
  cooldownMs: number;
  maxFires: number;
  fires: number;
  armed: boolean;
  paused: boolean;
  /** Failed checks in a row. */
  failures: number;
  lastWokenAt?: number;
  lastFiredAt?: number;
  lastReport?: string;
  /** The view when it last fired: a later "yes" on a different view with a different report is a new occurrence. */
  firedHash?: string;
  pending?: { count: number; firstAt: number; lastAt: number; report: string };
  wakeTimer?: ReturnType<typeof setTimeout>;
};
type Observation = { at: number; hash: string; text: string; frame?: ScreenFrame };
export type Watch = {
  id: string;
  agentId: string;
  computerId: string;
  computerName: string;
  /** The claim it was set under: a new claim (after a force release) does not carry it over. */
  claimToken: string;
  kind: 'terminal' | 'desktop';
  session?: string;
  sessionName?: string;
  region?: Region;
  until: string;
  everyMs: number;
  context: 'fresh' | 'fork';
  human: boolean;
  createdAt: number;
  deadline: number;
  nextAt: number;
  checks: number;
  baseline?: Observation;
  previous?: Observation;
  unchangedSince?: number;
  unchangedChecks: number;
  lastReason?: string;
  timer?: ReturnType<typeof setTimeout>;
  running?: AbortController;
  repeat?: Repeat;
};
/** Decides one check. It gets the check's text and images, and the watcher's read tools for a closer look. */
export type Judge = (
  watch: Watch,
  input: { text: string; images: ImageContent[]; tools: (vision: boolean) => AgentTool[] },
  signal: AbortSignal,
) => Promise<Verdict>;
/** Wakes the agent; `handled` settles when the turn that received the wake-up has ended (repeating watches wait). */
type Deliver = (agentId: string, text: string, human: boolean) => Promise<boolean | { handled: Promise<unknown> }>;

const iso = (ms: number) => new Date(ms).toISOString();
const seconds = (ms: number) => Math.round(ms / 1000);
const image = (frame: ScreenFrame): ImageContent => ({
  type: 'image',
  data: Buffer.from(frame.data).toString('base64'),
  mimeType: frame.mimeType,
});

/**
 * Watches on the computer an agent holds: at each interval a watcher looks (terminal text or a screenshot) and a
 * short-lived model check decides whether the agent's condition is met. A one-shot watch wakes the agent at the first
 * yes and is removed; a repeating one (Repeat) keeps going. A timeout, failed checks, and losing the computer end
 * either kind (the agent is told).
 * Checks never overlap and never grant the agent input allowance. Watches live in memory: a restart releases every
 * claim, so a restart ends them, and their rows exist only so the agent hears that it did.
 */
export class ComputerWatches {
  private watches = new Map<string, Watch>();
  /** Agents releasing or switching computers themselves: their watches' checks end quietly meanwhile. */
  private leaving = new Set<string>();
  /** Monitors (monitors.ts) share list_timers, cancel_timer, releasing and restart notices with watches. */
  monitors?: ComputerMonitors;
  /** Told when an agent's last fork watch is gone (its saved context is no longer needed). */
  onForkWatchesGone?: (agentId: string) => void;
  /** Watches being created, counted against the limit before their first await. */
  private creating = new Map<string, number>();
  private closed = false;
  private readonly startedAt: number;
  constructor(
    private database: PlatformStore,
    private computers: ComputerUseService,
    private deliver: Deliver,
    private judge: Judge,
    private now = () => Date.now(),
  ) {
    this.startedAt = now();
  }

  /** After a restart: every earlier watch ended with its claim; tell each agent once. */
  async start() {
    await this.database.initialize();
    // Only rows from before this process started: a watch set since then is live.
    const rows = await this.database.client.computerWatch.findMany({
      where: { createdAt: { lt: new Date(this.startedAt) } },
      orderBy: { createdAt: 'asc' },
    });
    if (!rows.length) return;
    await this.database.client.computerWatch.deleteMany({ where: { id: { in: rows.map(row => row.id) } } });
    for (const row of rows)
      await this.deliver(
        row.agentId,
        row.kind === 'monitor'
          ? `Your monitor ${row.id} (\`${row.until.slice(0, 200)}\`, started at ${row.createdAt.toISOString()}) stopped: the platform restarted, which releases every computer claim and stops its command. If you still need it, claim the computer again with use_computer and start a new monitor.`
          : `Your watch ${row.id} (${row.kind === 'terminal' ? 'watch_terminal' : 'watch_desktop'}, set at ${row.createdAt.toISOString()}) ended: the platform restarted, which releases every computer claim, so no check will run. Condition was: ${row.until}\nIf you still need it, claim the computer again with use_computer, look at the current state yourself, and set a new watch.`,
        row.human,
      ).catch(() => undefined);
  }
  close() {
    this.closed = true;
    this.monitors?.close();
    for (const watch of this.watches.values()) {
      clearTimeout(watch.timer);
      watch.running?.abort();
    }
    this.watches.clear();
  }

  async create(agentId: string, spec: WatchSpec) {
    const until = spec.until.trim();
    if (!until || until.length > WATCH_UNTIL_MAX)
      throw new WatchError(`Describe the condition in 1..${WATCH_UNTIL_MAX} characters.`);
    const every = spec.everySeconds;
    if (!Number.isFinite(every) || every < WATCH_MIN_SECONDS || every > WATCH_MAX_SECONDS)
      throw new WatchError(`every_seconds must be ${WATCH_MIN_SECONDS}..${WATCH_MAX_SECONDS}.`);
    const timeout = spec.timeoutSeconds ?? Math.max(WATCH_DEFAULT_TIMEOUT_SECONDS, every * 10);
    if (!Number.isFinite(timeout) || timeout < every || timeout > WATCH_MAX_TIMEOUT_SECONDS)
      throw new WatchError(`timeout_seconds must be from every_seconds up to ${WATCH_MAX_TIMEOUT_SECONDS} (24 hours).`);
    const context = spec.context ?? 'fresh';
    if (context === 'fork' && every >= WATCH_FORK_BELOW_SECONDS)
      throw new WatchError(
        `context "fork" needs every_seconds below ${WATCH_FORK_BELOW_SECONDS} (a longer gap loses the provider's cache of your context, so every check would pay for all of it). Use "fresh", or check more often.`,
      );
    const repeat = spec.repeat;
    if (repeat) {
      const cooldown = repeat.cooldownSeconds ?? Math.max(WATCH_REPEAT_DEFAULT_COOLDOWN_SECONDS, every);
      if (!Number.isFinite(cooldown) || cooldown < WATCH_MIN_SECONDS || cooldown > WATCH_MAX_SECONDS)
        throw new WatchError(`repeat.cooldown_seconds must be ${WATCH_MIN_SECONDS}..${WATCH_MAX_SECONDS}.`);
      const fires = repeat.maxFires ?? WATCH_REPEAT_DEFAULT_MAX_FIRES;
      if (!Number.isInteger(fires) || fires < 1 || fires > WATCH_REPEAT_MAX_FIRES)
        throw new WatchError(`repeat.max_fires must be 1..${WATCH_REPEAT_MAX_FIRES}.`);
    }
    const active = this.forAgent(agentId).length + (this.creating.get(agentId) ?? 0);
    if (active >= WATCH_MAX_ACTIVE)
      throw new WatchError(`At most ${WATCH_MAX_ACTIVE} watches at once; cancel one with cancel_timer first.`);
    // Reserve the slot now: several watch calls in one turn run in parallel.
    this.creating.set(agentId, (this.creating.get(agentId) ?? 0) + 1);
    try {
      return await this.admit(agentId, spec, { until, every, timeout, context });
    } finally {
      const left = (this.creating.get(agentId) ?? 1) - 1;
      if (left) this.creating.set(agentId, left);
      else this.creating.delete(agentId);
    }
  }
  private async admit(
    agentId: string,
    spec: WatchSpec,
    { until, every, timeout, context }: { until: string; every: number; timeout: number; context: 'fresh' | 'fork' },
  ) {
    const held = await this.computers.held(agentId);
    let sessionName: string | undefined;
    if (spec.kind === 'terminal') {
      const receipt = await this.computers.watchTerminal(agentId, held.computerId, held.token, {
        operation: 'status',
        session: spec.session,
      });
      if (receipt.error) throw new WatchError(`That terminal cannot be watched: ${receipt.error}`);
      sessionName = (receipt.result?.session as { name?: string } | undefined)?.name;
    }
    const row = await this.database.client.computerWatch.create({
      data: { agentId, computerId: held.computerId, kind: spec.kind, until, human: spec.human },
    });
    // A release or switch that ran alongside (in the same turn) must not leave this watch behind.
    try {
      await this.computers.watchClaim(agentId, held.computerId, held.token);
    } catch (error) {
      await this.database.client.computerWatch.deleteMany({ where: { id: row.id } });
      throw error;
    }
    const now = this.now();
    const watch: Watch = {
      id: row.id,
      agentId,
      computerId: held.computerId,
      computerName: held.name,
      claimToken: held.token,
      kind: spec.kind,
      session: spec.session,
      sessionName,
      region: spec.region,
      until,
      everyMs: every * 1000,
      context,
      human: spec.human,
      createdAt: now,
      deadline: now + timeout * 1000,
      nextAt: spec.checkNow === false ? now + every * 1000 : now,
      checks: 0,
      unchangedChecks: 0,
      ...(spec.repeat
        ? {
            repeat: {
              cooldownMs:
                (spec.repeat.cooldownSeconds ?? Math.max(WATCH_REPEAT_DEFAULT_COOLDOWN_SECONDS, every)) * 1000,
              maxFires: spec.repeat.maxFires ?? WATCH_REPEAT_DEFAULT_MAX_FIRES,
              fires: 0,
              armed: true,
              paused: false,
              failures: 0,
            },
          }
        : {}),
    };
    this.watches.set(watch.id, watch);
    this.schedule(watch);
    return this.view(watch);
  }
  list(agentId: string) {
    return [
      ...[...this.watches.values()].filter(watch => watch.agentId === agentId).map(watch => this.view(watch)),
      ...(this.monitors?.list(agentId) ?? []),
    ];
  }
  /** The agent's own cancel: removed quietly, no event. */
  async cancel(agentId: string, id: string) {
    const watch = this.watches.get(id);
    if (!watch || watch.agentId !== agentId) return (await this.monitors?.cancel(agentId, id)) ?? false;
    await this.remove(watch);
    return true;
  }
  /**
   * Runs the agent's own release or switch: checks interrupted by it end quietly, then its watches on any other
   * computer are removed. Returns the work's result and how many watches ended.
   */
  async releasing<T extends { computerId: string | null; write?: boolean }>(agentId: string, work: () => Promise<T>) {
    this.leaving.add(agentId);
    const before = this.forAgent(agentId);
    try {
      const monitorsBefore = this.monitors?.forAgent(agentId) ?? [];
      const result = await work();
      // Watches live on the claim: reading a computer without holding it keeps none.
      const kept = result.write === false ? null : result.computerId;
      await this.releasedBy(agentId, kept);
      // Counted from before: a check the release interrupted may already have ended its watch.
      return {
        result,
        ended: [...before, ...monitorsBefore].filter(item => item.computerId !== kept).length,
      };
    } finally {
      this.leaving.delete(agentId);
    }
  }
  /** The agent released or switched computers itself: its watches elsewhere end quietly. Returns how many. */
  async releasedBy(agentId: string, keepComputerId?: string | null) {
    const ended = [...this.watches.values()].filter(
      watch => watch.agentId === agentId && watch.computerId !== keepComputerId,
    );
    for (const watch of ended) await this.remove(watch);
    return ended.length + ((await this.monitors?.releasedBy(agentId, keepComputerId)) ?? 0);
  }
  forAgent(agentId: string) {
    return [...this.watches.values()].filter(watch => watch.agentId === agentId);
  }
  /** Runs a due check now (the scheduler does this on its own; tests call it to step a controlled clock). */
  async due() {
    const now = this.now();
    for (const watch of [...this.watches.values()]) {
      const repeat = watch.repeat;
      if (repeat?.pending && !repeat.paused && now >= (repeat.lastWokenAt ?? -Infinity) + repeat.cooldownMs)
        await this.wake(watch);
      const at = repeat?.paused ? watch.deadline : Math.min(watch.nextAt, watch.deadline);
      if (at <= now && !watch.running) await this.check(watch);
    }
  }

  private view(watch: Watch) {
    return {
      id: watch.id,
      kind: watch.kind === 'terminal' ? 'watch_terminal' : 'watch_desktop',
      computer: watch.computerName,
      ...(watch.session ? { session: watch.session, sessionName: watch.sessionName } : {}),
      ...(watch.region ? { region: watch.region } : {}),
      until: watch.until,
      everySeconds: watch.everyMs / 1000,
      context: watch.context,
      checks: watch.checks,
      nextCheckAt: iso(Math.min(watch.nextAt, watch.deadline)),
      timesOutAt: iso(watch.deadline),
      createdAt: iso(watch.createdAt),
      ...(watch.repeat
        ? {
            repeat: {
              fires: watch.repeat.fires,
              maxFires: watch.repeat.maxFires,
              cooldownSeconds: watch.repeat.cooldownMs / 1000,
              state: watch.repeat.paused
                ? 'paused while you handle its last wake-up'
                : watch.repeat.armed
                  ? 'armed'
                  : 'waiting for the condition to clear before it can fire again',
              ...(watch.repeat.lastFiredAt ? { lastFiredAt: iso(watch.repeat.lastFiredAt) } : {}),
            },
          }
        : {}),
    };
  }
  private schedule(watch: Watch) {
    clearTimeout(watch.timer);
    if (this.closed || !this.watches.has(watch.id)) return;
    // A repeating watch checks nothing while the agent is still handling its last wake-up, but still ends on time.
    const at = watch.repeat?.paused ? watch.deadline : Math.min(watch.nextAt, watch.deadline);
    watch.timer = setTimeout(() => void this.check(watch), Math.max(0, at - this.now()));
  }
  private async remove(watch: Watch) {
    clearTimeout(watch.timer);
    clearTimeout(watch.repeat?.wakeTimer);
    watch.running?.abort();
    this.watches.delete(watch.id);
    if (watch.context === 'fork' && !this.forAgent(watch.agentId).some(other => other.context === 'fork'))
      this.onForkWatchesGone?.(watch.agentId);
    await this.database.client.computerWatch.deleteMany({ where: { id: watch.id } }).catch(() => undefined);
  }
  /** Removes the watch and wakes its agent once with why. */
  private async end(watch: Watch, text: string) {
    if (!this.watches.has(watch.id)) return;
    await this.remove(watch);
    await this.deliver(watch.agentId, text, watch.human).catch(() => undefined);
  }
  private describe(watch: Watch) {
    const target =
      watch.kind === 'terminal'
        ? `terminal "${watch.sessionName ?? watch.session}" (${watch.session})`
        : watch.region
          ? `the desktop region x=${watch.region.x} y=${watch.region.y} size=${watch.region.size}`
          : 'the desktop';
    return `${target} on computer "${watch.computerName}"`;
  }

  private async check(watch: Watch) {
    if (this.closed || watch.running || !this.watches.has(watch.id)) return;
    const startedAt = this.now();
    if (watch.repeat?.paused && startedAt < watch.deadline) return;
    const label = `Your watch ${watch.id} on ${this.describe(watch)}`;
    const after = `set at ${iso(watch.createdAt)}; ${watch.checks} check(s) ran`;
    // Every watch gets at least one check, even one whose only check falls at its deadline.
    if (startedAt >= watch.deadline && watch.checks > 0)
      return this.end(
        watch,
        watch.repeat
          ? `${label} reached its time limit at ${iso(startedAt)} after firing ${watch.repeat.fires} time(s) (${after}).${this.unsent(watch)}\nCondition was: ${watch.until}\nThe watch is removed; set a new one if you still want to watch.`
          : `${label} timed out at ${iso(startedAt)} without the condition being seen (${after}${watch.lastReason ? `; the last check said: ${watch.lastReason}` : ''}).${this.stillness(watch, startedAt)}\nCondition was: ${watch.until}\nThe watch is removed. Look for yourself before deciding what to do; set a new watch if you still want to wait.`,
      );
    const controller = new AbortController();
    watch.running = controller;
    try {
      const observation = await this.observe(watch, controller.signal);
      if (observation === null) return await this.remove(watch);
      if (typeof observation === 'string')
        return await this.end(
          watch,
          `${label} ended at ${iso(this.now())}: ${observation} (${after}).\nCondition was: ${watch.until}\nThe watch is removed.`,
        );
      watch.checks++;
      const previous = watch.previous;
      if (previous && previous.hash === observation.hash) watch.unchangedChecks++;
      else {
        watch.unchangedSince = observation.at;
        watch.unchangedChecks = 0;
      }
      watch.baseline ??= observation;
      watch.previous = observation;
      const verdict = await this.judge(watch, this.checkInput(watch, observation, previous), controller.signal);
      if (!this.watches.has(watch.id)) return;
      if (watch.repeat) {
        watch.repeat.failures = 0;
        watch.lastReason = verdict.summary;
        // Edge triggered: a "yes" fires once the condition was not seen since the last firing, or when the view has
        // changed since then and the watcher reports something else (a second error before the first cleared).
        const fresh =
          !watch.repeat.armed &&
          observation.hash !== watch.repeat.firedHash &&
          verdict.summary.trim() !== (watch.repeat.lastReport ?? '').trim();
        if (!verdict.notify) watch.repeat.armed = true;
        else if (watch.repeat.armed || fresh) {
          await this.fire(watch, verdict.summary, observation);
          if (!this.watches.has(watch.id) || watch.repeat.paused) return;
        }
      } else if (verdict.notify)
        return await this.end(
          watch,
          `${label} fired at ${iso(this.now())} on check ${watch.checks} (${seconds(this.now() - watch.createdAt)}s after it was set).${this.stillness(watch, observation.at)}\nCondition: ${watch.until}\nWatcher's report: ${verdict.summary}\nThe watch is finished and removed; set a new one to keep watching. The report is the watcher's summary, not your own observation: look yourself (${watch.kind === 'terminal' ? 'terminal_view' : 'glance/look_at'}) before acting.`,
        );
      watch.lastReason = verdict.summary;
    } catch (error) {
      if (controller.signal.aborted || !this.watches.has(watch.id)) return;
      // The agent's own release or switch interrupted this check: that ends the watch quietly.
      if (this.leaving.has(watch.agentId)) return await this.remove(watch);
      const at = iso(this.now());
      const condition = `\nCondition was: ${watch.until}\nThe watch is removed.`;
      if (error instanceof WatchLost)
        return await this.end(watch, `${label} ended at ${at}: ${error.message} (${after}).${condition} ${error.next}`);
      if (error instanceof WatchEnd)
        return await this.end(watch, `${label} ended at ${at}: ${error.message} (${after}).${condition}`);
      const reason =
        error instanceof Error && error.name === 'AbortError'
          ? 'the check took longer than its time limit'
          : error instanceof Error
            ? error.message.slice(0, 300)
            : 'unknown error';
      // A repeating watch rides out a few failed checks (a slow or briefly failing model), waiting longer each time.
      if (watch.repeat && ++watch.repeat.failures < REPEAT_FAILURES) {
        watch.lastReason = `a check failed (${reason})`;
        watch.nextAt = this.now() + Math.min(watch.everyMs * 2 ** watch.repeat.failures, REPEAT_BACKOFF_MAX_MS);
        this.schedule(watch);
        return;
      }
      if (watch.repeat)
        return await this.end(
          watch,
          `${label} stopped at ${at}: ${REPEAT_FAILURES} checks in a row failed (the last: ${reason}) after it fired ${watch.repeat.fires} time(s) (${after}).${this.unsent(watch)} Look yourself.${condition} Set a new one if you still want to watch.`,
        );
      return await this.end(
        watch,
        `${label} stopped at ${at}: a check failed (${reason}), so the watcher could not decide (${after}). You are told in case the condition happened: look yourself.${condition} Set a new one if you still want to wait.`,
      );
    } finally {
      if (watch.running === controller) watch.running = undefined;
    }
    // One-shot checks keep their cadence from each start (one that overran is followed at once, never overlapped);
    // a repeating watch, which may run for hours, always leaves a full interval after a check, however long it took.
    watch.nextAt = watch.repeat ? this.now() + watch.everyMs : Math.max(this.now(), startedAt + watch.everyMs);
    this.schedule(watch);
  }
  /** Firings not delivered yet (merged during a cooldown), for a repeating watch's last message. */
  private unsent(watch: Watch) {
    const pending = watch.repeat?.pending;
    return pending
      ? ` It had fired ${pending.count} more time(s) since you were last woken (latest report: ${pending.report}).`
      : '';
  }
  /** A repeating watch saw a new occurrence: wake the agent now, or after the cooldown (merging), or end at the cap. */
  private async fire(watch: Watch, report: string, observation: Observation) {
    const repeat = watch.repeat!;
    const now = this.now();
    repeat.armed = false;
    repeat.fires++;
    repeat.lastFiredAt = now;
    repeat.lastReport = report;
    repeat.firedHash = observation.hash;
    const label = `Your repeating watch ${watch.id} on ${this.describe(watch)}`;
    if (repeat.fires >= repeat.maxFires)
      return this.end(
        watch,
        `${label} fired for the last time at ${iso(now)} (${repeat.fires} of at most ${repeat.maxFires}).${this.stillness(watch, observation.at)}${this.unsent(watch)}\nCondition: ${watch.until}\nWatcher's report: ${report}\nThe watch is removed; set a new one to keep watching. Look yourself before acting.`,
      );
    const pending = repeat.pending;
    repeat.pending = { count: (pending?.count ?? 0) + 1, firstAt: pending?.firstAt ?? now, lastAt: now, report };
    const wakeAt = (repeat.lastWokenAt ?? -Infinity) + repeat.cooldownMs;
    if (now >= wakeAt) return this.wake(watch);
    // Too soon after the last wake-up: wake once when the cooldown ends, with every firing since.
    clearTimeout(repeat.wakeTimer);
    repeat.wakeTimer = setTimeout(() => void this.wake(watch), wakeAt - now);
  }
  /** Delivers the pending firing(s), then checks nothing until the agent's turn that received them has ended. */
  private async wake(watch: Watch) {
    const repeat = watch.repeat!;
    const pending = repeat.pending;
    // Never while the agent is still handling the last wake-up: that turn's end delivers what is pending.
    if (!pending || !this.watches.has(watch.id) || repeat.paused) return;
    clearTimeout(repeat.wakeTimer);
    repeat.pending = undefined;
    repeat.lastWokenAt = this.now();
    repeat.paused = true;
    clearTimeout(watch.timer);
    const what =
      pending.count === 1
        ? `fired at ${iso(pending.lastAt)}`
        : `fired ${pending.count} times since you were last woken (first at ${iso(pending.firstAt)}, latest at ${iso(pending.lastAt)})`;
    const text = `Your repeating watch ${watch.id} on ${this.describe(watch)} ${what}: firing ${repeat.fires} of at most ${repeat.maxFires}.\nCondition: ${watch.until}\nWatcher's ${pending.count === 1 ? '' : 'latest '}report: ${pending.report}\nIt keeps watching: it pauses until this turn of yours ends, fires again only once the condition has cleared and comes back, and wakes you at most every ${repeat.cooldownMs / 1000}s. Stop it with cancel_timer({id: "${watch.id}"}). The report is the watcher's summary: look yourself (${watch.kind === 'terminal' ? 'terminal_view' : 'glance/look_at'}) before acting.`;
    const delivered = await this.deliver(watch.agentId, text, watch.human).catch(() => false);
    const handled = typeof delivered === 'object' ? delivered.handled : Promise.resolve();
    void handled
      .catch(() => undefined)
      .then(() => {
        if (!this.watches.has(watch.id)) return;
        repeat.paused = false;
        watch.nextAt = this.now() + watch.everyMs;
        this.schedule(watch);
        // Firings merged meanwhile go out once the cooldown allows (now, or by the cooldown timer).
        if (repeat.pending && this.now() >= (repeat.lastWokenAt ?? -Infinity) + repeat.cooldownMs)
          void this.wake(watch);
        else if (repeat.pending) {
          clearTimeout(repeat.wakeTimer);
          repeat.wakeTimer = setTimeout(
            () => void this.wake(watch),
            (repeat.lastWokenAt ?? 0) + repeat.cooldownMs - this.now(),
          );
        }
      });
  }
  private stillness(watch: Watch, at: number) {
    if (watch.unchangedSince === undefined || !watch.unchangedChecks) return '';
    return ` The ${watch.kind === 'terminal' ? 'terminal text' : 'screen'} had not changed for ${seconds(at - watch.unchangedSince)}s (${watch.unchangedChecks + 1} checks in a row).`;
  }

  /** A watch read; losing the computer (claim, assignment, power) ends the watch rather than failing a check. */
  private async read<T>(watch: Watch, work: () => Promise<T>) {
    try {
      return await work();
    } catch (error) {
      if (error instanceof WatchClaimError) throw lost(error);
      // A force release or power-off aborts the read in flight: say that, not that the check failed.
      const still = await this.computers.watchClaim(watch.agentId, watch.computerId, watch.claimToken).then(
        () => undefined,
        claimError => claimError,
      );
      if (still instanceof WatchClaimError) throw lost(still);
      throw error;
    }
  }
  /** The agent deleted a terminal itself: its watches on that terminal end quietly, whenever that was. */
  async terminalDeleted(agentId: string, computerId: string, session: string) {
    for (const watch of this.forAgent(agentId))
      if (watch.computerId === computerId && watch.session === session) await this.remove(watch);
  }

  /** The current view, or why the watch cannot continue. */
  private async observe(watch: Watch, signal: AbortSignal): Promise<Observation | string | null> {
    const at = this.now();
    if (watch.kind === 'terminal') {
      const receipt = await this.read(watch, () =>
        this.computers.watchTerminal(
          watch.agentId,
          watch.computerId,
          watch.claimToken,
          { operation: 'view', session: watch.session },
          signal,
        ),
      );
      if (receipt.error)
        // Deleting the watched terminal yourself ends the watch quietly, like your other deletes.
        return this.computers.deletedByAgent(watch.computerId, watch.session!)
          ? null
          : `the terminal can no longer be viewed (${receipt.error})`;
      const result = receipt.result as { text?: string; session?: Record<string, unknown> };
      const session = result.session ?? {};
      const state = session.alive
        ? `running${session.currentCommand ? ` "${session.currentCommand}"` : ''}`
        : `exited${session.exitCode === null || session.exitCode === undefined ? '' : ` with code ${session.exitCode}`}`;
      const text = `Terminal state: ${state}.\n${result.text ?? ''}`;
      return { at, text, hash: createHash('sha256').update(text).digest('hex') };
    }
    const frame = await this.read(watch, () =>
      this.computers.watchCapture(
        watch.agentId,
        watch.computerId,
        watch.claimToken,
        watch.region ? { kind: 'look_at', ...watch.region } : { kind: 'glance', quality: 'high' },
        signal,
      ),
    );
    return { at, text: '', frame, hash: createHash('sha256').update(frame.data).digest('hex') };
  }

  private checkInput(watch: Watch, current: Observation, previous?: Observation) {
    const change = !previous
      ? 'This is the first check.'
      : previous.hash === current.hash
        ? `Unchanged: identical to the previous check${watch.unchangedChecks > 1 ? `s` : ''} since ${iso(watch.unchangedSince!)} (${seconds(current.at - watch.unchangedSince!)}s, ${watch.unchangedChecks + 1} checks in a row).`
        : `Changed since the previous check at ${iso(previous.at)}.`;
    const baseline = watch.baseline !== current && watch.baseline!.hash !== current.hash ? watch.baseline : undefined;
    const what = watch.kind === 'terminal' ? 'terminal' : 'screen';
    const lines = [
      `Watch check ${watch.checks} at ${iso(current.at)} (every ${watch.everyMs / 1000}s; set at ${iso(watch.createdAt)}; times out at ${iso(watch.deadline)}).`,
      `Watching ${this.describe(watch)}.`,
      `Condition to watch for: ${watch.until}`,
      ...(watch.repeat?.lastReport
        ? [
            `This watch repeats. It last fired at ${iso(watch.repeat.lastFiredAt!)}, reporting: ${watch.repeat.lastReport}\nIf the condition is about something new happening (a new error, a new message), count only what is new since then.`,
          ]
        : []),
      `Since the previous check: ${change}`,
      watch.kind === 'terminal'
        ? `Current terminal view (text):\n${current.text}`
        : `Attached: the current ${watch.region ? 'region' : 'screen'}${baseline ? ', then the same view when the watch started' : ''}.`,
      ...(baseline && watch.kind === 'terminal'
        ? [`The ${what} when the watch started (${iso(baseline.at)}):\n${baseline.text}`]
        : []),
      baseline || !previous ? '' : `The ${what} is the same as when the watch started.`,
      `Answer NOTIFY: or KEEP_WATCHING:. ${watch.kind === 'terminal' ? 'terminal_view (colors:true for an image, up/rows to scroll) and terminal_status' : 'glance and look_at'} can look closer if needed.`,
    ].filter(Boolean);
    const images =
      watch.kind === 'desktop' ? [current, ...(baseline ? [baseline] : [])].map(item => image(item.frame!)) : [];
    return { text: lines.join('\n'), images, tools: (vision: boolean) => this.readTools(watch, vision) };
  }

  /** The watcher's look-only tools, bound to this watch's computer (and terminal). */
  private readTools(watch: Watch, vision: boolean): AgentTool[] {
    const { agentId, computerId } = watch;
    const computers = this.computers;
    const watchedTerminal = (request: Record<string, unknown>, signal?: AbortSignal) =>
      computers.watchTerminal(agentId, computerId, watch.claimToken, request, signal);
    const text = (value: unknown) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(value) }],
      details: {},
    });
    if (watch.kind === 'terminal') {
      const only = (session: string) => {
        if (session !== watch.session) throw new Error('This watch looks only at its own terminal.');
      };
      return [
        {
          name: 'terminal_view',
          label: 'Terminal view',
          description:
            "Look at the watched terminal: the current screen by default; up (rows above the live bottom) and rows (1..200) to scroll; colors:true adds an image with the terminal's colours.",
          parameters: terminalParameters.view,
          async execute(_id, params: any, signal) {
            only(params.session);
            return viewResult(
              await viewTerminal(request => watchedTerminal(request, signal), { ...params, operation: 'view' }),
              vision,
              undefined,
              Boolean(params.colors),
            ) as never;
          },
        },
        {
          name: 'terminal_status',
          label: 'Terminal status',
          description:
            'Alive/exited state, exit code, current directory and foreground command of the watched terminal.',
          parameters: terminalParameters.status,
          async execute(_id, params: any, signal) {
            only(params.session);
            const receipt = await watchedTerminal({ ...params, operation: 'status' }, signal);
            return text(receipt.error ? { error: receipt.error } : receipt.result) as never;
          },
        },
      ];
    }
    const look = (request: object) => async (_id: string, params: object, signal?: AbortSignal) => {
      const frame = await computers.watchCapture(
        agentId,
        computerId,
        watch.claimToken,
        { ...request, ...params },
        signal,
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ width: frame.width, height: frame.height, bounds: frame.bounds }),
          },
          image(frame),
        ],
        details: {},
      };
    };
    return [
      {
        name: 'glance',
        label: 'Look at whole desktop',
        description: 'A fresh screenshot of the whole desktop (quality low/medium/high/full).',
        parameters: lookParameters.glance,
        execute: look({ kind: 'glance' }) as never,
      },
      {
        name: 'look_at',
        label: 'Look at desktop region',
        description: 'A native-resolution crop around x,y with radius size, all in [0,999] desktop coordinates.',
        parameters: lookParameters.look_at,
        execute: look({ kind: 'look_at' }) as never,
      },
    ];
  }
}
