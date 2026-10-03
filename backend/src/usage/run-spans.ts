import type { PlatformStore } from '../platform-store';

type Log = { error: (detail: unknown, message?: string) => void };

/** When this backend process started: open spans older than this were left by a restart. */
export const PROCESS_STARTED = new Date();

/**
 * When each agent run was working (AgentRunSpan), for the dashboard's active hours. AgentRuns reports a run's start
 * (when it leaves the queue) and its end (completed, failed or stopped). Writes run in order, off the run's path;
 * a failure is logged, never thrown. Unconfigured (tests), it records nothing.
 */
export class RunSpans {
  private database?: PlatformStore;
  private log?: Log;
  private chain: Promise<void> = Promise.resolve();

  configure(database: PlatformStore | undefined, log?: Log) {
    this.database = database;
    this.log = log;
  }

  start(agentId: string, runId: string, at = new Date()) {
    this.write(async database => {
      await database.client.agentRunSpan.upsert({
        where: { runId },
        create: { agentId, runId, startedAt: at },
        update: {},
      });
    });
  }

  end(runId: string, at = new Date()) {
    this.write(async database => {
      await database.client.agentRunSpan.updateMany({ where: { runId, endedAt: null }, data: { endedAt: at } });
    });
  }

  /** Settles when every write so far is done. */
  settled() {
    return this.chain;
  }

  private write(work: (database: PlatformStore) => Promise<void>) {
    const database = this.database;
    if (!database) return;
    this.chain = this.chain.then(() =>
      work(database).catch(error => this.log?.error(error, 'Agent run span could not be saved')),
    );
  }
}

export const runSpans = new RunSpans();

/**
 * Spans a restart left open (started before this process) end at their run's last recorded activity, or at their
 * start when there is none. Returns how many were closed.
 */
export async function closeInterruptedSpans(database: PlatformStore, before = PROCESS_STARTED) {
  const open = await database.client.agentRunSpan.findMany({
    where: { endedAt: null, startedAt: { lt: before } },
    select: { runId: true, agentId: true, startedAt: true },
  });
  for (const span of open) {
    const last = await database.client.activity.aggregate({
      where: { agentId: span.agentId, runId: span.runId },
      _max: { timestamp: true },
    });
    const at = Math.min(
      Math.max(span.startedAt.getTime(), last._max.timestamp ?? 0),
      Math.max(span.startedAt.getTime(), before.getTime()),
    );
    await database.client.agentRunSpan.updateMany({
      where: { runId: span.runId, endedAt: null },
      data: { endedAt: new Date(at) },
    });
  }
  return open.length;
}

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const yieldToEventLoop = () => new Promise<void>(resolve => setImmediate(resolve));

/**
 * Spans for runs recorded before spans existed, from the operator activity archive (once per run: runId is unique, so
 * a later start finds them saved). Only agent runs count: their IDs are bare UUIDs, while standalone checks (watch,
 * sleep, idle compaction, Discord and reaction checks) have prefixed IDs. A heartbeat counts only if it was promoted.
 * The queue-time admission and run-status rows are left out, so a span covers the work, not the wait. Reads the
 * archive in sequence chunks and yields between them.
 */
export async function backfillRunSpans(database: PlatformStore, before = PROCESS_STARTED, chunk = 5000) {
  const top = await database.client.activity.aggregate({ _max: { sequence: true } });
  const last = top._max.sequence ?? 0;
  const runs = new Map<
    string,
    { agentId: string; first: number | null; last: number | null; heartbeat: boolean; promoted: boolean }
  >();
  for (let from = 0; from < last; from += chunk) {
    const rows = await database.client.$queryRaw<
      {
        runId: string;
        agentId: string;
        first: number | null;
        last: number | null;
        heartbeat: number | bigint;
        promoted: number | bigint;
      }[]
    >`SELECT "runId", "agentId",
        MIN(CASE WHEN "id" NOT LIKE '%:admission' AND "id" NOT LIKE '%:run-status' THEN "timestamp" END) AS "first",
        MAX(CASE WHEN "id" NOT LIKE '%:admission' AND "id" NOT LIKE '%:run-status' THEN "timestamp" END) AS "last",
        MAX("label" LIKE 'Heartbeat %') AS "heartbeat",
        MAX("label" = 'Heartbeat promoted') AS "promoted"
      FROM "Activity"
      WHERE "sequence" > ${from} AND "sequence" <= ${from + chunk} AND "timestamp" < ${before.getTime()}
      GROUP BY "runId", "agentId"`;
    for (const row of rows) {
      if (!RUN_ID.test(row.runId)) continue;
      const key = `${row.agentId}\n${row.runId}`;
      const seen = runs.get(key);
      const first = row.first == null ? null : Number(row.first);
      const end = row.last == null ? null : Number(row.last);
      runs.set(key, {
        agentId: row.agentId,
        first: seen?.first == null ? first : first == null ? seen.first : Math.min(seen.first, first),
        last: seen?.last == null ? end : end == null ? seen.last : Math.max(seen.last, end),
        heartbeat: Boolean(seen?.heartbeat) || Number(row.heartbeat) > 0,
        promoted: Boolean(seen?.promoted) || Number(row.promoted) > 0,
      });
    }
    await yieldToEventLoop();
  }
  const spans = [...runs].flatMap(([key, run]) =>
    run.first == null || run.last == null || (run.heartbeat && !run.promoted)
      ? []
      : [
          {
            agentId: run.agentId,
            runId: key.slice(key.indexOf('\n') + 1),
            startedAt: new Date(run.first),
            endedAt: new Date(run.last),
          },
        ],
  );
  let created = 0;
  for (let start = 0; start < spans.length; start += 500) {
    const batch = spans.slice(start, start + 500);
    const saved = new Set(
      (
        await database.client.agentRunSpan.findMany({
          where: { runId: { in: batch.map(span => span.runId) } },
          select: { runId: true },
        })
      ).map(span => span.runId),
    );
    const fresh = batch.filter(span => !saved.has(span.runId));
    try {
      created += fresh.length ? (await database.client.agentRunSpan.createMany({ data: fresh })).count : 0;
    } catch {
      // A run saved meanwhile: one by one, skipping it.
      for (const span of fresh)
        try {
          await database.client.agentRunSpan.create({ data: span });
          created++;
        } catch (error) {
          if ((error as { code?: string }).code !== 'P2002') throw error;
        }
    }
    await yieldToEventLoop();
  }
  return created;
}
