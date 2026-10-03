import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PlatformStore } from '../platform-store';
import { insertUsage, usageRecorder, usageRow, withEndpoints, type PiUsage, type UsageRow } from './recorder';
import { backfillRunSpans, closeInterruptedSpans, PROCESS_STARTED, runSpans } from './run-spans';

type Log = { error: (detail: unknown, message?: string) => void; info: (detail: unknown, message?: string) => void };

const yieldToEventLoop = () => new Promise<void>(resolve => setImmediate(resolve));

/**
 * Usage of the assistant messages already in agents' saved sessions, as purpose "turn" at the message's own time.
 * Each row's key is `entry:<agentId>:<entryId>`, the key live recording gives the same saved message, so running it
 * again or after live recording adds nothing. Reads in chunks by primary key and yields between them.
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
 * Written to the platform data folder once the history backfill has run to the end, so later starts skip it (and
 * never bring back rows the retention pruned). Bump the version to backfill again after a change to what it reads.
 */
export const BACKFILL_MARKER = '.dashboard-backfill-v1';

/**
 * In the background after start-up (never blocking it): closes the spans a restart left open (every start), then,
 * once per platform data folder, backfills spans and usage from what was saved before. Never rejects; a failed
 * backfill is tried again on the next start.
 */
export async function backfillUsageHistory(database: PlatformStore, log: Log) {
  const marker = join(database.dataDirectory, BACKFILL_MARKER);
  try {
    const closed = await closeInterruptedSpans(database, PROCESS_STARTED);
    if (closed) log.info({ closed }, 'Dashboard run spans a restart left open were closed');
    if (
      await access(marker).then(
        () => true,
        () => false,
      )
    )
      return;
    const spans = await backfillRunSpans(database, PROCESS_STARTED);
    const usage = await backfillUsage(database);
    await writeFile(marker, `${new Date().toISOString()}\n`);
    log.info({ spans, usage }, 'Dashboard usage and run spans backfilled');
  } catch (error) {
    log.error(error, 'Dashboard usage backfill failed');
  }
}
