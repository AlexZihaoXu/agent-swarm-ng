import { readFile } from 'node:fs/promises';
import type { PlatformStore } from '../platform-store';
import type { Alerts } from './alerts';

/** A gap this long since the last minute sample, without a clean stop, is reported. */
export const OUTAGE_GAP_MS = 5 * 60_000;

/** The host's boot time from /proc/uptime (host-wide in the backend's container); null when unreadable. */
export async function hostBootTime(now = Date.now()) {
  const text = await readFile('/proc/uptime', 'utf8').catch(() => '');
  const seconds = Number(text.split(' ')[0]);
  return Number.isFinite(seconds) && seconds > 0 ? now - seconds * 1000 : null;
}

/**
 * At start-up: was the platform down without a clean stop? The host and computers are sampled every minute, so the
 * last sample marks when it was last running. A host that booted since then had a possible power outage (or an
 * unplanned restart); otherwise the backend crashed or was killed. A clean stop (system.stop in the audit log) is not
 * an outage. Raises a banner with the span.
 */
export async function detectOutage(platform: PlatformStore, alerts: Alerts, now = Date.now(), boot?: number | null) {
  await platform.initialize();
  const client = platform.client;
  const last = await client.systemSample.findFirst({ orderBy: { at: 'desc' }, select: { at: true } });
  if (!last || now - last.at.getTime() < OUTAGE_GAP_MS) return null;
  const clean = await client.auditEvent.findFirst({
    where: { kind: 'system.stop', at: { gte: new Date(last.at.getTime() - 2 * 60_000) } },
    select: { sequence: true },
  });
  if (clean) return null;
  // A crash loop restarts again and again: one banner for the same outage.
  const reported = await client.alert.findFirst({
    where: { kind: 'outage', startedAt: last.at },
    select: { id: true },
  });
  if (reported) return null;
  const booted = boot === undefined ? await hostBootTime(now) : boot;
  const hostRestarted = booted !== null && booted > last.at.getTime();
  return alerts.raise({
    kind: 'outage',
    title: hostRestarted ? 'Possible power outage' : 'The platform stopped unexpectedly',
    detail: hostRestarted
      ? `The host restarted at ${new Date(booted!).toISOString()} and the platform had not shut down cleanly.`
      : 'The backend was not running and did not shut down cleanly (a crash or a killed container).',
    startedAt: last.at,
    endedAt: new Date(now),
  });
}
