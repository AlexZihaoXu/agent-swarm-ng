import type { ComputerController } from './computer-controller-client';
import type { ComputerStore } from './computer-store';

/**
 * Re-apply the operator's power intent after a backend or controller restart.
 *
 * The controller's own boot reconciliation starts every owned desktop it finds,
 * which is right after a host reboot but would silently revive a computer the
 * operator explicitly turned off. The platform database is the only place that
 * intent is recorded, so the backend corrects it once at startup. Failures are
 * reported rather than thrown: a controller outage must not stop the dashboard
 * from booting, and the next restart retries.
 */
export async function reconcileStoppedComputers(store: ComputerStore, controller: ComputerController | null) {
  const summary = { considered: 0, stopped: 0, failed: 0 };
  if (!controller) return summary;
  const ids = await store.stoppedIds();
  summary.considered = ids.length;
  if (!ids.length) return summary;
  let observed: Map<string, { status: string }>;
  try {
    observed = await controller.observe();
  } catch {
    return { ...summary, failed: ids.length };
  }
  for (const id of ids) {
    if (observed.get(id)?.status !== 'running') continue;
    try {
      await controller.stop(id, (await store.get(id))?.name ?? '');
      summary.stopped += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}
