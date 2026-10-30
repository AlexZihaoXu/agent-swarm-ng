import { expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { HttpComputerController } from './computer-controller-client';
import { Readable } from 'node:stream';
import { ComputerFileError, boundedFileBody, fileAttachment, parseRange } from './computer-files';
import { registerComputerFileRoutes } from './computer-file-routes';
import type { ComputerStore } from './computer-store';

const list = {
  path: '/workspace',
  parent: '/',
  entries: [
    {
      name: '<script>.txt',
      path: '/workspace/<script>.txt',
      type: 'file' as const,
      size: 5,
      modifiedAt: 123,
      isSymlink: false,
    },
  ],
  nextOffset: null,
  truncated: false,
};
const preview = { path: '/workspace/test', name: 'test', size: 5, text: 'hello', binary: false, truncated: false };

const MAX = 2 * 1024 * 1024;
it('forwards guest query as URL data and validates successful lists and previews', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(list)).mockResolvedValueOnce(Response.json(preview));
  const client = new HttpComputerController('http://controller:3101', fetcher as unknown as typeof fetch);
  const query = { path: '/workspace/a?x=#&雪', filter: '";&', offset: 200 };
  expect(await client.files('id', 'files', query)).toEqual(list);
  const url = fetcher.mock.calls[0][0] as URL;
  expect(url.origin).toBe('http://controller:3101');
  expect(url.pathname).toBe('/computers/id/files');
  expect(url.searchParams.get('path')).toBe(query.path);
  expect(url.searchParams.get('filter')).toBe(query.filter);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) });
  expect(await client.files('id', 'file-preview', { path: '/workspace/test' })).toEqual(preview);
});

it.each([400, 403, 404, 409, 429, 504, 500])(
  'preserves safe status %s without exposing upstream errors',
  async status => {
    const client = new HttpComputerController(
      'http://controller',
      vi.fn().mockResolvedValue(new Response('secret /host/path', { status })) as unknown as typeof fetch,
    );
    await expect(client.files('id', 'file-preview', { path: '/workspace/test' })).rejects.toMatchObject({
      status: status === 500 ? 503 : status,
    });
    await expect(
      new HttpComputerController(
        'http://controller',
        vi.fn().mockResolvedValue(new Response('secret /host/path', { status })) as unknown as typeof fetch,
      ).files('id', 'files', { path: '/' }),
    ).rejects.not.toThrow('secret');
  },
);

it('rejects malformed/oversized response metadata and cancels an over-limit byte stream', async () => {
  for (const data of [{}, { ...list, entries: Array(201).fill(list.entries[0]) }, { ...list, nextOffset: 20001 }]) {
    await expect(
      new HttpComputerController(
        'http://controller',
        vi.fn().mockResolvedValue(Response.json(data)) as unknown as typeof fetch,
      ).files('id', 'files', { path: '/' }),
    ).rejects.toMatchObject({ status: 503 });
  }
  await expect(
    new HttpComputerController(
      'http://controller',
      vi.fn().mockResolvedValue(Response.json({ ...preview, text: '雪'.repeat(65536) })) as unknown as typeof fetch,
    ).files('id', 'file-preview', { path: '/' }),
  ).rejects.toMatchObject({ status: 503 });
  const cancelled = vi.fn();
  const oversized = new Response(
    new ReadableStream({
      start(stream) {
        stream.enqueue(new Uint8Array(MAX));
        stream.enqueue(new Uint8Array(1));
      },
      cancel: cancelled,
    }),
  );
  await expect(boundedFileBody(oversized, MAX)).rejects.toMatchObject({ status: 503 });
  expect(cancelled).toHaveBeenCalledOnce();
});

