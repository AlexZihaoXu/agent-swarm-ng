import { expect, it, vi } from 'vitest';
import { join } from 'node:path';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { buildApp } from '../app';
import { prepareDatabase } from '../test-database';
import { SESSION_COOKIE } from '../auth/sessions';
import type { PlatformStore } from '../platform-store';
import { KnownAddresses } from '../security/addresses';
import { AccessLog, OTHER_UNMATCHED, UNMATCHED_PATHS, placeOf, registerAccessLog } from './log';

const database = () => prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
const key = (route: string, extra: Partial<Parameters<AccessLog['add']>[0]> = {}) => ({
  minute: 1000,
  ip: '198.51.100.4',
  country: 'NL',
  user: '',
  method: 'GET',
  route,
  status: 200,
  ...extra,
});
/** A store whose writes are recorded (and fail while `failing`), for chunking and failure handling. */
const fakeStore = () => {
  const writes: { rows: number }[] = [];
  const state = { failing: false };
  const store = {
    initialize: async () => {},
    client: {
      $executeRawUnsafe: async (_sql: string, ...values: unknown[]) => {
        if (state.failing) throw new Error('database is locked');
        writes.push({ rows: values.length / 10 });
        return values.length / 10;
      },
    },
  } as unknown as PlatformStore;
  return { store, writes, state };
};
const fakeLog = () => ({ error: vi.fn(), warn: vi.fn() });

it('places addresses: Cloudflare countries, tailnet, LAN, local', () => {
  expect(placeOf('192.0.2.10', 'CA')).toBe('CA');
  expect(placeOf('192.0.2.10', '')).toBe('??');
  expect(placeOf('100.64.10.20', 'CA')).toBe('Tailnet');
  expect(placeOf('192.168.0.5', undefined)).toBe('LAN');
  expect(placeOf('127.0.0.1', undefined)).toBe('Local');
});

it('folds requests per minute and shows who only when signed in', { timeout: 60_000 }, async () => {
  const store = await database();
  const app = await buildApp({ database: store, computerController: null, requireLogin: true });
  try {
    const headers = (ip: string, extra: Record<string, string> = {}) => ({
      host: '127.0.0.1:19090',
      'x-real-ip': ip,
      ...extra,
    });
    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers: headers('192.0.2.10'),
      payload: { name: 'Admin', password: 'correct horse battery' },
    });
    const cookie = `${SESSION_COOKIE}=${setup.cookies.find(found => found.name === SESSION_COOKIE)!.value}`;
    // An attacker probing: many requests, one route, folded into one row.
    for (let i = 0; i < 50; i++)
      await app.inject({
        method: 'GET',
        url: '/api/agents',
        headers: headers('203.0.113.7', { 'cf-ipcountry': 'NL' }),
      });
    await app.inject({
      method: 'GET',
      url: '/wp-login.php?x=1',
      headers: headers('203.0.113.7', { 'cf-ipcountry': 'NL' }),
    });
    await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: headers('192.0.2.10', { 'cf-ipcountry': 'CA', cookie }),
    });
    const result = (
      await app.inject({ method: 'GET', url: '/api/access?range=1h', headers: headers('192.0.2.10', { cookie }) })
    ).json();
    expect(await store.client.accessMinute.count({ where: { ip: '203.0.113.7' } })).toBe(2);
    const attacker = result.addresses.find((entry: any) => entry.ip === '203.0.113.7');
    expect(attacker).toMatchObject({ country: 'NL', users: [], requests: 51, errors: 51 });
    expect(result.addresses.find((entry: any) => entry.ip === '192.0.2.10').users).toEqual(['Admin']);
    expect(result.routes.map((route: any) => route.key)).toContain('GET /wp-login.php');
    expect(result.countries.map((country: any) => country.key)).toEqual(expect.arrayContaining(['NL', 'CA']));
    expect(result.series.client.reduce((a: number, b: number) => a + b, 0)).toBeGreaterThanOrEqual(51);
  } finally {
    await app.close();
  }
});

