import type { PlatformStore } from './platform-store';

export const TIMER_NOTE_MAX = 256;
/** Timers may be set up to 30 days ahead; reminders repeat no more often than every 10 seconds. */
export const MAX_DELAY_SECONDS = 30 * 24 * 60 * 60;
export const MIN_REMINDER_SECONDS = 10;
/** Pending timers and reminders one agent may hold at once. */
export const MAX_ACTIVE_TIMERS = 25;

export type TimerKind = 'timer' | 'reminder';
type Row = {
  id: string;
  agentId: string;
  kind: string;
  note: string;
  nextAt: Date;
  intervalMs: number | null;
  total: number | null;
  fired: number;
  lastFiredAt: Date | null;
  human: boolean;
  createdAt: Date;
};
export type Deliver = (agentId: string, kind: TimerKind, text: string, human: boolean) => Promise<boolean>;

export class TimerError extends Error {}

/** What an agent sees about one of its timers. */
export function timerView(row: Row) {
  return {
    id: row.id,
    kind: row.kind as TimerKind,
    note: row.note,
    nextAt: row.nextAt.toISOString(),
    ...(row.intervalMs ? { everySeconds: row.intervalMs / 1000 } : {}),
    ...(row.kind === 'reminder' ? { fired: row.fired, total: row.total ?? 'unlimited' } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Agents' own timers and repeating reminders. They are rows in the platform database (committed before the tool
 * returns), so they survive restarts and power loss: on start the scheduler picks up what is pending, and anything
 * that came due while the platform was down fires once, saying how late it is. One scheduler handle always points
 * at the next due row; a firing is committed before it is delivered, so an event is never delivered twice.
 */
export class AgentTimers {
  private handle?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private again = false;
  private closed = false;
  constructor(
    private database: PlatformStore,
    private deliver: Deliver,
    private now = () => Date.now(),
  ) {}

  start() {
    this.wake();
  }
  close() {
    this.closed = true;
    clearTimeout(this.handle);
  }
  /** Resolves once no scheduler pass is running (tests and shutdown). */
  async idle() {
    while (this.running) await this.running;
  }
  /** Fires whatever is due now (the scheduler does this on its own; tests use it to step a controlled clock). */
  check() {
    this.wake();
    return this.idle();
  }

  async create(
    agentId: string,
    input: {
      kind: TimerKind;
      delaySeconds: number;
      everySeconds?: number;
      times?: number;
      note?: string;
      human: boolean;
    },
  ) {
    const note = (input.note ?? '').trim();
    if (note.length > TIMER_NOTE_MAX) throw new TimerError(`The note is limited to ${TIMER_NOTE_MAX} characters.`);
    if (!Number.isFinite(input.delaySeconds) || input.delaySeconds < 0 || input.delaySeconds > MAX_DELAY_SECONDS)
      throw new TimerError(`Choose a time from 0 to ${MAX_DELAY_SECONDS} seconds ahead (30 days).`);
    if (input.kind === 'reminder') {
      if (
        !Number.isFinite(input.everySeconds) ||
        input.everySeconds! < MIN_REMINDER_SECONDS ||
        input.everySeconds! > MAX_DELAY_SECONDS
      )
        throw new TimerError(`A reminder repeats every ${MIN_REMINDER_SECONDS} to ${MAX_DELAY_SECONDS} seconds.`);
      if (input.times !== undefined && (!Number.isInteger(input.times) || input.times < 1))
        throw new TimerError('times must be a whole number of at least 1 (leave it out to repeat until cancelled).');
      if (!note) throw new TimerError('A reminder needs a note saying what it is for.');
    } else if (input.delaySeconds < 1) throw new TimerError('A timer needs at least 1 second.');
    await this.database.initialize();
    if ((await this.database.client.agentTimer.count({ where: { agentId } })) >= MAX_ACTIVE_TIMERS)
      throw new TimerError(`At most ${MAX_ACTIVE_TIMERS} timers and reminders at once; cancel one first.`);
    const row = await this.database.client.agentTimer.create({
      data: {
        agentId,
        kind: input.kind,
        note,
        nextAt: new Date(this.now() + Math.round(input.delaySeconds * 1000)),
        intervalMs: input.kind === 'reminder' ? Math.round(input.everySeconds! * 1000) : null,
        total: input.kind === 'reminder' ? (input.times ?? null) : 1,
        human: input.human,
      },
    });
    this.wake();
    return timerView(row);
  }
  async list(agentId: string) {
    await this.database.initialize();
    const rows = await this.database.client.agentTimer.findMany({ where: { agentId }, orderBy: { nextAt: 'asc' } });
    return rows.map(timerView);
  }
  async cancel(agentId: string, id: string) {
    await this.database.initialize();
    const { count } = await this.database.client.agentTimer.deleteMany({ where: { agentId, id } });
    this.wake();
    return count > 0;
  }

  /** Re-aims the scheduler at the next due row; serialised so two passes never fire the same row. */
  private wake() {
    if (this.closed) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.pass()
      .catch(() => {})
      .finally(() => {
        this.running = undefined;
        if (this.again) {
          this.again = false;
          this.wake();
        }
      });
  }
  private async pass() {
    clearTimeout(this.handle);
    await this.database.initialize();
    const due = await this.database.client.agentTimer.findMany({
      where: { nextAt: { lte: new Date(this.now()) } },
      orderBy: { nextAt: 'asc' },
      take: 50,
    });
    for (const row of due) if (!this.closed) await this.fire(row);
    if (this.closed) return;
    const next = await this.database.client.agentTimer.findFirst({ orderBy: { nextAt: 'asc' } });
    if (!next) return;
    // Timers cap one wait at about 24.8 days; a longer wait simply re-checks then.
    const wait = Math.min(Math.max(0, next.nextAt.getTime() - this.now()), 2 ** 31 - 1);
    this.handle = setTimeout(() => this.wake(), wait);
  }
  private async fire(row: Row) {
    const now = this.now();
    const late = Math.max(0, now - row.nextAt.getTime());
    // Occurrences that fell due while the platform was down are counted, not replayed.
    const missed = row.intervalMs ? Math.floor(late / row.intervalMs) : 0;
    const index = row.fired + missed + 1;
    const final = row.total !== null && index >= row.total;
    if (final) await this.database.client.agentTimer.deleteMany({ where: { id: row.id } });
    else
      await this.database.client.agentTimer.update({
        where: { id: row.id },
        data: {
          fired: index,
          lastFiredAt: new Date(now),
          nextAt: new Date(row.nextAt.getTime() + (missed + 1) * row.intervalMs!),
        },
      });
    const text = eventText(row, { now, late, missed, index: Math.min(index, row.total ?? index), final });
    const delivered = await this.deliver(row.agentId, row.kind as TimerKind, text, row.human).catch(() => false);
    // An agent that no longer exists (or cannot run) drops its timers.
    if (!delivered && !(await this.database.findAgent(row.agentId)))
      await this.database.client.agentTimer.deleteMany({ where: { agentId: row.agentId } });
  }
}

const seconds = (ms: number) => Math.round(ms / 100) / 10;
function eventText(
  row: Row,
  { now, late, missed, index, final }: { now: number; late: number; missed: number; index: number; final: boolean },
) {
  const at = new Date(now).toISOString();
  const delay =
    late >= 2000
      ? ` It was due at ${row.nextAt.toISOString()} and is ${seconds(late)}s late (the platform was busy or offline).`
      : '';
  const note = `Note: ${row.note || '(none)'}`;
  if (row.kind === 'timer')
    return `Your timer ${row.id} fired at ${at}; you set it at ${row.createdAt.toISOString()}.${delay}\n${note}`;
  const previous = row.lastFiredAt ? `previous at ${row.lastFiredAt.toISOString()}` : 'this is the first';
  const skipped = missed
    ? ` ${missed} earlier occurrence(s) were missed while the platform was offline and are counted.`
    : '';
  const next = final
    ? 'This is the last reminder; it is now finished.'
    : `Next at ${new Date(row.nextAt.getTime() + (missed + 1) * row.intervalMs!).toISOString()}.`;
  return `Your reminder ${row.id} fired at ${at}: ${index}/${row.total ?? '∞'} (every ${seconds(row.intervalMs!)}s; ${previous}).${delay}${skipped} ${next}\n${note}`;
}
