import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { buildApp } from '../app';
import { prepareDatabase } from '../test-database';
import { SESSION_COOKIE } from '../auth/sessions';
import { contains, parseRange } from './addresses';
import { detectOutage } from './outage';
import { Alerts } from './alerts';

it('parses addresses and ranges, normalizing them, and matches clients', () => {
  expect(parseRange('100.64.1.2/10')?.text).toBe('100.64.0.0/10');
  expect(parseRange(' 192.0.2.10 ')?.text).toBe('192.0.2.10');
  expect(parseRange('2001:DB8:0:0::1/32')?.text).toBe('2001:db8::/32');
  expect(parseRange('::ffff:10.1.2.3')?.text).toBe('10.1.2.3');
  for (const bad of ['', 'home', '300.1.1.1', '10.0.0.0/33', '10.0.0.0/x', '192.0.2.4/8/9', '::ffff:0:0/96', 'g::1'])
    expect(parseRange(bad)).toBeNull();
  expect(parseRange('0:0:0:0:0:ffff:192.0.2.4')?.text).toBe('192.0.2.4');
  expect(parseRange('::ffff:c000:0204')?.text).toBe('192.0.2.4');
  const tailnet = parseRange('100.64.0.0/10')!.range;
  expect(contains(tailnet, '100.64.10.20')).toBe(true);
  expect(contains(tailnet, '::ffff:100.64.10.20')).toBe(true);
  expect(contains(tailnet, '192.0.2.10')).toBe(false);
  expect(contains(parseRange('2001:db8::/32')!.range, '2001:db8:1::5')).toBe(true);
});

async function fixture() {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const app = await buildApp({ database, computerController: null, requireLogin: true });
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    ip: string,
    payload?: object,
    cookie?: string,
  ) =>
    app.inject({
      method,
      url,
      headers: { host: '127.0.0.1:19090', 'x-real-ip': ip, ...(cookie ? { cookie } : {}) },
      ...(payload ? { payload } : {}),
    });
  const setup = await call('POST', '/api/auth/setup', '192.0.2.10', {
    name: 'Admin',
    password: 'correct horse battery',
  });
  const cookie = `${SESSION_COOKIE}=${setup.cookies.find(found => found.name === SESSION_COOKIE)!.value}`;
  return { app, database, call, cookie };
}

