import { expect, it } from 'vitest';
import { join } from 'node:path';
import { buildApp } from '../app';
import { prepareDatabase } from '../test-database';
import { SESSION_COOKIE } from '../auth/sessions';

it('streams the live snapshot then each reading, and signing out ends the stream', { timeout: 60_000 }, async () => {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const app = await buildApp({ database, computerController: null, requireLogin: true });
  try {
    const base = await app.listen({ port: 0, host: '127.0.0.1' });
    const setup = await fetch(`${base}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Admin', password: 'correct horse battery' }),
    });
    const token = setup.headers
      .getSetCookie()
      .find(cookie => cookie.startsWith(`${SESSION_COOKIE}=`))!
      .split(';')[0]!;
    expect((await fetch(`${base}/api/dashboard/live/stream`)).status).toBe(401);
    const stream = await fetch(`${base}/api/dashboard/live/stream`, { headers: { cookie: token } });
    expect(stream.headers.get('content-type')).toBe('application/x-ndjson');
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const next = async () => {
      while (!buffer.includes('\n')) {
        // Signing out destroys the stream: a dropped connection is its end.
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done) return null;
        buffer += decoder.decode(value, { stream: true });
      }
      const line = buffer.slice(0, buffer.indexOf('\n'));
      buffer = buffer.slice(line.length + 1);
      return JSON.parse(line);
    };
    expect(await next()).toMatchObject({ type: 'snapshot', intervalMs: 250 });
    let event = await next();
    while (event?.type === 'snapshot') event = await next();
    expect(event).toMatchObject({ type: 'point', point: { t: expect.any(Number) } });
    await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie: token } });
    while ((event = await next())) expect(event.type).not.toBe('snapshot');
  } finally {
    await app.close();
  }
});
