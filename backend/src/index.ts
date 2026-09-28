import { buildApp } from './app';
import { PlatformStore } from './platform-store';
import { computerControllerFromEnv } from './computer-controller-client';
import { ComputerStore } from './computer-store';
import { reconcileStoppedComputers, watchStoppedComputers } from './computer-power';
import { ActivityStore, DEFAULT_ACTIVITY_RETENTION_DAYS } from './activity-store';

process.umask(0o077);
let stopPowerWatch = () => {};
const database = new PlatformStore();
await database.initialize();
const app = await buildApp({ database });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopPowerWatch();
    void app.close().catch((error) => {
      app.log.error(error);
      process.exitCode = 1;
    });
  });
}

await app.listen({
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 3000),
});
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
const prune = () => activityStore.prune(retentionDays).then(removed => { if (removed) app.log.info({ removed, retentionDays }, 'Pruned old operator activity'); }).catch(error => app.log.error(error, 'Activity pruning failed'));
void prune();
setInterval(() => void prune(), 6 * 3_600_000).unref();
