import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { buildApp } from '../app';
import { prepareDatabase } from '../test-database';
import { SwarmSettingsStore } from '../swarm-settings';
import { RateLimiter } from './rate-limit';

/** Sends until refused: the burst (1200) plus what refilled meanwhile (20 a second) passes, then 429. */
async function untilRefused<R extends { statusCode: number }>(send: (i: number) => Promise<R>, passing: number) {
  const started = Date.now();
  let allowed = 0;
  for (;;) {
    const response = await send(allowed);
    if (response.statusCode === 429) {
      expect(allowed).toBeGreaterThanOrEqual(1200);
      expect(allowed).toBeLessThanOrEqual(1201 + Math.ceil(((Date.now() - started) / 1000) * 20));
      return response;
    }
    expect(response.statusCode).toBe(passing);
    allowed++;
  }
}

describe('RateLimiter', () => {
  it('allows a burst, refuses past it with the wait, and refills continuously', () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 60; i++) expect(limiter.take('a', 60, 0)).toBe(0);
    expect(limiter.take('a', 60, 0)).toBe(1);
    expect(limiter.take('b', 60, 0)).toBe(0);
    expect(limiter.take('a', 60, 1000)).toBe(0);
    expect(limiter.take('a', 60, 1000)).toBe(1);
    // A long pause refills only up to the burst.
    for (let i = 0; i < 60; i++) expect(limiter.take('a', 60, 3_600_000)).toBe(0);
    expect(limiter.take('a', 60, 3_600_000)).toBe(1);
    // The wait is the whole seconds until one request has refilled.
    for (let i = 0; i < 6; i++) limiter.take('slow', 6, 0);
    expect(limiter.take('slow', 6, 0)).toBe(10);
  });

  it('tracks a bounded number of keys, forgetting the least recently used', () => {
    const limiter = new RateLimiter(3);
    limiter.take('a', 1, 0);
    limiter.take('b', 1, 0);
    limiter.take('c', 1, 0);
    expect(limiter.take('a', 1, 0)).toBeGreaterThan(0);
    limiter.take('d', 1, 0);
    expect(limiter.size).toBe(3);
    // b was the least recently used, so it was forgotten and starts afresh; a was kept.
    expect(limiter.take('b', 1, 0)).toBe(0);
    expect(limiter.take('a', 1, 0)).toBeGreaterThan(0);
  });
});

describe('API request limits', { timeout: 120_000 }, () => {
  it('refuses an address past its burst with Retry-After, never Caddy’s desktop check, and not other addresses', async () => {
    const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
    await new SwarmSettingsStore(database).update({ rateLimitPerAddress: 1200, rateLimitPerPerson: 1200 });
    const app = await buildApp({ database, computerController: null, requireLogin: true });
    const get = (url: string, ip: string) =>
      app.inject({ method: 'GET', url, headers: { host: '127.0.0.1:19090', 'x-real-ip': ip } });
    try {
      const refused = await untilRefused(() => get('/api/agents', '10.0.0.1'), 401);
      expect(refused.statusCode).toBe(429);
      expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(refused.json().message).toMatch(/^Too many requests\. Slow down and try again in \d+ s\.$/);
      expect((await get('/api/auth/check', '10.0.0.1')).statusCode).toBe(401);
      expect((await get('/api/health', '10.0.0.1')).statusCode).toBe(200);
      expect((await get('/api/agents', '10.0.0.2')).statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('limits a signed-in person across addresses', async () => {
    const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
    await new SwarmSettingsStore(database).update({ rateLimitPerPerson: 1200 });
    const app = await buildApp({ database, computerController: null, requireLogin: true });
    try {
      const setup = await app.inject({
        method: 'POST',
        url: '/api/auth/setup',
        headers: { host: '127.0.0.1:19090' },
        payload: { name: 'Admin', password: 'correct horse battery' },
      });
      const cookie = setup.cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
      const get = (i: number) =>
        app.inject({
          method: 'GET',
          url: '/api/auth/session',
          headers: { host: '127.0.0.1:19090', cookie, 'x-real-ip': `10.0.1.${i % 200}` },
        });
      // The sign-up took one request from this person's address only, not from the person.
      await untilRefused(get, 200);
    } finally {
      await app.close();
    }
  });
});
