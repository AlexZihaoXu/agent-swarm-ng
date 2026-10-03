import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { buildApp } from '../app';
import { prepareDatabase } from '../test-database';
import { createHash } from 'node:crypto';
import { SECURE_SESSION_COOKIE, SESSION_COOKIE } from './sessions';

async function fixture() {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const app = await buildApp({ database, computerController: null, requireLogin: true });
  const json = (method: 'GET' | 'POST', url: string, body?: unknown, cookie?: string) =>
    app.inject({
      method,
      url,
      headers: { host: '127.0.0.1:19090', ...(cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { payload: body as object }),
    });
  const cookieOf = (response: { cookies: { name: string; value: string }[] }) => {
    const found = response.cookies.find(cookie => cookie.name === SESSION_COOKIE);
    return found ? `${SESSION_COOKIE}=${found.value}` : '';
  };
  return { app, database, json, cookieOf };
}

// Password hashing is deliberately slow (scrypt), so these tests get more time than the default.
describe('dashboard sign-in', { timeout: 60_000 }, () => {
  it('starts with Admin needing a password, and the first sign-in sets it', async () => {
    const { app, json, cookieOf } = await fixture();
    try {
      expect((await json('GET', '/api/agents')).statusCode).toBe(401);
      expect((await json('GET', '/api/auth/session')).json()).toEqual({
        signedIn: false,
        setupRequired: true,
        name: 'Admin',
      });
      // Only the default account, and a long enough password.
      expect((await json('POST', '/api/auth/setup', { name: 'Root', password: 'long enough pw' })).statusCode).toBe(
        400,
      );
      expect((await json('POST', '/api/auth/setup', { name: 'Admin', password: 'short' })).statusCode).toBe(400);
      const setup = await json('POST', '/api/auth/setup', { name: 'Admin', password: 'correct horse battery' });
      expect(setup.statusCode).toBe(200);
      const session = setup.cookies.find(cookie => cookie.name === SESSION_COOKIE)!;
      expect(session).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
      const cookie = cookieOf(setup);
      expect((await json('GET', '/api/auth/session', undefined, cookie)).json()).toEqual({
        signedIn: true,
        name: 'Admin',
      });
      expect((await json('GET', '/api/agents', undefined, cookie)).statusCode).toBe(200);
      // Setup happens once: nobody can set the password again that way.
      expect((await json('POST', '/api/auth/setup', { name: 'Admin', password: 'another password' })).statusCode).toBe(
        409,
      );
      expect((await json('GET', '/api/auth/session')).json()).toEqual({ signedIn: false, setupRequired: false });
    } finally {
      await app.close();
    }
  });

  it('signs in and out, rejects wrong passwords alike, and leaves health public', async () => {
    const { app, json, cookieOf } = await fixture();
    try {
      await json('POST', '/api/auth/setup', { name: 'Admin', password: 'correct horse battery' });
      expect((await json('GET', '/api/health')).statusCode).toBe(200);
      const wrong = await json('POST', '/api/auth/login', { name: 'Admin', password: 'nope nope nope' });
      const unknown = await json('POST', '/api/auth/login', { name: 'Nobody', password: 'nope nope nope' });
      expect(wrong.statusCode).toBe(401);
      expect(unknown.statusCode).toBe(401);
      expect(wrong.json()).toEqual(unknown.json());
      const login = await json('POST', '/api/auth/login', { name: 'Admin', password: 'correct horse battery' });
      expect(login.statusCode).toBe(200);
      const cookie = cookieOf(login);
      expect((await json('GET', '/api/auth/check', undefined, cookie)).statusCode).toBe(204);
      expect((await json('GET', '/api/auth/check')).statusCode).toBe(401);
      expect((await json('POST', '/api/auth/logout', {}, cookie)).statusCode).toBe(200);
      expect((await json('GET', '/api/auth/check', undefined, cookie)).statusCode).toBe(401);
      expect((await json('GET', '/api/agents', undefined, `${SESSION_COOKIE}=forged`)).statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('slows down repeated wrong passwords', async () => {
    const { app, json } = await fixture();
    try {
      await json('POST', '/api/auth/setup', { name: 'Admin', password: 'correct horse battery' });
      const codes: number[] = [];
      for (let attempt = 0; attempt < 12; attempt++)
        codes.push(
          (await json('POST', '/api/auth/login', { name: 'Admin', password: `wrong ${attempt} xx` })).statusCode,
        );
      expect(codes.slice(0, 10).every(code => code === 401)).toBe(true);
      expect(codes.at(-1)).toBe(429);
      // Even the right password waits until the pause ends.
      expect(
        (await json('POST', '/api/auth/login', { name: 'Admin', password: 'correct horse battery' })).statusCode,
      ).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('limits wrong passwords per address, so another address can still sign in, and counts concurrent guesses', async () => {
    const { app, json } = await fixture();
    try {
      await json('POST', '/api/auth/setup', { name: 'Admin', password: 'correct horse battery' });
      const from = (address: string, password: string) =>
        app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: { host: '127.0.0.1:19090', 'x-forwarded-for': address },
          payload: { name: 'Admin', password },
        });
      // A burst at once: at most a few slow checks run, never more wrong-password checks than the limit.
      const burst = await Promise.all(Array.from({ length: 14 }, (_, i) => from('100.64.0.9', `wrong ${i} xxx`)));
      expect(burst.filter(response => response.statusCode === 401).length).toBeLessThanOrEqual(10);
      expect(burst.some(response => response.statusCode === 429)).toBe(true);
      for (let i = 0; i < 12; i++) await from('100.64.0.9', `more wrong ${i} x`);
      expect((await from('100.64.0.9', 'correct horse battery')).statusCode).toBe(429);
      // The owner elsewhere is not locked out by someone else's guesses.
      expect((await from('100.64.0.7', 'correct horse battery')).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('uses a __Secure- cookie on the HTTPS origin and ends sessions after 90 days however often used', async () => {
    const { app, database } = await fixture();
    try {
      const setup = await app.inject({
        method: 'POST',
        url: '/api/auth/setup',
        headers: { host: '127.0.0.1:19091', 'x-forwarded-proto': 'https' },
        payload: { name: 'Admin', password: 'correct horse battery' },
      });
      const cookie = setup.cookies.find(found => found.name === SECURE_SESSION_COOKIE)!;
      expect(cookie).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Strict' });
      const check = () =>
        app.inject({
          method: 'GET',
          url: '/api/auth/check',
          headers: {
            host: '127.0.0.1:19091',
            'x-forwarded-proto': 'https',
            cookie: `${SECURE_SESSION_COOKIE}=${cookie.value}`,
          },
        });
      expect((await check()).statusCode).toBe(204);
      await database.client.userSession.updateMany({ data: { createdAt: new Date(Date.now() - 91 * 86_400_000) } });
      expect((await check()).statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('signing out on HTTPS also ends the plain session the HTTP origin set for the same host', async () => {
    const { app, json, cookieOf } = await fixture();
    try {
      const plain = cookieOf(
        await json('POST', '/api/auth/setup', { name: 'Admin', password: 'correct horse battery' }),
      );
      const https = { host: '127.0.0.1:19091', 'x-forwarded-proto': 'https' };
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: https,
        payload: { name: 'Admin', password: 'correct horse battery' },
      });
      const secure = `${SECURE_SESSION_COOKIE}=${login.cookies.find(found => found.name === SECURE_SESSION_COOKIE)!.value}`;
      const both = { ...https, cookie: `${secure}; ${plain}` };
      const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: both, payload: {} });
      expect(logout.cookies.map(cookie => [cookie.name, cookie.maxAge])).toEqual([
        [SECURE_SESSION_COOKIE, 0],
        [SESSION_COOKIE, 0],
      ]);
      expect((await app.inject({ method: 'GET', url: '/api/auth/check', headers: both })).statusCode).toBe(401);
      expect((await json('GET', '/api/auth/check', undefined, plain)).statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('closes a session’s open streams when it signs out', async () => {
    const { app, json, cookieOf } = await fixture();
    try {
      const cookie = cookieOf(
        await json('POST', '/api/auth/setup', { name: 'Admin', password: 'correct horse battery' }),
      );
      const tokenHash = createHash('sha256').update(cookie.split('=')[1]!).digest('hex');
      let closed = 0;
      app.watchSession({ signedIn: { userId: 'admin', name: 'Admin', tokenHash } } as never, () => closed++);
      await json('POST', '/api/auth/logout', {}, cookie);
      expect(closed).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('changes the password, keeping this browser and signing out the others', async () => {
    const { app, json, cookieOf } = await fixture();
    try {
      const mine = cookieOf(
        await json('POST', '/api/auth/setup', { name: 'Admin', password: 'correct horse battery' }),
      );
      const other = cookieOf(
        await json('POST', '/api/auth/login', { name: 'Admin', password: 'correct horse battery' }),
      );
      expect(
        (await json('POST', '/api/auth/password', { current: 'wrong wrong', password: 'new long password' }, mine))
          .statusCode,
      ).toBe(403);
      const changed = await json(
        'POST',
        '/api/auth/password',
        { current: 'correct horse battery', password: 'new long password' },
        mine,
      );
      expect(changed.statusCode).toBe(200);
      expect((await json('GET', '/api/auth/check', undefined, mine)).statusCode).toBe(204);
      expect((await json('GET', '/api/auth/check', undefined, other)).statusCode).toBe(401);
      expect((await json('POST', '/api/auth/login', { name: 'Admin', password: 'new long password' })).statusCode).toBe(
        200,
      );
    } finally {
      await app.close();
    }
  });

  it('refuses state changes from another origin and WebSocket upgrades without a session', async () => {
    const { app, json, cookieOf } = await fixture();
    try {
      const cookie = cookieOf(
        await json('POST', '/api/auth/setup', { name: 'Admin', password: 'correct horse battery' }),
      );
      const crossSite = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { host: '127.0.0.1:19090', origin: 'https://evil.example', cookie },
        payload: {},
      });
      expect(crossSite.statusCode).toBe(403);
      // Caddy's desktop check carries the page's Origin: another site cannot open a desktop.
      const desktop = await app.inject({
        method: 'GET',
        url: '/api/auth/check',
        headers: { host: '127.0.0.1:19090', origin: 'http://127.0.0.1:8080', cookie },
      });
      expect(desktop.statusCode).toBe(403);
      const upgrade = await app.inject({
        method: 'GET',
        url: '/api/computers/00000000-0000-4000-8000-000000000000/terminals/x/stream',
        headers: { host: '127.0.0.1:19090', connection: 'upgrade', upgrade: 'websocket' },
      });
      expect(upgrade.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
