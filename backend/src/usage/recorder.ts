import type { PlatformStore } from '../platform-store';
import { CODEX_CONNECTION } from '../codex-provider';

/** What a model call was for (the dashboard's breakdown). */
export type UsagePurpose =
  'turn' | 'triage' | 'watch' | 'todo' | 'heartbeat' | 'sleep' | 'compaction' | 'discord' | 'other';

/** Pi's usage block, as assistant messages and compaction results carry it. */
export type PiUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  totalTokens?: number;
  cost?: { total?: number };
};

export type UsageRow = {
  at: Date;
  agentId: string;
  provider: string;
  model: string;
  purpose: UsagePurpose;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  cost: number;
  /** `entry:<agentId>:<entryId>` for a message of the agent's saved session (shared with the backfill), else null. */
  sourceKey: string | null;
  /** The endpoint that answered, when known (a fallback model's); else the agent's own (withEndpoints). */
  endpointId?: string;
};

type Log = { error: (detail: unknown, message?: string) => void };

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

/** A usage row from Pi's usage block, or undefined when the provider reported none (all zeros). */
export function usageRow(
  usage: PiUsage | undefined,
  fields: Omit<UsageRow, 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'reasoning' | 'cost'>,
): UsageRow | undefined {
  if (!usage) return undefined;
  const row = {
    ...fields,
    input: Math.round(count(usage.input)),
    output: Math.round(count(usage.output)),
    cacheRead: Math.round(count(usage.cacheRead)),
    cacheWrite: Math.round(count(usage.cacheWrite)),
    reasoning: Math.round(count(usage.reasoning)),
    cost: count(usage.cost?.total),
  };
  return row.input || row.output || row.cacheRead || row.cacheWrite || row.cost ? row : undefined;
}

/**
 * Inserts rows, skipping those whose sourceKey is already saved (SQLite's createMany cannot skip duplicates). A row
 * written meanwhile by the other writer (live recording vs. backfill) only costs a per-row retry, never a double count.
 */
export async function insertUsage(
  database: PlatformStore,
  rows: (Omit<UsageRow, 'endpointId'> & { endpointId: string | null })[],
) {
  if (!rows.length) return 0;
  const client = database.client;
  const keys = rows.flatMap(row => (row.sourceKey ? [row.sourceKey] : []));
  const saved = keys.length
    ? new Set(
        (await client.usageEvent.findMany({ where: { sourceKey: { in: keys } }, select: { sourceKey: true } })).map(
          row => row.sourceKey,
        ),
      )
    : new Set<string | null>();
  const seen = new Set<string>();
  const fresh = rows.filter(row => {
    if (!row.sourceKey) return true;
    if (saved.has(row.sourceKey) || seen.has(row.sourceKey)) return false;
    seen.add(row.sourceKey);
    return true;
  });
  if (!fresh.length) return 0;
  try {
    return (await client.usageEvent.createMany({ data: fresh })).count;
  } catch {
    let written = 0;
    for (const row of fresh)
      try {
        await client.usageEvent.create({ data: row });
        written++;
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error;
      }
    return written;
  }
}

/**
 * Model usage, written off the model call's path: rows are queued and flushed in small batches about once a second;
 * a failed write is logged and dropped, never thrown at the caller. Unconfigured (tests, tools), it records nothing.
 */
export class UsageRecorder {
  private database?: PlatformStore;
  private log?: Log;
  private queue: UsageRow[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private flushing: Promise<void> = Promise.resolve();

  constructor(
    private flushMs = 1000,
    private maxQueue = 10_000,
  ) {}

  configure(database: PlatformStore | undefined, log?: Log) {
    this.database = database;
    this.log = log;
    if (!database) {
      this.queue = [];
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  record(row: UsageRow | undefined) {
    if (!row || !this.database) return;
    if (this.queue.length >= this.maxQueue) {
      this.queue.shift();
      this.log?.error({ maxQueue: this.maxQueue }, 'Model usage queue full: dropped the oldest row');
    }
    this.queue.push(row);
    if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.flushMs);
      this.timer.unref?.();
    }
  }

  /** Writes everything queued so far (also for shutdown and tests). Never rejects. */
  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const batch = this.queue.splice(0);
    const database = this.database;
    if (!batch.length || !database) return this.flushing;
    this.flushing = this.flushing.then(async () => {
      try {
        for (let start = 0; start < batch.length; start += 200)
          await insertUsage(database, await withEndpoints(database, batch.slice(start, start + 200)));
      } catch (error) {
        this.log?.error(error, 'Model usage could not be saved');
      }
    });
    return this.flushing;
  }
}

/** The saved endpoint (OpenRouter/custom) each agent uses now; the ChatGPT subscription is not an endpoint. */
export async function withEndpoints(database: PlatformStore, rows: UsageRow[]) {
  const ids = [...new Set(rows.map(row => row.agentId))];
  const agents = await database.client.agent.findMany({
    where: { id: { in: ids } },
    select: { id: true, endpointId: true },
  });
  const endpoints = new Map(agents.map(agent => [agent.id, agent.endpointId]));
  return rows.map(row => {
    const endpointId = row.endpointId ?? endpoints.get(row.agentId);
    return {
      ...row,
      endpointId: endpointId && endpointId !== CODEX_CONNECTION && row.provider !== 'openai-codex' ? endpointId : null,
    };
  });
}

/** The process's recorder: model call sites record into it; the backend configures it at start-up. */
export const usageRecorder = new UsageRecorder();
