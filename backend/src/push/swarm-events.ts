import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PushNotifier } from './notifier';

/** A built image's version: the commit it was built from and its one-line summary (scripts/compose.sh). */
export type Version = { version: string; summary: string };
type Known = { backend?: string; frontend?: string };
type Log = { warn(object: object, message: string): void };

/** How often the frontend's version (written by its container at start) is looked at. */
export const FRONTEND_CHECK_MS = 60_000;

const usable = (version: Version | undefined): version is Version =>
  Boolean(version?.version) && version!.version !== 'dev';

/**
 * The Swarm's own notifications (docs/notifications.md): it started, it is stopping, and it was updated (the backend
 * or the frontend now runs another build than the last one seen). The last versions seen are kept in
 * `<data>/push/versions.json`, so an update is told once, whichever process restarts.
 */
export class SwarmEvents {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly deps: {
      push: PushNotifier;
      dataDirectory: string;
      backend: Version;
      /** The frontend's version now (its container writes it to the shared versions volume at start). */
      frontend: () => Promise<Version | undefined>;
      log: Log;
    },
  ) {}

  private file() {
    return join(this.deps.dataDirectory, 'push', 'versions.json');
  }

  private async known(): Promise<Known> {
    try {
      const value: unknown = JSON.parse(await readFile(this.file(), 'utf8'));
      return value && typeof value === 'object' ? (value as Known) : {};
    } catch {
      return {};
    }
  }

  private async remember(known: Known) {
    await mkdir(join(this.deps.dataDirectory, 'push'), { recursive: true, mode: 0o700 });
    await writeFile(this.file(), JSON.stringify(known), { mode: 0o600 });
  }

  /** What changed since the last versions seen ([] the first time: nothing to compare with). */
  private async changes() {
    const known = await this.known();
    const frontend = await this.deps.frontend().catch(() => undefined);
    const changed: Version[] = [];
    const next: Known = { ...known };
    for (const [part, version] of [
      ['backend', this.deps.backend],
      ['frontend', frontend],
    ] as const) {
      if (!usable(version)) continue;
      if (known[part] && known[part] !== version.version) changed.push(version);
      next[part] = version.version;
    }
    if (next.backend !== known.backend || next.frontend !== known.frontend) await this.remember(next);
    return changed;
  }

  private fail = (error: unknown) =>
    this.deps.log.warn({ err: error instanceof Error ? error.message : 'unknown' }, 'Push: Swarm notice skipped');

  private static described(changed: Version[]) {
    const latest = changed.at(-1)!;
    return latest.summary ? `Now on ${latest.version}: ${latest.summary}` : `Now on ${latest.version}.`;
  }

  /** At start: "updated" when a build changed (it also says it is running again), otherwise "started". */
  async started() {
    try {
      const changed = await this.changes();
      if (changed.length) await this.deps.push.swarm('update', 'Agent Swarm updated', SwarmEvents.described(changed));
      else await this.deps.push.swarm('start', 'Agent Swarm started', 'It is running again.');
    } catch (error) {
      this.fail(error);
    }
    // A frontend-only update does not restart the backend: look at its version now and then.
    this.timer = setInterval(() => void this.checkFrontend(), FRONTEND_CHECK_MS);
    this.timer.unref?.();
  }

  async checkFrontend() {
    try {
      const changed = await this.changes();
      if (changed.length) await this.deps.push.swarm('update', 'Agent Swarm updated', SwarmEvents.described(changed));
    } catch (error) {
      this.fail(error);
    }
  }

  /** Before the process ends: at most `waitMs`, so a slow push service never holds up a stop. */
  async stopping(waitMs = 3_000) {
    clearInterval(this.timer);
    await Promise.race([
      this.deps.push.swarm('stop', 'Agent Swarm stopping', 'It will be back when it starts again.').catch(this.fail),
      new Promise(resolve => setTimeout(resolve, waitMs).unref?.()),
    ]);
  }
}

/** This process's build (baked into the image) and the frontend's (its container writes it into /app/versions). */
export const backendVersion = (): Version => ({
  version: process.env.APP_VERSION ?? 'dev',
  summary: process.env.APP_SUMMARY ?? '',
});
export const readFrontendVersion =
  (folder = process.env.APP_VERSIONS_DIR ?? '/app/versions') =>
  async () => {
    const value: unknown = JSON.parse(await readFile(join(folder, 'frontend.json'), 'utf8'));
    if (!value || typeof value !== 'object' || typeof (value as Version).version !== 'string') return undefined;
    const { version, summary } = value as Version;
    return { version: version.slice(0, 40), summary: typeof summary === 'string' ? summary.slice(0, 120) : '' };
  };
