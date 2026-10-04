import type { PlatformStore } from '../platform-store';

export const AUDIT_KEEP_DAYS = 365;
export const AUDIT_MAX_EVENTS = 200_000;
const DAY = 86_400_000;

export type AuditOutcome = 'ok' | 'failed' | 'denied';
export type AuditInput = {
  kind: string;
  outcome: AuditOutcome;
  actor?: string | null;
  ip?: string | null;
  targetId?: string | null;
  targetName?: string | null;
  detail?: Record<string, unknown>;
};
export type AuditEventView = {
  sequence: number;
  at: string;
  kind: string;
  outcome: string;
  actor: string | null;
  ip: string | null;
  targetId: string | null;
  targetName: string | null;
  detail: Record<string, unknown> | null;
};

/** Categories the dashboard filters by, as the exact kinds in each (an indexed `kind IN (…)`). */
export const AUDIT_CATEGORIES = {
  signin: ['auth.login', 'auth.setup', 'auth.logout', 'auth.password', 'auth.lockdown', 'auth.unlock', 'auth.address'],
  agents: ['agent.create', 'agent.update', 'agent.delete'],
  computers: ['computer.create', 'computer.update', 'computer.delete'],
  organizations: ['organization.create', 'organization.update', 'organization.delete', 'organization.move'],
  users: ['user.create', 'user.update', 'user.delete'],
  system: ['system.start', 'system.stop'],
} as const;
export type AuditCategory = keyof typeof AUDIT_CATEGORIES;
const PRUNE_BATCH = 5_000;

/** Detail values stay short, so the stored JSON is always whole. */
function compact(detail: Record<string, unknown>) {
  const short = (value: unknown): unknown =>
    typeof value === 'string' ? value.slice(0, 200) : Array.isArray(value) ? value.slice(0, 30).map(short) : value;
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(detail)
        .slice(0, 20)
        .map(([key, value]) => [key, short(value)]),
    ),
  );
}

function parseDetail(text: string | null) {
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const clip = (value: string | null | undefined, size: number) => (value == null ? null : String(value).slice(0, size));

/**
 * The audit log (docs/audit-log.md). Writes never throw into the action they describe: a failed write is reported to
 * `onError` (the server log) and the action goes on.
 */
export class AuditLog {
  constructor(
    private readonly platform: PlatformStore,
    private readonly onEvent: (event: AuditInput & { at: string }) => void = () => {},
  ) {}

  async record(input: AuditInput, at = new Date()) {
    this.onEvent({ ...input, at: at.toISOString() });
    try {
      await this.platform.initialize();
      await this.platform.client.auditEvent.create({
        data: {
          at,
          kind: input.kind,
          outcome: input.outcome,
          actor: clip(input.actor, 120),
          ip: clip(input.ip, 64),
          targetId: clip(input.targetId, 120),
          targetName: clip(input.targetName, 200),
          detail: input.detail ? compact(input.detail) : null,
        },
      });
    } catch {
      // The action itself already happened (or was refused); losing its log line must not undo or fail it.
    }
  }

  /** Newest first, `limit` (≤200) events older than `before` (a sequence), optionally of one category. */
  async list({ category, before, limit = 50 }: { category?: AuditCategory; before?: number; limit?: number }) {
    await this.platform.initialize();
    const take = Math.min(Math.max(limit, 1), 200);
    const rows = await this.platform.client.auditEvent.findMany({
      where: {
        ...(category ? { kind: { in: [...AUDIT_CATEGORIES[category]] } } : {}),
        ...(before ? { sequence: { lt: before } } : {}),
      },
      orderBy: { sequence: 'desc' },
      take: take + 1,
    });
    const events: AuditEventView[] = rows.slice(0, take).map(row => ({
      sequence: row.sequence,
      at: row.at.toISOString(),
      kind: row.kind,
      outcome: row.outcome,
      actor: row.actor,
      ip: row.ip,
      targetId: row.targetId,
      targetName: row.targetName,
      detail: parseDetail(row.detail),
    }));
    return { events, next: rows.length > take ? events.at(-1)!.sequence : null };
  }

  /** Drops events older than a year, then the oldest beyond the cap, in short batches (no long write lock). */
  async prune(now = Date.now()) {
    await this.platform.initialize();
    const client = this.platform.client;
    const newest = await client.auditEvent.findFirst({ orderBy: { sequence: 'desc' }, select: { sequence: true } });
    if (!newest) return 0;
    const batches = async (where: object) => {
      let removed = 0;
      for (;;) {
        const batch = await client.auditEvent.findMany({ where, take: PRUNE_BATCH, select: { sequence: true } });
        if (!batch.length) return removed;
        const done = await client.auditEvent.deleteMany({
          where: { sequence: { in: batch.map(row => row.sequence) } },
        });
        removed += done.count;
      }
    };
    return (
      (await batches({ at: { lt: new Date(now - AUDIT_KEEP_DAYS * DAY) } })) +
      (await batches({ sequence: { lte: newest.sequence - AUDIT_MAX_EVENTS } }))
    );
  }
}
