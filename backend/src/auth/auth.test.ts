import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { buildApp } from '../app';
import { prepareDatabase } from '../test-database';
import { SESSION_COOKIE } from './sessions';

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