it('aggregates in SQL: buckets, totals, top lists, addresses with their people, one address', async () => {
  const store = await database();
  const access = new AccessLog(store);
  const now = Math.floor(Date.now() / 60_000);
  access.add(key('/api/agents', { minute: now, ip: '192.0.2.1', country: 'CA', user: 'Admin' }), 10);
  access.add(key('/api/agents', { minute: now, ip: '192.0.2.1', country: 'CA', user: 'Admin' }), 30);
  access.add(key('/api/agents', { minute: now, ip: '192.0.2.1', country: 'CA', user: 'Bea' }), 20);
  for (let i = 0; i < 5; i++)
    access.add(key('/wp-login.php', { minute: now - 2, ip: '203.0.113.9', status: 404 }), 2 + i);
  access.add(key('/api/x', { minute: now - 3, ip: '203.0.113.9', status: 500 }), 100);
  access.add(key('/old', { minute: now - 90, ip: '198.51.100.1', status: 301 }), 1);
  await access.flush();
  const app = Fastify();
  registerAccessLog(app, store, access, new KnownAddresses(store));
  try {
    const get = async (url: string) => (await app.inject({ method: 'GET', url })).json();
    const hour = await get('/api/access?range=1h');
    expect(hour.totals).toEqual({ requests: 9, errors: 6, addresses: 2, countries: 2 });
    expect(hour.series.ok.reduce((a: number, b: number) => a + b, 0)).toBe(3);
    expect(hour.series.client.reduce((a: number, b: number) => a + b, 0)).toBe(5);
    expect(hour.series.server.reduce((a: number, b: number) => a + b, 0)).toBe(1);
    expect(hour.series.redirect.reduce((a: number, b: number) => a + b, 0)).toBe(0);
    expect(hour.series.ok).toHaveLength(60);
    expect(hour.countries).toEqual([
      { key: 'NL', requests: 6, errors: 6, avgMs: 20, maxMs: 100 },
      { key: 'CA', requests: 3, errors: 0, avgMs: 20, maxMs: 30 },
    ]);
    expect(hour.routes[0]).toMatchObject({ key: 'GET /wp-login.php', requests: 5, errors: 5, avgMs: 4, maxMs: 6 });
    expect(hour.statuses.map((row: any) => row.key)).toEqual(['404', '200', '500']);
    expect(hour.addresses).toEqual([
      expect.objectContaining({ ip: '203.0.113.9', country: 'NL', users: [], requests: 6, errors: 6 }),
      expect.objectContaining({ ip: '192.0.2.1', country: 'CA', users: ['Admin', 'Bea'], requests: 3, errors: 0 }),
    ]);
    const day = await get('/api/access?range=24h');
    // The hour's page load itself (from 127.0.0.1) now counts too.
    expect(day.totals).toMatchObject({ requests: 11, addresses: 4 });
    expect(day.series.redirect.reduce((a: number, b: number) => a + b, 0)).toBe(1);
    const one = await get('/api/access?range=24h&ip=192.0.2.1');
    expect(one.totals).toEqual({ requests: 3, errors: 0, addresses: 1, countries: 1 });
    expect(one.routes).toEqual([expect.objectContaining({ key: 'GET /api/agents', requests: 3 })]);
  } finally {
    await app.close();
  }
});

it('keeps the first unmatched paths per address and minute, folding the rest', () => {
  const access = new AccessLog(fakeStore().store);
  const routes = Array.from({ length: UNMATCHED_PATHS + 5 }, (_, i) =>
    access.unmatchedRoute(5, '203.0.113.7', `/probe-${i}.php?q=1`),
  );
  expect(routes.slice(0, UNMATCHED_PATHS)).toEqual(
    Array.from({ length: UNMATCHED_PATHS }, (_, i) => `/probe-${i}.php`),
  );
  expect(new Set(routes.slice(UNMATCHED_PATHS))).toEqual(new Set([OTHER_UNMATCHED]));
  // A path already seen stays itself; another address and the next minute start afresh.
  expect(access.unmatchedRoute(5, '203.0.113.7', '/probe-0.php')).toBe('/probe-0.php');
  expect(access.unmatchedRoute(5, '203.0.113.8', '/probe-99.php')).toBe('/probe-99.php');
  expect(access.unmatchedRoute(6, '203.0.113.7', '/probe-99.php')).toBe('/probe-99.php');
  expect(access.unmatchedRoute(6, '203.0.113.7', '/' + 'a'.repeat(200))).toHaveLength(80);
});

