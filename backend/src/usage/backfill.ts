import type { PlatformStore } from '../platform-store';
import { insertUsage, usageRecorder, usageRow, withEndpoints, type PiUsage, type UsageRow } from './recorder';
import { backfillRunSpans, closeInterruptedSpans, PROCESS_STARTED, runSpans } from './run-spans';

type Log = { error: (detail: unknown, message?: string) => void; info: (detail: unknown, message?: string) => void };

const yieldToEventLoop = () => new Promise<void>(resolve => setImmediate(resolve));

/**
 * Usage of the assistant messages already in agents' saved sessions, as purpose "turn" at the message's own time.
 * Each row's key is `entry:<agentId>:<entryId>`, the key live recording gives the same saved message, so running it
 * again (every start) or after live recording adds nothing. Reads in chunks by primary key and yields between them.
 */
export async function backfillUsage(database: PlatformStore, chunk = 200) {
  let cursor: { agentId: string; position: number } | undefined;
  let created = 0;
  for (;;) {
    const rows = await database.client.agentSessionEntry.findMany({
      where: { payload: { contains: '"role":"assistant"' } },
      orderBy: [{ agentId: 'asc' }, { position: 'asc' }],
      take: chunk,
      ...(cursor ? { cursor: { agentId_position: cursor }, skip: 1 } : {}),
      select: { agentId: true, position: true, entryId: true, payload: true },
    });
    if (!rows.length) break;
    cursor = { agentId: rows.at(-1)!.agentId, position: rows.at(-1)!.position };
    const usage: UsageRow[] = [];
    for (const row of rows) {
      let message: { role?: string; usage?: PiUsage; provider?: string; model?: string; timestamp?: number };
      try {
        message = (JSON.parse(row.payload) as { type?: string; message?: typeof message }).message ?? {};
      } catch {
        continue;
      }
      if (message.role !== 'assistant' || typeof message.timestamp !== 'number') continue;
      const item = usageRow(message.usage, {
        at: new Date(message.timestamp),
        agentId: row.agentId,
        provider: message.provider ?? 'unknown',
        model: message.model ?? 'unknown',
        purpose: 'turn',
        sourceKey: `entry:${row.agentId}:${row.entryId}`,
      });
      if (item) usage.push(item);
    }
    created += await insertUsage(database, await withEndpoints(database, usage));
    if (rows.length < chunk) break;
    await yieldToEventLoop();
  }
  return created;
}

/** Starts usage and run-span recording (before any agent run can start). */
export function startUsageRecording(database: PlatformStore, log: Log) {
  usageRecorder.configure(database, log);
  runSpans.configure(database, log);
}

/**
 * In the background after start-up (never blocking it): closes the spans a restart left open, then backfills spans
 * and usage from what was saved before. Idempotent; never rejects.
 */
export async function backfillUsageHistory(database: PlatformStore, log: Log) {
  try {
    const closed = await closeInterruptedSpans(database, PROCESS_STARTED);
    const spans = await backfillRunSpans(database, PROCESS_STARTED);
    const usage = await backfillUsage(database);
    if (closed || spans || usage) log.info({ closed, spans, usage }, 'Dashboard usage and run spans backfilled');
  } catch (error) {
    log.error(error, 'Dashboard usage backfill failed');
  }
}
