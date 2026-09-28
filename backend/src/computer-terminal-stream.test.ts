import { afterEach, expect, it } from 'vitest';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { join } from 'node:path';
import { prepareDatabase } from './test-database';
import { ComputerUseService } from './computer-use/service';
import { registerTerminalStreams, terminalOrigin } from './computer-terminal-stream';
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
it('requires an exact same-origin host and rejects missing/foreign/null origins', () => {
  expect(terminalOrigin('https://machine:19091', 'machine:19091')).toBe(true);
  expect(terminalOrigin('http://localhost', 'localhost:80')).toBe(true);
  for (const origin of [
    undefined,
    'null',
    'https://evil.example',
    'https://machine:19090',
    'https://machine:19091/path',
  ])
    expect(terminalOrigin(origin, 'machine:19091')).toBe(false);
});
it('binds streams to a saved running computer, forwards bounded keyboard only, and drops closed/resize input', async () => {
  const db = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  cleanup.push(() => db.close());
  const computer = await db.client.computer.create({
    data: { name: 'Desk', requestKey: crypto.randomUUID(), state: 'running' },
  });
  const sent: string[] = [];
  let ended = 0;
  const upstream = {
    bufferedAmount: 0,
    onmessage: null as any,
    onclose: null as any,
    onerror: null as any,
    send: (value: string) => sent.push(value),
    close: () => {
      ended++;
    },
  };
  const service = new ComputerUseService(db, {
    cancel: async () => {},
    capture: async () => {
      throw Error();
    },
    execute: async () => {
      throw Error();
    },
  });
  const app = Fastify();
  await app.register(websocket, { options: { maxPayload: 16384 } });
  cleanup.push(() => app.close());
  registerTerminalStreams(app, service, { terminalSocket: () => upstream } as any);
  await app.ready();
  const path = `/api/computers/${computer.id}/terminals/${crypto.randomUUID()}/stream`;
  await expect(
    app.injectWS(path, { headers: { origin: 'https://evil.example', host: 'localhost' } }),
  ).rejects.toThrow();
  const ws = await app.injectWS(path, { headers: { origin: 'http://localhost', host: 'localhost' } });
  cleanup.push(async () => ws.terminate());
  upstream.onmessage({ data: JSON.stringify({ type: 'ready', columns: 120, rows: 36 }) });
  ws.send(JSON.stringify({ type: 'input', data: Buffer.from('\x03\x1b[A\t').toString('base64') }));
  await expect.poll(() => sent.length).toBe(1);
  expect(JSON.parse(sent[0]).data).toBe(Buffer.from('\x03\x1b[A\t').toString('base64'));
  ws.send(JSON.stringify({ type: 'resize', columns: 80, rows: 24 }));
  await expect.poll(() => ended).toBe(1);
  expect(sent).toHaveLength(1);
  await db.client.computer.update({ where: { id: computer.id }, data: { desiredState: 'exited' } });
  await expect(app.injectWS(path, { headers: { origin: 'http://localhost', host: 'localhost' } })).rejects.toThrow();
});
