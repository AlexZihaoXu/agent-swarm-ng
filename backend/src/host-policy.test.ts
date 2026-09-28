import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { request } from 'node:http';
import { allowedHosts } from './host-policy';
import { buildApp } from './app';
import { prepareDatabase } from './test-database';

describe('allowedHosts', () => {
  const allowed = allowedHosts('Dashboard.tail1234.ts.net, other.example:8080');
  it('accepts IP literals, localhost and configured names only', () => {
    for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000', '100.64.10.20:19090', '192.168.0.167', 'app.localhost', 'dashboard.tail1234.ts.net:19090', 'other.example'])
      expect(allowed(host), host).toBe(true);
    for (const host of [undefined, '', 'evil.example', 'evil.example:3000', '127.0.0.1.evil.example', 'localhost.evil.example', 'dashboard.tail1234.ts.net.evil.example', 'a b'])
      expect(allowed(host), String(host)).toBe(false);
  });
});

describe('Host enforcement on the API', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => { await close?.(); close = undefined; });
  async function start() {
    const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
    const app = await buildApp({ database, computerController: null });
    const sockets = new Set<import('node:net').Socket>();
    app.server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await app.listen({ host: '127.0.0.1', port: 0 });
    close = async () => { for (const socket of sockets) socket.destroy(); await app.close(); };
    return { app, port: (app.server.address() as { port: number }).port };
  }
  it('serves normal hosts and refuses a rebinding hostname, for HTTP and WebSocket upgrades', async () => {
    const { port } = await start();
    const get = (host: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, agent: false, path: '/api/agents', headers: { Host: host } }, response => {
        let body = ''; response.on('data', chunk => { body += chunk; }); response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
      });
      req.on('error', reject); req.end();
    });
    expect((await get(`127.0.0.1:${port}`)).status).toBe(200);
    expect((await get('100.64.10.20:19090')).status).toBe(200);
    const rebound = await get('attacker.example');
    expect(rebound.status).toBe(403);
    expect(rebound.body).toMatch(/ALLOWED_HOSTS/);
    const upgrade = (host: string) => new Promise<number>(resolve => {
      const req = request({ host: '127.0.0.1', port, agent: false, path: '/api/computers/4a18018a-4689-4fa5-86ca-4dc080d41fb4/terminals/4a18018a-4689-4fa5-86ca-4dc080d41fb5/stream',
        headers: { Host: host, Origin: `http://${host}`, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' } });
      req.on('response', response => { resolve(response.statusCode ?? 0); response.resume(); req.destroy(); });
      req.on('upgrade', (_response, socket) => { socket.destroy(); resolve(101); });
      req.on('error', () => resolve(-1)); req.end();
    });
    const status = await upgrade('attacker.example');
    expect(status).toBe(403);
    // (an allowed host reaches the route's own Origin/computer checks; covered by computer-terminal-stream tests)
  });
});