const downloadHeaders = (size: number, start = 0, length = size) => ({
  'content-type': 'application/octet-stream',
  'x-file-size': String(size),
  'x-range-start': String(start),
  'x-range-length': String(length),
  etag: '"5-1"',
  'last-modified': 'Thu, 01 Jan 1970 00:00:00 GMT',
});
/** A fake controller serving pieces of a virtual file whose byte i is i % 251. */
function pieces(fetcher: ReturnType<typeof vi.fn>, size: number) {
  const asked: { start: number; end: number; match: string | null }[] = [];
  fetcher.mockImplementation(async (url: URL) => {
    const start = Number(url.searchParams.get('start')),
      end = Math.min(Number(url.searchParams.get('end')), size - 1);
    asked.push({ start, end: Number(url.searchParams.get('end')), match: url.searchParams.get('match') });
    const length = size ? end - start + 1 : 0;
    const data = new Uint8Array(length);
    for (let i = 0; i < length; i++) data[i] = (start + i) % 251;
    return new Response(data, { headers: downloadHeaders(size, start, length) });
  });
  return asked;
}
const expected = (start: number, length: number) => Buffer.from(Array.from({ length }, (_, i) => (start + i) % 251));
async function routeFixture() {
  const app = Fastify();
  const record = { id: 'id', state: 'running', desiredState: 'running' };
  const get = vi.fn().mockResolvedValue(record);
  const files = vi.fn(async (_id: string, mode: string) => (mode === 'files' ? list : preview));
  const fetcher = vi.fn();
  const client = new HttpComputerController('http://controller', fetcher as unknown as typeof fetch);
  client.files = files;
  registerComputerFileRoutes(app, { get } as unknown as ComputerStore, client);
  await app.ready();
  return { app, get, files, record, fetcher };
}
it('serves listings and previews with safe headers and without any claim API', async () => {
  const { app, files } = await routeFixture();
  try {
    for (const mode of ['files', 'file-preview']) {
      const path = '/workspace/evil"\r\n<script>雪.txt';
      const response = await app.inject({ url: `/api/computers/id/${mode}?path=${encodeURIComponent(path)}` });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.json()).toEqual(mode === 'files' ? list : preview);
    }
    expect(files).toHaveBeenCalledTimes(2);
  } finally {
    await app.close();
  }
});

it('parses one byte range and ignores what it cannot serve exactly', () => {
  expect(parseRange('bytes=0-0')).toEqual({ start: 0, end: 0 });
  expect(parseRange('bytes=100-')).toEqual({ start: 100 });
  expect(parseRange('bytes=-500')).toEqual({ suffix: 500 });
  for (const header of [undefined, '', 'bytes=-', 'bytes=5-1', 'bytes=0-1,4-5', 'items=0-1', 'bytes=x-1'])
    expect(parseRange(header)).toBeNull();
});

it('downloads any size in bounded pieces, with its length, validators and an attachment name', async () => {
  const { app, fetcher } = await routeFixture();
  try {
    const PIECE = 16 * 1024 * 1024;
    const size = 2 * PIECE + 5;
    const asked = pieces(fetcher, size);
    const path = '/home/agent/big "file".bin';
    const response = await app.inject(`/api/computers/id/download?path=${encodeURIComponent(path)}`);
    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      'content-type': 'application/octet-stream',
      'content-length': String(size),
      'accept-ranges': 'bytes',
      etag: '"5-1"',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-disposition': fileAttachment(path),
    });
    expect(response.rawPayload.equals(expected(0, size))).toBe(true);
    // Three pieces; every one after the first must still be the same file.
    expect(asked).toEqual([
      { start: 0, end: PIECE - 1, match: null },
      { start: PIECE, end: 2 * PIECE - 1, match: '"5-1"' },
      { start: 2 * PIECE, end: size - 1, match: '"5-1"' },
    ]);
    const url = fetcher.mock.calls[0]![0] as URL;
    expect(url.pathname).toBe('/computers/id/download');
    expect(url.searchParams.get('path')).toBe(path);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ signal: expect.any(AbortSignal) });
  } finally {
    await app.close();
  }
});

