import { expect, it } from 'vitest';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { buildApp } from './app';
import { prepareDatabase } from './test-database';
import { SESSION_COOKIE } from './auth/sessions';
import type { ComputerController } from './computer-controller-client';

const PASSWORD = 'correct horse battery';

it('reaches transfers like the other file routes, audits uploads without names, and is not limited by duration', async () => {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const uploads: string[] = [];
  const controller = {
    limits: async () => ({
      cpuCores: { min: 1, max: 8, default: 2 },
      memoryGiB: { min: 1, max: 16, default: 4 },
      timezoneDefault: 'UTC',
    }),
    observe: async () => new Map(),
    files: async () => ({ path: '/home/agent', parent: '/home', entries: [], nextOffset: null, truncated: false }),
    async upload(id: string, query: { name: string; size: number; offset: number }, body: ReadableStream<Uint8Array>) {
      let length = 0;
      const reader = body.getReader();
      for (let next = await reader.read(); !next.done; next = await reader.read()) length += next.value.length;
      uploads.push(id);
      return query.offset + length < query.size
        ? { received: query.offset + length }
        : { name: query.name, path: `/home/agent/${query.name}`, size: query.size };
    },
  } as unknown as ComputerController;
  const app = await buildApp({ database, computerController: controller, requireLogin: true });
  try {
    const call = (
      method: 'GET' | 'POST' | 'PUT' | 'DELETE',
      url: string,
      cookie: string,
      payload?: unknown,
      size?: number,
    ) =>
      app.inject({
        method,
        url,
        headers: {
          host: '127.0.0.1:19090',
          origin: 'http://127.0.0.1:19090',
          cookie,
          ...(size !== undefined ? { 'content-type': 'application/octet-stream', 'content-length': String(size) } : {}),
        },
        ...(payload !== undefined ? { payload: payload as string } : {}),
      });
    const cookieOf = (response: Awaited<ReturnType<typeof app.inject>>) =>
      `${SESSION_COOKIE}=${response.cookies.find(found => found.name === SESSION_COOKIE)!.value}`;
    const admin = cookieOf(
      await app.inject({
        method: 'POST',
        url: '/api/auth/setup',
        headers: { host: '127.0.0.1:19090' },
        payload: { name: 'Admin', password: PASSWORD },
      }),
    );
    const sam = (
      await call('POST', '/api/users', admin, { name: 'Sam', password: PASSWORD, memoryLimitGiB: 4 })
    ).json();
    const samCookie = cookieOf(
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { host: '127.0.0.1:19090' },
        payload: { name: 'Sam', password: PASSWORD },
      }),
    );
    const computer = (name: string, organizationId: string) =>
      database.client.computer.create({
        data: { name, requestKey: crypto.randomUUID(), organizationId, memoryGiB: 2, state: 'running' },
      });
    const desk = await computer('Desk', 'personal');
    const rig = await computer('Rig', sam.organizations[0].id);

    // Another organization's computer is as if it did not exist, for every transfer route.
    const upload = 'e'.repeat(32);
    for (const [method, url, payload] of [
      ['PUT', `/api/computers/${desk.id}/upload?path=/home/agent&name=a.txt&size=5&offset=0&upload=${upload}`, 'hello'],
      ['DELETE', `/api/computers/${desk.id}/upload?path=/home/agent&name=a.txt&upload=${upload}`, undefined],
      ['GET', `/api/computers/${desk.id}/download?path=/home/agent/a.txt`, undefined],
      ['POST', `/api/computers/${desk.id}/folders`, { path: '/home/agent', name: 'new' }],
    ] as const)
      expect((await call(method, url, samCookie, payload, payload === 'hello' ? 5 : undefined)).statusCode).toBe(404);
    expect(uploads).toEqual([]);
    // Signed out: refused before anything is read.
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/computers/${rig.id}/upload?path=/home/agent&name=a.txt&size=5&offset=0&upload=${upload}`,
          headers: { host: '127.0.0.1:19090', origin: 'http://127.0.0.1:19090' },
          payload: 'hello',
        })
      ).statusCode,
    ).toBe(401);

    // A slow, large upload in parts: listings go on meanwhile, and nothing caps a part's body.
    const part = 16 * 1024 * 1024;
    const size = 2 * part;
    const name = encodeURIComponent('secret plan.txt');
    const send = (offset: number) =>
      call(
        'PUT',
        `/api/computers/${rig.id}/upload?path=/home/agent&name=${name}&size=${size}&offset=${offset}&upload=${upload}&mode=rename`,
        samCookie,
        Readable.from(
          (async function* () {
            for (let sent = 0; sent < part; sent += 1024 * 1024) {
              await new Promise(resolve => setTimeout(resolve, 20));
              yield Buffer.alloc(1024 * 1024, 1);
            }
          })(),
        ),
        part,
      );
    const slow = send(0);
    for (let i = 0; i < 5; i++)
      expect((await call('GET', `/api/computers/${rig.id}/files?path=/home/agent`, samCookie)).statusCode).toBe(200);
    expect((await slow).statusCode).toBe(202);
    const uploaded = await send(part);
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json()).toMatchObject({ size });
    expect(uploads).toEqual([rig.id, rig.id]);

    const events = (await call('GET', '/api/audit?category=computers', admin)).json().events as Record<string, any>[];
    const audited = events.filter(event => event.kind === 'computer.files');
    // One event for the file (its last part), not one per part.
    expect(audited.map(event => [event.outcome, event.targetId, event.actor])).toEqual([['ok', rig.id, 'Sam']]);
    expect(audited[0]!.detail).toEqual({ section: 'uploaded', size, mode: 'rename', renamed: false });
    expect(JSON.stringify(audited)).not.toContain('secret plan');
  } finally {
    await app.close();
  }
}, 60_000);