describe('known addresses, lockdown and alerts', { timeout: 120_000 }, () => {
  it('labels addresses in the audit log; a trusted address can still sign in during a lockdown its typos caused', async () => {
    const { app, call, cookie } = await fixture();
    try {
      const listed = await call(
        'POST',
        '/api/security/addresses',
        '192.0.2.10',
        { address: '192.0.2.10', label: 'Home', trusted: true },
        cookie,
      );
      expect(listed.json()).toMatchObject({
        yourAddress: '192.0.2.10',
        yourLabel: 'Home',
        yourTrusted: true,
        lockdown: null,
      });
      expect(
        (
          await call(
            'POST',
            '/api/security/addresses',
            '192.0.2.10',
            { address: '192.0.2.10', label: 'Again', trusted: false },
            cookie,
          )
        ).statusCode,
      ).toBe(400);
      await app.inject({
        method: 'PATCH',
        url: '/api/settings/swarm',
        headers: { host: '127.0.0.1:19090', cookie, 'x-real-ip': '192.0.2.10' },
        payload: { lockdownFailures: 3 },
      });
      // Every failure counts (an address claimed through a trusted proxy must not guess without limit)…
      for (let i = 0; i < 3; i++)
        await call('POST', '/api/auth/login', '192.0.2.10', { name: 'Admin', password: `typo ${i} xxxx` });
      expect((await call('GET', '/api/security', '192.0.2.10', undefined, cookie)).json().lockdown).not.toBeNull();
      // …but the trusted address signs in all the same, and that lifts it.
      expect(
        (await call('POST', '/api/auth/login', '192.0.2.10', { name: 'Admin', password: 'correct horse battery' }))
          .statusCode,
      ).toBe(200);
      expect((await call('GET', '/api/security', '192.0.2.10', undefined, cookie)).json().lockdown).toBeNull();
      const audit = (await call('GET', '/api/audit?category=signin', '192.0.2.10', undefined, cookie)).json().events;
      expect(audit.find((event: any) => event.ip === '192.0.2.10')).toMatchObject({ ipLabel: 'Home', ipTrusted: true });
    } finally {
      await app.close();
    }
  });

  it('keeps a host unlock: the next wrong password does not lock down again at once', async () => {
    const { app, database, call, cookie } = await fixture();
    try {
      await app.inject({
        method: 'PATCH',
        url: '/api/settings/swarm',
        headers: { host: '127.0.0.1:19090', cookie, 'x-real-ip': '192.0.2.10' },
        payload: { lockdownFailures: 4 },
      });
      for (let i = 0; i < 4; i++)
        await call('POST', '/api/auth/login', `203.0.113.${i}`, { name: 'Admin', password: `guess ${i} xxxx` });
      expect(await database.client.lockdown.count()).toBe(1);
      // The host command runs in its own process: it removes the row and records the lift.
      await database.client.lockdown.deleteMany();
      await app.audit.record({ kind: 'auth.unlock', outcome: 'ok', actor: 'host' });
      await call('POST', '/api/auth/login', '203.0.113.50', { name: 'Admin', password: 'one more guess' });
      expect(await database.client.lockdown.count()).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('locks down after the threshold, refuses untrusted sign-ins, alerts, and lifts on a trusted sign-in', async () => {
    const { app, call, cookie } = await fixture();
    try {
      await call(
        'POST',
        '/api/security/addresses',
        '192.0.2.10',
        { address: '192.0.2.10', label: 'Home', trusted: true },
        cookie,
      );
      await app.inject({
        method: 'PATCH',
        url: '/api/settings/swarm',
        headers: { host: '127.0.0.1:19090', cookie, 'x-real-ip': '192.0.2.10' },
        payload: { lockdownFailures: 6 },
      });
      for (let i = 0; i < 6; i++)
        expect(
          (
            await call('POST', '/api/auth/login', `203.0.113.${i}`, {
              name: i % 2 ? 'root' : 'Admin',
              password: `guess ${i} xxxx`,
            })
          ).statusCode,
        ).toBe(401);
      // Locked: even the right password from an untrusted address is refused, and the sign-in card is told.
      expect(
        (await call('POST', '/api/auth/login', '198.51.100.9', { name: 'Admin', password: 'correct horse battery' }))
          .statusCode,
      ).toBe(423);
      expect((await call('GET', '/api/auth/session', '198.51.100.9')).json()).toMatchObject({ lockedDown: true });
      // Signed-in browsers keep working; the banners name the lockdown and the burst.
      const alerts = (await call('GET', '/api/alerts', '198.51.100.9', undefined, cookie)).json().alerts;
      expect(alerts.map((alert: any) => [alert.kind, alert.dismissable, alert.logs])).toEqual([
        ['lockdown', false, 'signin'],
        ['signin-failures', true, 'signin'],
      ]);
      expect(alerts[1].detail).toContain('Admin ×3, root ×3');
      // Lifting from the dashboard needs a trusted address.
      expect((await call('POST', '/api/security/unlock', '198.51.100.9', {}, cookie)).statusCode).toBe(403);
      expect(
        (await call('POST', '/api/auth/login', '192.0.2.10', { name: 'Admin', password: 'correct horse battery' }))
          .statusCode,
      ).toBe(200);
      expect((await call('GET', '/api/security', '192.0.2.10', undefined, cookie)).json().lockdown).toBeNull();
      const kinds = (await call('GET', '/api/audit?category=signin', '192.0.2.10', undefined, cookie))
        .json()
        .events.map((event: any) => event.kind);
      expect(kinds).toContain('auth.lockdown');
      expect(kinds).toContain('auth.unlock');
      // A dismissed banner stays dismissed.
      expect((await call('POST', `/api/alerts/${alerts[1].id}/dismiss`, '192.0.2.10', {}, cookie)).json()).toEqual({
        ok: true,
      });
      expect((await call('GET', '/api/alerts', '192.0.2.10', undefined, cookie)).json().alerts).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('reports a possible power outage, a crash, and nothing after a clean stop', async () => {
    const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
    const alerts = new Alerts(database);
    const now = Date.parse('2026-10-03T12:00:00Z');
    await database.client.systemSample.create({
      data: { at: new Date(now - 2 * 3_600_000), cpuPercent: 1, memUsed: 1n, memTotal: 2n },
    });
    const outage = await detectOutage(database, alerts, now, now - 30 * 60_000);
    expect(outage).toMatchObject({ kind: 'outage', title: 'Possible power outage' });
    expect(outage!.startedAt.getTime()).toBe(now - 2 * 3_600_000);
    // A crash loop restarting again reports the same outage once.
    expect(await detectOutage(database, alerts, now + 60_000, now - 30 * 60_000)).toBeNull();
    // A later gap without a host reboot: the backend crashed or was killed.
    const later = now + 3 * 3_600_000;
    await database.client.systemSample.create({
      data: { at: new Date(later - 3_600_000), cpuPercent: 1, memUsed: 1n, memTotal: 2n },
    });
    expect(await detectOutage(database, alerts, later, now - 10 * 3_600_000)).toMatchObject({
      title: 'The platform stopped unexpectedly',
    });
    // After a clean stop there is nothing to report.
    const after = later + 3 * 3_600_000;
    await database.client.systemSample.create({
      data: { at: new Date(after - 3_600_000), cpuPercent: 1, memUsed: 1n, memTotal: 2n },
    });
    await database.client.auditEvent.create({
      data: { kind: 'system.stop', outcome: 'ok', at: new Date(after - 3_600_000 + 30_000) },
    });
    expect(await detectOutage(database, alerts, after, after - 30 * 60_000)).toBeNull();
  });
});
