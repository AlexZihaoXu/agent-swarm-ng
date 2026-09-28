import { expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { HttpComputerController } from './computer-controller-client';
import { ComputerFileError, MAX_DOWNLOAD, boundedFileBody, fileAttachment } from './computer-files';
import { registerComputerFileRoutes } from './computer-file-routes';
import type { ComputerStore } from './computer-store';

const list = { path: '/workspace', parent: '/', entries: [{ name: '<script>.txt', path: '/workspace/<script>.txt', type: 'file' as const, size: 5, modifiedAt: 123, isSymlink: false }], nextOffset: null, truncated: false };
const preview = { path: '/workspace/test', name: 'test', size: 5, text: 'hello', binary: false, truncated: false };

it('forwards guest query as URL data and validates successful lists, previews and downloads', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(list)).mockResolvedValueOnce(Response.json(preview)).mockResolvedValueOnce(new Response('hello', { headers: { 'content-type': 'application/octet-stream' } }));
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
  expect(await client.files('id', 'download', { path: '/workspace/test' })).toEqual(Buffer.from('hello'));
});

it.each([400, 403, 404, 409, 413, 429, 504, 500])('preserves safe status %s without exposing upstream errors', async status => {
  const client = new HttpComputerController('http://controller', vi.fn().mockResolvedValue(new Response('secret /host/path', { status })) as unknown as typeof fetch);
  await expect(client.files('id', 'download', { path: '/workspace/test' })).rejects.toMatchObject({ status: status === 500 ? 503 : status });
  await expect(new HttpComputerController('http://controller', vi.fn().mockResolvedValue(new Response('secret /host/path', { status })) as unknown as typeof fetch).files('id', 'files', { path: '/' })).rejects.not.toThrow('secret');
});

it('rejects malformed/oversized response metadata and cancels an over-limit byte stream', async () => {
  for (const data of [{}, { ...list, entries: Array(201).fill(list.entries[0]) }, { ...list, nextOffset: 20001 }]) {
    await expect(new HttpComputerController('http://controller', vi.fn().mockResolvedValue(Response.json(data)) as unknown as typeof fetch).files('id', 'files', { path: '/' })).rejects.toMatchObject({ status: 503 });
  }
  await expect(new HttpComputerController('http://controller', vi.fn().mockResolvedValue(Response.json({ ...preview, text: '雪'.repeat(65536) })) as unknown as typeof fetch).files('id', 'file-preview', { path: '/' })).rejects.toMatchObject({ status: 503 });
  const cancelled = vi.fn();
  const oversized = new Response(new ReadableStream({ start(stream) { stream.enqueue(new Uint8Array(MAX_DOWNLOAD)); stream.enqueue(new Uint8Array(1)); }, cancel: cancelled }));
  await expect(boundedFileBody(oversized, MAX_DOWNLOAD)).rejects.toMatchObject({ status: 503 });
  expect(cancelled).toHaveBeenCalledOnce();
  await expect(new HttpComputerController('http://controller', vi.fn().mockResolvedValue(new Response('<html>', { headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch).files('id', 'download', { path: '/' })).rejects.toMatchObject({ status: 503 });
});

async function routeFixture() {
  const app = Fastify();
  const record = { id: 'id', state: 'running', desiredState: 'running' };
  const get = vi.fn().mockResolvedValue(record);
  const files = vi.fn(async (_id, mode) => mode === 'files' ? list : mode === 'file-preview' ? preview : Buffer.from('hello'));
  const client = new HttpComputerController('http://unused');
  client.files = files;
  registerComputerFileRoutes(app, { get } as unknown as ComputerStore, client);
  await app.ready();
  return { app, get, files, record };
}
it('serves all three operator routes with safe headers and without any claim API', async () => {
  const { app, files } = await routeFixture();
  try {
    for (const mode of ['files', 'file-preview', 'download']) {
      const path = '/workspace/evil"\r\n<script>雪.txt';
      const response = await app.inject({ url: `/api/computers/id/${mode}?path=${encodeURIComponent(path)}` });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      if (mode === 'download') {
        expect(response.headers['content-type']).toBe('application/octet-stream');
        expect(response.headers['content-disposition']).toBe(fileAttachment(path));
        expect(response.headers['content-disposition']).not.toMatch(/[\r\n]/);
        expect(response.body).toBe('hello');
      } else expect(response.json()).toEqual(mode === 'files' ? list : preview);
    }
    expect(files).toHaveBeenCalledTimes(3);
  } finally { await app.close(); }
});
it('rejects missing/stopped/deleting computers and bad paths/pages before contacting controller', async () => {
  const { app, get, files, record } = await routeFixture();
  try {
    get.mockResolvedValueOnce(null);
    expect((await app.inject('/api/computers/missing/files?path=/')).statusCode).toBe(404);
    record.desiredState = 'stopped';
    expect((await app.inject('/api/computers/id/files?path=/')).statusCode).toBe(409);
    record.desiredState = 'running'; record.state = 'deleting';
    expect((await app.inject('/api/computers/id/files?path=/')).statusCode).toBe(409);
    for (const query of ['path=relative', 'path=/%00', 'path=/&offset=-1', 'path=/&offset=20001', `path=/&filter=${'x'.repeat(257)}`]) {
      const response = await app.inject(`/api/computers/id/files?${query}`);
      expect(response.statusCode).toBe(400);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(Object.keys(response.json())).toEqual(['message']);
    }
    expect(files).not.toHaveBeenCalled();
  } finally { await app.close(); }
});
it('propagates safe controller failures and bounds concurrent requests', async () => {
  const { app, files } = await routeFixture();
  try {
    files.mockRejectedValueOnce(new ComputerFileError(413, 'Downloads are limited to 64 MiB.'));
    const failure = await app.inject('/api/computers/id/download?path=/file');
    expect(failure.statusCode).toBe(413);
    expect(failure.json()).toEqual({ message: 'Downloads are limited to 64 MiB.' });
    let resolve!: (value: typeof list) => void;
    files.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = app.inject('/api/computers/id/files?path=/');
    await vi.waitFor(() => expect(files).toHaveBeenCalledTimes(2));
    expect((await app.inject('/api/computers/id/files?path=/')).statusCode).toBe(429);
    resolve(list);
    expect((await pending).statusCode).toBe(200);
  } finally { await app.close(); }
});
