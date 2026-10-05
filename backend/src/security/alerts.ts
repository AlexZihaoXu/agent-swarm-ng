import type { PlatformStore } from '../platform-store';

export type AlertView = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  startedAt: string;
  endedAt: string | null;
  /** Ongoing conditions (lockdown, full disk) cannot be dismissed: they end when the condition does. */
  dismissable: boolean;
  /** Where its logs are: an audit log category. */
  logs: 'signin' | 'system' | null;
};

/** A disk this full (used / total) raises an ongoing banner (until it is below again) and notifies admin. */
export const DISK_FULL = 0.9;

/** A critical event as it happens (a new banner, a lockdown, a disk filling up): for push notifications to admin. */
export type CriticalEvent = { kind: string; title: string; detail: string };

/** Stored critical events (outages, failed sign-in bursts), shown as banners until dismissed. */
export class Alerts {
  private readonly listeners = new Set<(event: CriticalEvent) => void>();

  constructor(private readonly platform: PlatformStore) {}

  /** Told of each critical event as it happens (docs/notifications.md). */
  listen(listener: (event: CriticalEvent) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Tells listeners of a critical event; one that throws never affects the caller. */
  announce(event: CriticalEvent) {
    for (const listener of this.listeners)
      try {
        listener(event);
      } catch {
        // A notification problem is not the caller's.
      }
  }

  async raise(input: { kind: string; title: string; detail: string; startedAt: Date; endedAt?: Date | null }) {
    await this.platform.initialize();
    const alert = await this.platform.client.alert.create({ data: { ...input, endedAt: input.endedAt ?? null } });
    this.announce({ kind: input.kind, title: input.title, detail: input.detail });
    return alert;
  }

  /** The latest alert of a kind since a time (dismissed or not), to update instead of adding another. */
  async latestSince(kind: string, since: Date) {
    await this.platform.initialize();
    return this.platform.client.alert.findFirst({
      where: { kind, startedAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, changes: { title?: string; detail?: string; endedAt?: Date | null }) {
    await this.platform.initialize();
    return this.platform.client.alert.update({ where: { id }, data: changes });
  }

  async open(): Promise<AlertView[]> {
    await this.platform.initialize();
    const rows = await this.platform.client.alert.findMany({
      where: { dismissedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map(row => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      detail: row.detail,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
      dismissable: true,
      logs: row.kind === 'signin-failures' ? 'signin' : row.kind === 'outage' ? 'system' : null,
    }));
  }

  async dismiss(id: string) {
    await this.platform.initialize();
    const done = await this.platform.client.alert.updateMany({
      where: { id, dismissedAt: null },
      data: { dismissedAt: new Date() },
    });
    return done.count === 1;
  }
}