it("folds a scanner's unmatched paths in the app", { timeout: 60_000 }, async () => {
  const store = await database();
  const app = await buildApp({ database: store, computerController: null });
  try {
    for (let i = 0; i < UNMATCHED_PATHS + 10; i++)
      await app.inject({
        method: 'GET',
        url: `/scan-${i}`,
        headers: { host: '127.0.0.1:19090', 'x-real-ip': '203.0.113.5' },
      });
    await app.access.flush();
    const routes = await store.client.accessMinute.findMany({ where: { ip: '203.0.113.5' } });
    expect(routes.length).toBeLessThanOrEqual(UNMATCHED_PATHS + 2);
    expect(routes.find(row => row.route === OTHER_UNMATCHED)?.count).toBeGreaterThanOrEqual(10);
  } finally {
    await app.close();
  }
});

it('writes many keys in chunks of multi-row upserts', async () => {
  const { store, writes } = fakeStore();
  const access = new AccessLog(store, { chunk: 250 });
  for (let i = 0; i < 1001; i++) access.add(key(`/r${i}`), 1);
  expect(await access.flush()).toBe(1001);
  expect(writes.map(write => write.rows)).toEqual([250, 250, 250, 250, 1]);

  // And against SQLite: a second flush upserts into the same rows.
  const real = await database();
  const log = new AccessLog(real, { chunk: 200 });
  for (const round of [1, 2]) {
    for (let i = 0; i < 700; i++) log.add(key(`/r${i}`), round * 10);
    await log.flush();
  }
  expect(await real.client.accessMinute.count()).toBe(700);
  expect(await real.client.accessMinute.findFirst({ where: { route: '/r699' } })).toMatchObject({
    count: 2,
    totalMs: 30,
    maxMs: 20,
  });
});

it('reports dropped requests and keeps a failed batch when it fits', async () => {
  const { store, writes, state } = fakeStore();
  const access = new AccessLog(store, { maxPending: 3 });
  const log = fakeLog();
  access.start(log);
  try {
    for (let i = 0; i < 5; i++) access.add(key(`/r${i}`), 1);
    access.add(key('/r4'), 1);
    await access.flush();
    expect(log.warn).toHaveBeenCalledWith({ dropped: 3 }, expect.stringContaining('dropped 3'));
    expect(writes).toEqual([{ rows: 3 }]);

    // A failed write keeps its batch (merged with what arrived since) up to the key cap.
    state.failing = true;
    access.add(key('/a'), 1);
    access.add(key('/b'), 1);
    await expect(access.flush()).rejects.toThrow('locked');
    access.add(key('/a'), 1);
    access.add(key('/c'), 1);
    access.add(key('/d'), 1);
    state.failing = false;
    log.warn.mockClear();
    expect(await access.flush()).toBe(3);
    expect(log.warn).toHaveBeenCalledWith({ dropped: 1 }, expect.any(String));
  } finally {
    await access.stop();
  }
});

it('records accepted WebSocket upgrades, which never reach onResponse', async () => {
  const store = await database();
  const access = new AccessLog(store);
  const app = Fastify();
  await app.register(websocket);
  registerAccessLog(app, store, access, new KnownAddresses(store));
  app.get('/api/stream', { websocket: true }, socket => socket.close());
  await app.ready();
  try {
    const socket = await app.injectWS('/api/stream', { headers: { 'x-real-ip': '198.51.100.20' } });
    socket.terminate();
    await access.flush();
    expect(await store.client.accessMinute.findMany({ where: { ip: '198.51.100.20' } })).toEqual([
      expect.objectContaining({ method: 'GET', route: '/api/stream', status: 101, count: 1 }),
    ]);
  } finally {
    await app.close();
  }
});