it('answers byte ranges with 206 (If-Range permitting) and an unsatisfiable one with 416', async () => {
  const { app, fetcher } = await routeFixture();
  try {
    const size = 1000;
    const asked = pieces(fetcher, size);
    const partial = await app.inject({
      url: '/api/computers/id/download?path=/f',
      headers: { range: 'bytes=100-199', 'if-range': '"5-1"' },
    });
    expect(partial.statusCode).toBe(206);
    expect(partial.headers['content-range']).toBe('bytes 100-199/1000');
    expect(partial.headers['content-length']).toBe('100');
    expect(partial.rawPayload.equals(expected(100, 100))).toBe(true);
    // The size comes from a one-byte read first.
    expect(asked[0]).toMatchObject({ start: 0, end: 0 });
    const suffix = await app.inject({ url: '/api/computers/id/download?path=/f', headers: { range: 'bytes=-10' } });
    expect(suffix.headers['content-range']).toBe('bytes 990-999/1000');
    expect(suffix.rawPayload.equals(expected(990, 10))).toBe(true);
    // The UI's one-byte check before a download.
    const check = await app.inject({ url: '/api/computers/id/download?path=/f', headers: { range: 'bytes=0-0' } });
    expect([check.statusCode, check.rawPayload.length]).toEqual([206, 1]);
    // Another validator: the file changed since the browser's partial copy, so it gets the whole file.
    const stale = await app.inject({
      url: '/api/computers/id/download?path=/f',
      headers: { range: 'bytes=100-199', 'if-range': '"0-0"' },
    });
    expect([stale.statusCode, stale.rawPayload.length]).toEqual([200, 1000]);
    const refused = await app.inject({ url: '/api/computers/id/download?path=/f', headers: { range: 'bytes=5000-' } });
    expect(refused.statusCode).toBe(416);
    expect(refused.headers['content-range']).toBe('bytes */1000');
    // A controller answer that does not look like a guest file piece is not passed on.
    fetcher.mockResolvedValueOnce(new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    expect((await app.inject('/api/computers/id/download?path=/f')).statusCode).toBe(503);
  } finally {
    await app.close();
  }
});

it('ends a download early when the file changes between pieces', async () => {
  const { app, fetcher } = await routeFixture();
  try {
    const PIECE = 16 * 1024 * 1024;
    pieces(fetcher, PIECE + 10);
    const first = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: URL, init: RequestInit) =>
      url.searchParams.get('match')
        ? Response.json({ message: 'The file changed while it was downloaded.' }, { status: 412 })
        : first(url, init),
    );
    // The headers (with the full length) are out when the second piece is refused: the response is cut short.
    await expect(app.inject('/api/computers/id/download?path=/f')).rejects.toThrow('response destroyed');
  } finally {
    await app.close();
  }
});

const part = (extra: Record<string, string | number> = {}) =>
  new URLSearchParams(
    Object.entries({ path: '/home/agent', name: 'a.bin', size: 5, offset: 0, upload: 'f'.repeat(32), ...extra }).map(
      ([key, value]) => [key, String(value)],
    ),
  );
