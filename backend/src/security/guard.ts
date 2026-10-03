import type { AuditLog } from '../audit/store';
import type { PlatformStore } from '../platform-store';
import type { SwarmSettingsStore } from '../swarm-settings';
import type { Alerts } from './alerts';
import type { KnownAddresses } from './addresses';

const HOUR = 3_600_000;
/** Failed sign-ins in an hour (from any address) that raise a banner, before any lockdown. */
export const ALERT_FAILURES = 5;

type Failure = { at: number; ip: string; name: string };

/**
 * The lockdown (docs/login.md#known-addresses-and-lockdown): after Settings → Swarm's number of failed sign-ins (from any address)
 * within an hour, only trusted addresses may sign in until a trusted sign-in or the host's unlock command lifts it.
 * The flag is stored, so a restart keeps it; signed-in browsers keep working. Every failed sign-in counts (trusted
 * addresses can sign in during a lockdown anyway). A smaller burst raises a banner naming the accounts and addresses.
 */
export class SignInGuard {
  private failures: Failure[] = [];

  constructor(
    private readonly platform: PlatformStore,
    private readonly addresses: KnownAddresses,
    private readonly settings: SwarmSettingsStore,
    private readonly audit: AuditLog,
    private readonly alerts: Alerts,
    private readonly now: () => number = Date.now,
  ) {}

  async state() {
    await this.platform.initialize();
    return this.platform.client.lockdown.findUnique({ where: { id: 1 } });
  }

  /** Whether this address must be turned away now: locked down and not trusted. */
  async refuses(ip: string) {
    return Boolean(await this.state()) && !(await this.addresses.trusted(ip));
  }

  /** When the lockdown was last lifted (by any process: the host command runs outside the backend). */
  private async liftedAt() {
    await this.platform.initialize();
    const last = await this.platform.client.auditEvent.findFirst({
      where: { kind: 'auth.unlock' },
      orderBy: { sequence: 'desc' },
      select: { at: true },
    });
    return last?.at.getTime() ?? 0;
  }

  /**
   * A wrong password. Every failure counts, trusted addresses' too: a trusted address can sign in during a lockdown
   * anyway, while an address claimed through a trusted proxy must not guess without limit. Failures before the last
   * lift do not count.
   */
  async failed(ip: string, name: string) {
    const now = this.now();
    const lifted = await this.liftedAt();
    this.failures = [
      ...this.failures.filter(item => now - item.at < HOUR && item.at > lifted),
      { at: now, ip, name },
    ].slice(-1000);
    const recent = this.failures;
    if (recent.length >= ALERT_FAILURES) await this.alertFailures(recent).catch(() => undefined);
    const { lockdownFailures } = await this.settings.get();
    if (lockdownFailures > 0 && recent.length >= lockdownFailures && !(await this.state())) {
      // Only the first of concurrent failures creates it (and records it).
      const created = await this.platform.client.lockdown
        .create({ data: { id: 1, since: new Date(now), failures: recent.length } })
        .then(
          () => true,
          () => false,
        );
      if (!created) return;
      this.failures = [];
      await this.audit.record({
        kind: 'auth.lockdown',
        outcome: 'ok',
        actor: 'system',
        detail: { reason: `${recent.length} failed sign-ins within an hour`, addresses: summary(recent, 'ip') },
      });
    }
  }

  /** A correct password: from a trusted address, it lifts a lockdown. */
  async succeeded(ip: string, name: string) {
    if ((await this.state()) && (await this.addresses.trusted(ip))) await this.unlock(name, ip, 'trusted sign-in');
  }

  async unlock(actor: string, ip: string | null, reason: string) {
    await this.platform.initialize();
    const done = await this.platform.client.lockdown.deleteMany({ where: { id: 1 } });
    if (!done.count) return false;
    this.failures = [];
    await this.audit.record({ kind: 'auth.unlock', outcome: 'ok', actor, ip, detail: { reason } });
    return true;
  }

  private async alertFailures(recent: Failure[]) {
    const title = `${recent.length} failed sign-in attempts in the last hour`;
    const detail = `Names tried: ${summary(recent, 'name')}. From: ${summary(recent, 'ip')}.`;
    const startedAt = new Date(recent[0]!.at);
    // The latest banner of the hour, dismissed or not: a dismissed one stays dismissed (it is still updated).
    const latest = await this.alerts.latestSince('signin-failures', new Date(this.now() - HOUR));
    if (latest) await this.alerts.update(latest.id, { title, detail, endedAt: new Date(this.now()) });
    else await this.alerts.raise({ kind: 'signin-failures', title, detail, startedAt, endedAt: new Date(this.now()) });
  }
}

/** "Admin ×12, root ×3" — the most frequent first, at most five. */
function summary(items: Failure[], key: 'ip' | 'name') {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item[key], (counts.get(item[key]) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([value, count]) => `${value || '(none)'} ×${count}`)
    .join(', ');
}
