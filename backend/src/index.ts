import { buildApp } from './app';
import { PlatformStore } from './platform-store';
import { computerControllerFromEnv } from './computer-controller-client';
import { ComputerStore } from './computer-store';
import { reconcileStoppedComputers, watchStoppedComputers } from './computer-power';
import { ActivityStore, DEFAULT_ACTIVITY_RETENTION_DAYS } from './activity-store';
import { backupDatabase, DEFAULT_DATABASE_BACKUPS } from './database-backup';
import { join } from 'node:path';
import { backfillUsageHistory, startUsageRecording } from './usage/backfill';
import { usageRecorder } from './usage/recorder';
import { MetricsSampler } from './metrics/sampler';
import { detectOutage } from './security/outage';

process.umask(0o077);
let stopPowerWatch = () => {};
let stopSampler = () => {};
const database = new PlatformStore();
await database.initialize();
const app = await buildApp({ database });
// Dashboard: model usage and agent run spans are recorded from here on; earlier ones are backfilled after listen.
startUsageRecording(database, app.log);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.audit.record({ kind: 'system.stop', outcome: 'ok', actor: 'system', detail: { signal } });
    stopPowerWatch();
    stopSampler();
    // Usage rows still queued (up to a second's worth) go in before the database closes.
    await usageRecorder.flush().catch(error => app.log.error(error, 'Usage flush failed'));
    void app.close().catch(error => {
      app.log.error(error);
      process.exitCode = 1;
    });
  });
}

await app.listen({
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 3000),
});
void backfillUsageHistory(database, app.log);
// Down without a clean stop since the last minute sample? A banner says so (before this start is recorded).
await detectOutage(database, app.alerts).catch(error => app.log.error(error, 'Outage check failed'));
await app.audit.record({
  kind: 'system.start',
  outcome: 'ok',
  actor: 'system',
  detail: { runtime: `Bun ${Bun.version}`, startupMs: Math.round(performance.now()) },
});
// The audit log keeps a year (at most 200,000 events): pruned at start and hourly.
const pruneAudit = () => void app.audit.prune().catch(error => app.log.error(error, 'Audit log pruning failed'));
pruneAudit();
setInterval(pruneAudit, 3_600_000).unref();
// The access log keeps 30 days, pruned hourly.
const pruneAccess = () => void app.access.prune().catch(error => app.log.error(error, 'Access log pruning failed'));
pruneAccess();
setInterval(pruneAccess, 3_600_000).unref();
// Re-apply explicit power-offs the controller's own boot reconciliation may
// have revived. Non-fatal: a controller outage must not block the dashboard.
const power = await reconcileStoppedComputers(new ComputerStore(database), computerControllerFromEnv());
if (power.considered) app.log.info({ power }, 'Computer power reconciliation finished');
// A controller-only restart revives powered-off computers without restarting this process, so keep re-applying the intent.
const powerStore = new ComputerStore(database);
stopPowerWatch = watchStoppedComputers(() => reconcileStoppedComputers(powerStore, computerControllerFromEnv()));
// Bound the operator activity archive. ACTIVITY_RETENTION_DAYS=0 keeps everything.
const retentionDays = Number(process.env.ACTIVITY_RETENTION_DAYS ?? DEFAULT_ACTIVITY_RETENTION_DAYS);
const activityStore = new ActivityStore(database);
const prune = () =>
  activityStore
    .prune(retentionDays)
    .then(removed => {
      if (removed) app.log.info({ removed, retentionDays }, 'Pruned old operator activity');
    })
    .catch(error => app.log.error(error, 'Activity pruning failed'));
void prune();
setInterval(() => void prune(), 6 * 3_600_000).unref();
// One copy of the database a day in .local/backups/database, the newest DATABASE_BACKUPS kept (0 turns it off).
const backups = Number(process.env.DATABASE_BACKUPS ?? DEFAULT_DATABASE_BACKUPS);
const backup = () =>
  backupDatabase(database, join(database.dataDirectory, 'backups', 'database'), backups)
    .then(made => {
      if (made) app.log.info({ file: made }, 'Saved the daily database backup');
    })
    .catch(error => app.log.error(error, 'Database backup failed'));
if (backups > 0) {
  void backup();
  setInterval(() => void backup(), 6 * 3_600_000).unref();
}
// The dashboard's resource history: host CPU/memory and running computers each minute, disks every 5 minutes, 14 days kept.
stopSampler = new MetricsSampler(database, computerControllerFromEnv(), { log: app.log }).start();