it('streams upload parts to the controller: progress, then the result; conflicts are told apart', async () => {
  const { app, fetcher } = await routeFixture();
  try {
    const received: number[] = [];
    fetcher.mockImplementation(async (url: URL, init: RequestInit) => {
      const reader = (init.body as ReadableStream<Uint8Array>).getReader();
      let length = 0;
      for (let next = await reader.read(); !next.done; next = await reader.read()) length += next.value.length;
      received.push(length);
      const end = Number(url.searchParams.get('offset')) + length;
      return Response.json(
        end < Number(url.searchParams.get('size'))
          ? { received: end }
          : { name: 'a.bin', path: '/home/agent/a.bin', size: end },
      );
    });
    const size = 40 * 1024 * 1024;
    // A 32 MiB part (past Fastify's 1 MiB default body limit, never buffered by a parser), then the rest.
    const first = await app.inject({
      method: 'PUT',
      url: `/api/computers/id/upload?${part({ size, mode: 'rename' })}`,
      headers: { 'content-type': 'application/octet-stream', 'content-length': String(32 * 1024 * 1024) },
      payload: Readable.from(
        (function* () {
          for (let sent = 0; sent < 32; sent++) yield Buffer.alloc(1024 * 1024, 3);
        })(),
      ),
    });
    expect([first.statusCode, first.json()]).toEqual([202, { received: 32 * 1024 * 1024 }]);
    const url = fetcher.mock.calls[0]![0] as URL;
    expect(Object.fromEntries(url.searchParams)).toEqual({
      path: '/home/agent',
      name: 'a.bin',
      size: String(size),
      offset: '0',
      upload: 'f'.repeat(32),
      mode: 'rename',
      length: String(32 * 1024 * 1024),
    });
    const last = await app.inject({
      method: 'PUT',
      url: `/api/computers/id/upload?${part({ size, offset: 32 * 1024 * 1024, mode: 'rename' })}`,
      payload: Buffer.alloc(8 * 1024 * 1024),
    });
    expect([last.statusCode, last.json()]).toEqual([201, { name: 'a.bin', path: '/home/agent/a.bin', size }]);
    expect(received).toEqual([32 * 1024 * 1024, 8 * 1024 * 1024]);
    fetcher.mockResolvedValueOnce(Response.json({ message: 'A file with that name already exists.' }, { status: 409 }));
    const conflict = await app.inject({
      method: 'PUT',
      url: `/api/computers/id/upload?${part({ size: 0 })}`,
      payload: '',
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ message: 'A file with that name already exists.', conflict: true });
    expect((fetcher.mock.calls[2]![0] as URL).searchParams.get('mode')).toBe('refuse');
    fetcher.mockResolvedValueOnce(
      Response.json({ message: 'There is not enough free space on this computer.' }, { status: 507 }),
    );
    const full = await app.inject({ method: 'PUT', url: `/api/computers/id/upload?${part()}`, payload: 'hello' });
    expect(full.statusCode).toBe(507);
    expect(full.json()).toEqual({ message: 'There is not enough free space on this computer.' });
    fetcher.mockResolvedValueOnce(Response.json({ cancelled: true }));
    const cancelled = await app.inject({
      method: 'DELETE',
      url: `/api/computers/id/upload?path=/home/agent&name=a.bin&upload=${'f'.repeat(32)}`,
    });
    expect(cancelled.json()).toEqual({ cancelled: true });
    expect((fetcher.mock.calls[4]![1] as RequestInit).method).toBe('DELETE');
  } finally {
    await app.close();
  }
});

