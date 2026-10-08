import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPublicFetch } from './web-fetch';

let server: Server;
let port: number;
let hits = 0;
beforeAll(async () => {
  server = createServer((request, response) => {
    hits++;
    if (request.url === '/redirect') return response.writeHead(302, { location: '/' }).end();
    if (request.url === '/gzip') return response.writeHead(200, { 'content-encoding': 'gzip' }).end(gzipSync('packed'));
    if (request.url === '/slow') return response.writeHead(200).write('partial');
    if (request.url === '/host') return response.writeHead(200).end(request.headers.host);
    let body = '';
    request.on('data', chunk => (body += chunk));
    request.on('end', () =>
      response.writeHead(200, 'Fine', { 'x-test': 'yes' }).end(`${request.method} ${body || 'hello'}`),
    );
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const local = [{ address: '127.0.0.1', family: 4 }];
// The test server is on loopback, so only these tests treat 127.0.0.1 as "public".
const allowLocal = () =>
  createPublicFetch({ resolve: async () => local, isPublic: address => address === '127.0.0.1' });

describe('web worker fetch', () => {
  it('fetches public addresses with status, headers, bodies and decoding like fetch', async () => {
    const fetch = allowLocal();
    const response = await fetch(`http://site.test:${port}/`);
    expect([response.status, response.statusText, response.headers.get('x-test')]).toEqual([200, 'Fine', 'yes']);
    expect(response.url).toBe(`http://site.test:${port}/`);
    expect(await response.text()).toBe('GET hello');
    const posted = await fetch(new URL(`http://site.test:${port}/echo`), { method: 'POST', body: 'payload' });
    expect(await posted.text()).toBe('POST payload');
    expect(await (await fetch(`http://site.test:${port}/gzip`)).text()).toBe('packed');
    // It connects to the checked address, and the site still gets its own name.
    expect(await (await fetch(`http://site.test:${port}/host`)).text()).toBe(`site.test:${port}`);
  });

  it('keeps manual redirects manual and checks every followed hop', async () => {
    const fetch = allowLocal();
    const before = hits;
    const manual = await fetch(`http://site.test:${port}/redirect`, { redirect: 'manual' });
    expect([manual.status, manual.headers.get('location'), hits - before]).toEqual([302, '/', 1]);
    const followed = await fetch(`http://site.test:${port}/redirect`);
    expect([followed.status, followed.url, await followed.text()]).toEqual([
      200,
      `http://site.test:${port}/`,
      'GET hello',
    ]);
  });

  it('refuses at connect time a name that rebinds to a non-public address after a public lookup', async () => {
    const before = hits;
    for (const address of ['127.0.0.1', '10.1.2.3', '100.64.0.7', '169.254.169.254', '::1', '::ffff:127.0.0.1']) {
      const family = address.includes(':') ? 6 : 4;
      const resolve = vi
        .fn()
        .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
        .mockResolvedValue([{ address, family }]);
      expect(await resolve('rebind.test')).toEqual([{ address: '93.184.216.34', family: 4 }]); // the earlier policy check
      await expect(createPublicFetch({ resolve })(`http://rebind.test:${port}/`)).rejects.toThrow();
      expect(resolve).toHaveBeenCalledTimes(2);
    }
    const mixed = createPublicFetch({
      resolve: async () => [{ address: '93.184.216.34', family: 4 }, ...local],
    });
    await expect(mixed(`http://rebind.test:${port}/`)).rejects.toThrow();
    expect(hits).toBe(before);
  });

  it('checks IP-literal and internal-name URLs too', async () => {
    const before = hits;
    const resolve = vi.fn(async () => local);
    for (const url of [
      `http://127.0.0.1:${port}/`,
      `http://[::ffff:127.0.0.1]:${port}/`,
      `http://localhost:${port}/`,
    ]) {
      await expect(createPublicFetch({ resolve })(url)).rejects.toThrow();
    }
    expect(hits).toBe(before);
  });

  it('stops a request when its signal aborts', async () => {
    const controller = new AbortController();
    const response = await allowLocal()(`http://site.test:${port}/slow`, { signal: controller.signal });
    const body = response.text();
    controller.abort();
    await expect(body).rejects.toThrow();
  });
});
