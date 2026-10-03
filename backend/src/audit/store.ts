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

/** Categories the dashboard filters by: event kinds start with these prefixes. */
export const AUDIT_CATEGORIES = {
  signin: 'auth.',
  agents: 'agent.',
  computers: 'computer.',
  organizations: 'organization.',
  system: 'system.',
} as const;
export type AuditCategory = keyof typeof AUDIT_CATEGORIES;

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
          detail: input.detail ? JSON.stringify(input.detail).slice(0, 2000) : null,
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
        ...(category ? { kind: { startsWith: AUDIT_CATEGORIES[category] } } : {}),
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
      detail: row.detail ? (JSON.parse(row.detail) as Record<string, unknown>) : null,
    }));
    return { events, next: rows.length > take ? events.at(-1)!.sequence : null };
  }

  /** Drops events older than a year, then the oldest beyond the cap. Returns how many went. */
  async prune(now = Date.now()) {
    await this.platform.initialize();
    const client = this.platform.client;
    const old = await client.auditEvent.deleteMany({ where: { at: { lt: new Date(now - AUDIT_KEEP_DAYS * DAY) } } });
    const cutoff = await client.auditEvent.findFirst({
      orderBy: { sequence: 'desc' },
      skip: AUDIT_MAX_EVENTS,
      select: { sequence: true },
    });
    const extra = cutoff
      ? await client.auditEvent.deleteMany({ where: { sequence: { lte: cutoff.sequence } } })
      : { count: 0 };
    return old.count + extra.count;
  }
}