it('refuses unsafe upload names, oversized or missing part lengths and stopped computers before the controller', async () => {
  const { app, fetcher, record } = await routeFixture();
  try {
    for (const name of ['..', '.', 'a/b', 'x'.repeat(256), '雪'.repeat(86)])
      expect(
        (await app.inject({ method: 'PUT', url: `/api/computers/id/upload?${part({ name })}`, payload: 'x' }))
          .statusCode,
        name,
      ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/computers/id/upload?${part()}`.replace('a.bin', 'a%00b'),
          payload: 'x',
        })
      ).statusCode,
    ).toBe(400);
    for (const extra of [{ mode: 'append' }, { upload: 'F'.repeat(32) }, { offset: 4 }, { size: -1 }] as Record<
      string,
      string | number
    >[])
      expect(
        (await app.inject({ method: 'PUT', url: `/api/computers/id/upload?${part(extra)}`, payload: 'xx' })).statusCode,
        JSON.stringify(extra),
      ).toBe(400);
    const chunked = await app.inject({
      method: 'PUT',
      url: `/api/computers/id/upload?${part()}`,
      headers: { 'transfer-encoding': 'chunked' },
      payload: Readable.from([Buffer.from('x')]),
    });
    expect(chunked.statusCode).toBe(411);
    const oversized = await app.inject({
      method: 'PUT',
      url: `/api/computers/id/upload?${part({ size: 2 ** 40 })}`,
      headers: { 'content-length': String(64 * 1024 * 1024 + 1) },
      payload: Readable.from([Buffer.from('x')]),
    });
    expect(oversized.statusCode).toBe(413);
    record.state = 'stopped';
    expect(
      (await app.inject({ method: 'PUT', url: `/api/computers/id/upload?${part()}`, payload: 'hello' })).statusCode,
    ).toBe(409);
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

it('creates folders through the controller with a validated name', async () => {
  const { app, fetcher } = await routeFixture();
  try {
    fetcher.mockResolvedValueOnce(Response.json({ path: '/home/agent/new', created: true }));
    const created = await app.inject({
      method: 'POST',
      url: '/api/computers/id/folders',
      payload: { path: '/home/agent', name: 'new' },
    });
    expect(created.json()).toEqual({ path: '/home/agent/new', created: true });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ path: '/home/agent', name: 'new' });
    for (const name of ['..', 'a/b'])
      expect(
        (await app.inject({ method: 'POST', url: '/api/computers/id/folders', payload: { path: '/', name } }))
          .statusCode,
      ).toBe(400);
  } finally {
    await app.close();
  }
});

it('keeps listings available while transfers run, and bounds transfers per computer', async () => {
  const { app, fetcher } = await routeFixture();
  try {
    const held: (() => void)[] = [];
    fetcher.mockImplementation((url: URL) =>
      url.pathname.endsWith('/files')
        ? Promise.resolve(Response.json(list))
        : new Promise(done => held.push(() => done(new Response('x', { headers: downloadHeaders(1) })))),
    );
    const downloads = Array.from({ length: 4 }, () => app.inject('/api/computers/id/download?path=/f'));
    await vi.waitFor(() => expect(held).toHaveLength(4));
    expect((await app.inject('/api/computers/id/download?path=/f')).statusCode).toBe(429);
    expect((await app.inject('/api/computers/id/files?path=/')).statusCode).toBe(200);
    held.forEach(done => done());
    expect((await Promise.all(downloads)).map(response => response.statusCode)).toEqual([200, 200, 200, 200]);
    const next = app.inject('/api/computers/id/download?path=/f');
    await vi.waitFor(() => expect(held).toHaveLength(5));
    held[4]!();
    expect((await next).statusCode).toBe(200);
  } finally {
    await app.close();
  }
});
it('rejects missing/stopped/deleting computers and bad paths/pages before contacting controller', async () => {
  const { app, get, files, record } = await routeFixture();
  try {
    get.mockResolvedValueOnce(null);
    expect((await app.inject('/api/computers/missing/files?path=/')).statusCode).toBe(404);
    record.desiredState = 'stopped';
    expect((await app.inject('/api/computers/id/files?path=/')).statusCode).toBe(409);
    record.desiredState = 'running';
    record.state = 'deleting';
    expect((await app.inject('/api/computers/id/files?path=/')).statusCode).toBe(409);
    for (const query of [
      'path=relative',
      'path=/%00',
      'path=/&offset=-1',
      'path=/&offset=20001',
      `path=/&filter=${'x'.repeat(257)}`,
    ]) {
      const response = await app.inject(`/api/computers/id/files?${query}`);
      expect(response.statusCode).toBe(400);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(Object.keys(response.json())).toEqual(['message']);
    }
    expect(files).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
it('propagates safe controller failures and bounds concurrent requests', async () => {
  const { app, files } = await routeFixture();
  try {
    files.mockRejectedValueOnce(new ComputerFileError(403, 'Path access denied.'));
    const failure = await app.inject('/api/computers/id/file-preview?path=/file');
    expect(failure.statusCode).toBe(403);
    expect(failure.json()).toEqual({ message: 'Path access denied.' });
    let resolve!: (value: typeof list) => void;
    files.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    const pending = app.inject('/api/computers/id/files?path=/');
    await vi.waitFor(() => expect(files).toHaveBeenCalledTimes(2));
    expect((await app.inject('/api/computers/id/files?path=/')).statusCode).toBe(429);
    resolve(list);
    expect((await pending).statusCode).toBe(200);
  } finally {
    await app.close();
  }
}, 15000);
it('lets a second request for the same computer wait for the first instead of failing it', async () => {
  const { app, files } = await routeFixture();
  try {
    files.mockImplementationOnce(() => new Promise(done => setTimeout(() => done(list), 400)));
    const first = app.inject('/api/computers/id/files?path=/');
    await vi.waitFor(() => expect(files).toHaveBeenCalledTimes(1));
    const second = await app.inject('/api/computers/id/files?path=/workspace'); // arrives while the first is running
    expect(second.statusCode).toBe(200);
    expect((await first).statusCode).toBe(200);
    expect(files).toHaveBeenCalledTimes(2);
  } finally {
    await app.close();
  }
});
