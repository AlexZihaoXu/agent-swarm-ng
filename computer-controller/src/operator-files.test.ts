import { afterEach, expect, it, vi } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ComputerManager } from './manager';
import { DockerApi } from './docker-api';
import {
  decodeFileResult,
  downloadResult,
  fileAttachment,
  headerResult,
  operatorFilesScript,
  readStatusLine,
  type FileOperation,
} from './operator-files';

const execute = promisify(execFile);
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const root = resolve('.scratch');
  await mkdir(root, { recursive: true });
  const path = await mkdtemp(join(root, 'operator-files-'));
  folders.push(path);
  return path;
}
async function guest(mode: FileOperation, path: string, extra = {}) {
  const { stdout } = await execute(
    '/usr/bin/python3',
    ['-I', '-c', operatorFilesScript, mode, JSON.stringify({ path, ...extra })],
    { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024, timeout: 20_000 },
  );
  return decodeFileResult(stdout, mode);
}
/** Runs the guest program as the controller does for transfers: stdin in, stdout out (status line first). */
function transfer(mode: string, request: object, input?: Buffer | null, program = operatorFilesScript) {
  return new Promise<{ status: Record<string, unknown>; bytes: Buffer }>((done, fail) => {
    const child = spawn(
      '/usr/bin/python3',
      program === operatorFilesScript
        ? ['-I', '-c', program, mode, JSON.stringify(request)]
        : ['-I', '-c', program, operatorFilesScript, mode, JSON.stringify(request)],
    );
    const output: Buffer[] = [];
    child.stdout.on('data', chunk => output.push(chunk));
    child.on('error', fail);
    // The guest may refuse before reading its input (a conflict, a full disk).
    child.stdin.on('error', () => {});
    child.on('close', () => {
      const raw = Buffer.concat(output);
      const newline = raw.indexOf(10);
      done({ status: JSON.parse(raw.subarray(0, newline).toString()), bytes: raw.subarray(newline + 1) });
    });
    if (input) child.stdin.end(input);
    else if (input === null) child.stdin.destroy();
    else child.stdin.end();
  });
}

it('lists, filters and pages metadata; previews UTF-8', async () => {
  const root = await fixture();
  const name = 'quotes";$(echo nope)\n雪.txt';
  await writeFile(join(root, name), 'hello 雪\n');
  await mkdir(join(root, 'folder'));
  await symlink(join(root, name), join(root, 'link'));
  const result = (await guest('files', root)).result;
  expect(result).toMatchObject({ path: root, parent: resolve(root, '..'), nextOffset: null, truncated: false });
  expect(result.entries[0]).toMatchObject({ name: 'folder', type: 'directory' });
  expect(result.entries.find((e: { name: string }) => e.name === 'link')).toMatchObject({
    type: 'other',
    isSymlink: true,
  });
  expect((await guest('files', root, { filter: '雪' })).result.entries).toHaveLength(1);
  expect((await guest('file-preview', join(root, name))).result).toMatchObject({
    text: 'hello 雪\n',
    binary: false,
    truncated: false,
    size: 10,
  });
  expect(fileAttachment(name)).not.toMatch(/[\r\n]/);
  expect(fileAttachment(name)).toContain('%E9%9B%AA');
  await Promise.all(Array.from({ length: 201 }, (_, i) => writeFile(join(root, `entry${i}`), '')));
  const page = (await guest('files', root, { filter: 'entry' })).result;
  expect(page.entries).toHaveLength(200);
  expect(page.nextOffset).toBe(200);
  expect((await guest('files', root, { filter: 'entry', offset: 200 })).result.entries).toHaveLength(1);
});

it('bounds previews and detects binaries', async () => {
  const root = await fixture(),
    path = join(root, 'file');
  await writeFile(path, Buffer.alloc(65537, 97));
  const preview = (await guest('file-preview', path)).result;
  expect(Buffer.byteLength(preview.text)).toBe(65536);
  expect(preview.truncated).toBe(true);
  await writeFile(path, Buffer.from([0, 1, 255]));
  expect((await guest('file-preview', path)).result).toMatchObject({ binary: true, text: null });
});

it('streams any piece of a file, refusing a changed file or a range past its end', async () => {
  const root = await fixture(),
    path = join(root, 'data.bin');
  const data = Buffer.from(Array.from({ length: 3 * 1024 * 1024 + 7 }, (_, i) => i % 251));
  await writeFile(path, data);
  const whole = await transfer('download', { path });
  expect(whole.status).toMatchObject({ status: 200, result: { name: 'data.bin', size: data.length, start: 0 } });
  expect(downloadResult(whole.status.result as Record<string, unknown>)).toMatchObject({ length: data.length });
  expect(whole.bytes.equals(data)).toBe(true);
  const { etag } = whole.status.result as { etag: string };
  const piece = await transfer('download', { path, start: 10, end: 19, match: etag });
  expect(piece.status.result).toMatchObject({ start: 10, length: 10 });
  expect(piece.bytes.equals(data.subarray(10, 20))).toBe(true);
  // A piece past the end is cut at the end.
  const tail = await transfer('download', { path, start: data.length - 3, end: data.length + 100 });
  expect(tail.bytes.equals(data.subarray(-3))).toBe(true);
  expect((await transfer('download', { path, start: 0, end: 0, match: '"0-0"' })).status).toMatchObject({
    status: 412,
  });
  expect((await transfer('download', { path, start: data.length })).status).toMatchObject({
    status: 416,
    size: data.length,
  });
  await writeFile(join(root, 'empty'), '');
  expect((await transfer('download', { path: join(root, 'empty'), start: 0, end: 0 })).status.result).toMatchObject({
    length: 0,
    size: 0,
  });
});

const upload = 'a'.repeat(32);
const part = (name: string, size: number, offset = 0, length = size, extra = {}) => ({
  name,
  size,
  offset,
  length,
  upload,
  ...extra,
});

it('uploads in parts through a hidden file, placed only after the last part', async () => {
  const root = await fixture();
  // The browser opens with an empty part (the name and space check), then sends data from offset 0.
  expect((await transfer('upload', { path: root, ...part('a.txt', 11, 0, 0) }, null)).status.result).toEqual({
    received: 0,
  });
  const first = await transfer('upload', { path: root, ...part('a.txt', 11, 0, 5) }, Buffer.from('hello'));
  expect(first.status).toEqual({ status: 200, result: { received: 5 } });
  expect(await readdir(root)).toEqual([`.a.txt.${upload}.swarm-upload`]);
  // Parts come in order: a gap means the upload was interrupted.
  expect(
    (await transfer('upload', { path: root, ...part('a.txt', 11, 6, 5) }, Buffer.from('world'))).status,
  ).toMatchObject({ status: 409, message: 'The upload was interrupted; start it again.' });
  await transfer('upload', { path: root, ...part('a.txt', 11, 0, 5) }, Buffer.from('hello'));
  await transfer('upload', { path: root, ...part('a.txt', 11, 5, 1) }, Buffer.from(' '));
  const last = await transfer('upload', { path: root, ...part('a.txt', 11, 6, 5) }, Buffer.from('world'));
  expect(last.status).toEqual({ status: 200, result: { name: 'a.txt', size: 11 } });
  expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('hello world');
  expect(await readdir(root)).toEqual(['a.txt']);
  // Offsets of any size (parts are 32 MiB in the browser).
  const big = Buffer.alloc(50_000, 9);
  await transfer('upload', { path: root, ...part('big', 50_000, 0, 25_000) }, big.subarray(0, 25_000));
  expect(
    (await transfer('upload', { path: root, ...part('big', 50_000, 25_000, 25_000) }, big.subarray(25_000))).status,
  ).toEqual({ status: 200, result: { name: 'big', size: 50_000 } });
  expect((await readFile(join(root, 'big'))).equals(big)).toBe(true);
  await rm(join(root, 'big'));
  // A later part with no upload in progress (cancelled, or another browser) is refused.
  expect((await transfer('upload', { path: root, ...part('b.txt', 2, 1, 1) }, Buffer.from('x'))).status).toMatchObject({
    status: 409,
  });
  // Cancelling removes the hidden file.
  await transfer('upload', { path: root, ...part('c.txt', 4, 0, 2) }, Buffer.from('ab'));
  expect((await guest('cancel' as FileOperation, root, { name: 'c.txt', upload })).result).toEqual({
    cancelled: true,
  });
  expect(await readdir(root)).toEqual(['a.txt']);
});

it('settles name conflicts by mode', async () => {
  const root = await fixture();
  await transfer('upload', { path: root, ...part('a.txt', 5) }, Buffer.from('hello'));
  expect((await transfer('upload', { path: root, ...part('a.txt', 3) }, Buffer.from('new'))).status).toMatchObject({
    status: 409,
    message: 'A file with that name already exists.',
  });
  const kept = await transfer(
    'upload',
    { path: root, ...part('a.txt', 3, 0, 3, { mode: 'rename' }) },
    Buffer.from('two'),
  );
  expect(kept.status.result).toEqual({ name: 'a (1).txt', size: 3 });
  const third = await transfer(
    'upload',
    { path: root, ...part('a.txt', 1, 0, 1, { mode: 'rename' }) },
    Buffer.from('3'),
  );
  expect(third.status.result).toMatchObject({ name: 'a (2).txt' });
  await transfer('upload', { path: root, ...part('a.txt', 3, 0, 3, { mode: 'overwrite' }) }, Buffer.from('NEW'));
  expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('NEW');
  // An empty file is one empty part.
  expect((await transfer('upload', { path: root, ...part('empty', 0) }, Buffer.alloc(0))).status.result).toEqual({
    name: 'empty',
    size: 0,
  });
  expect((await readdir(root)).sort()).toEqual(['a (1).txt', 'a (2).txt', 'a.txt', 'empty']);
});

it('refuses unsafe names, symlinked or non-folder targets, and a symlink or folder of that name', async () => {
  const root = await fixture();
  await mkdir(join(root, 'folder'));
  await writeFile(join(root, 'file'), 'x');
  await symlink(join(root, 'file'), join(root, 'link'));
  await symlink(root, join(root, 'parent'));
  for (const name of ['', '.', '..', 'a/b', 'a\0b', 'x'.repeat(256)]) {
    expect((await transfer('upload', { path: root, ...part(name, 1) }, Buffer.from('x'))).status).toMatchObject({
      status: 400,
    });
  }
  for (const extra of [{ upload: 'nothex' }, { upload: '../' + 'a'.repeat(29) }, { offset: 2 }, { length: -1 }]) {
    expect(
      (await transfer('upload', { path: root, ...part('n', 1), ...extra }, Buffer.from('x'))).status,
    ).toMatchObject({ status: 400 });
  }
  for (const path of [join(root, 'parent'), join(root, 'file'), '/proc/self']) {
    const { status } = await transfer('upload', { path, ...part('n', 1) }, Buffer.from('x'));
    expect([400, 403]).toContain(status.status);
  }
  // A FIFO (or link) planted under the hidden name is refused without waiting on it.
  await execute('mkfifo', [join(root, `.fifo.${upload}.swarm-upload`)]);
  expect((await transfer('upload', { path: root, ...part('fifo', 1) }, Buffer.from('x'))).status.status).not.toBe(200);
  await rm(join(root, `.fifo.${upload}.swarm-upload`));
  expect(
    (await transfer('upload', { path: root, ...part('link', 1, 0, 1, { mode: 'overwrite' }) }, Buffer.from('x')))
      .status,
  ).toMatchObject({ status: 403 });
  expect(
    (await transfer('upload', { path: root, ...part('folder', 1, 0, 1, { mode: 'overwrite' }) }, Buffer.from('x')))
      .status,
  ).toMatchObject({ status: 409 });
  expect(await readFile(join(root, 'file'), 'utf8')).toBe('x');
  expect((await readdir(root)).sort()).toEqual(['file', 'folder', 'link', 'parent']);
});

it('keeps nothing of an upload whose part stops short, and never writes past a part', async () => {
  const root = await fixture();
  // The sender went away: the guest sees end of input before the part's length.
  expect((await transfer('upload', { path: root, ...part('big', 10) }, Buffer.from('half'))).status).toMatchObject({
    status: 400,
    message: 'The upload did not finish.',
  });
  await transfer('upload', { path: root, ...part('big', 20, 0, 10) }, Buffer.from('0123456789'));
  expect((await transfer('upload', { path: root, ...part('big', 20, 10, 10) }, null)).status).toMatchObject({
    status: 400,
  });
  expect(await readdir(root)).toEqual([]);
  // Input past the part's length is never written (the controller refuses to send it in the first place).
  await transfer('upload', { path: root, ...part('two', 2) }, Buffer.from('long'));
  expect(await readFile(join(root, 'two'), 'utf8')).toBe('lo');
});

it('fails cleanly with 507 when the guest disk is too small or fills up while writing', async () => {
  const root = await fixture();
  // The program is run with a patched os module: no free space reported, or ENOSPC on the second write.
  const harness = (patch: string) =>
    [
      'import sys, os, errno',
      'source = sys.argv[1]',
      'sys.argv = ["operator-files"] + sys.argv[2:]',
      'ns = {"__name__": "fixture"}',
      'exec(source, ns)',
      patch,
      'ns["main"]()',
    ].join('\n');
  const full = harness('class S: f_bavail = 1; f_frsize = 1\nns["os"].fstatvfs = lambda fd: S()');
  expect((await transfer('upload', { path: root, ...part('f', 5) }, Buffer.from('hello'), full)).status).toEqual({
    status: 507,
    message: 'There is not enough free space on this computer.',
  });
  const filling = harness(
    [
      'real = ns["os"].write',
      'calls = [0]',
      'def write(fd, data):',
      '    if fd != 1:',
      '        calls[0] += 1',
      '        if calls[0] > 1: raise OSError(errno.ENOSPC, "full")',
      '    return real(fd, data)',
      'ns["os"].write = write',
    ].join('\n'),
  );
  const data = Buffer.alloc(3 * 1024 * 1024, 1);
  expect((await transfer('upload', { path: root, ...part('f', data.length) }, data, filling)).status).toMatchObject({
    status: 507,
  });
  expect(await readdir(root)).toEqual([]);
});

it('creates folders as the guest user; an existing folder is fine, a file of that name is not', async () => {
  const root = await fixture();
  expect((await guest('folder' as FileOperation, root, { name: 'new' })).result).toEqual({
    path: join(root, 'new'),
    created: true,
  });
  expect((await guest('folder' as FileOperation, root, { name: 'new' })).result).toMatchObject({ created: false });
  await writeFile(join(root, 'file'), '');
  await expect(guest('folder' as FileOperation, root, { name: 'file' })).rejects.toMatchObject({ code: 409 });
  await expect(guest('folder' as FileOperation, root, { name: '../x' })).rejects.toMatchObject({ code: 400 });
});

it('rejects symlinks, parent symlinks, FIFO, directories and virtual paths without blocking', async () => {
  const root = await fixture();
  await writeFile(join(root, 'file'), 'secret');
  await symlink(join(root, 'file'), join(root, 'link'));
  await symlink(root, join(root, 'parent'));
  await symlink('/proc', join(root, 'virtual'));
  await execute('mkfifo', [join(root, 'pipe')]);
  for (const path of [
    join(root, 'link'),
    join(root, 'parent/file'),
    join(root, 'virtual/self/environ'),
    join(root, 'pipe'),
    root,
    '/proc/self/environ',
    '/dev/zero',
    '/sys/kernel/uevent_seqnum',
  ]) {
    const { status, bytes } = await transfer('download', { path });
    expect(status.status).not.toBe(200);
    expect(bytes).toHaveLength(0);
  }
  expect((await transfer('download', { path: join(root, 'missing') })).status).toMatchObject({ status: 404 });
  await expect(guest('files', 'relative')).rejects.toMatchObject({ code: 400 });
  await expect(guest('files', root, { offset: 20001 })).rejects.toMatchObject({ code: 400 });
});

it('bounds directory scans honestly at 20,000', async () => {
  const root = await fixture();
  await execute('/usr/bin/python3', [
    '-I',
    '-c',
    'import os,sys\nfor i in range(20001):\n fd=os.open(os.path.join(sys.argv[1],str(i)),os.O_CREAT|os.O_WRONLY,0o600);os.close(fd)',
    root,
  ]);
  const result = (await guest('files', root, { offset: 19800 })).result;
  expect(result.entries).toHaveLength(200);
  expect(result.nextOffset).toBeNull();
  expect(result.truncated).toBe(true);
});

const id = '4a18018a-4689-4fa5-86ca-4dc080d41fb4';
const none = async function* (): AsyncGenerator<Uint8Array> {};
const status = (result: object) => Buffer.from(JSON.stringify({ status: 200, result }) + '\n');
const downloadStatus = (size: number, start = 0, length = size) =>
  status({ name: 'file', size, start, length, etag: '"5-1"', modified: 'Thu, 01 Jan 1970' });
function managerFixture() {
  const exec = vi.fn(async () => status({ path: '/workspace', parent: '/', entries: [] }));
  const pipe = vi.fn();
  const optional = vi.fn();
  const manager = new ComputerManager({ exec, optional, pipe } as unknown as DockerApi, 'files-test', '{}');
  const container = {
    Id: 'immutable-guest',
    State: { Running: true },
    Config: { Labels: manager.names.labels(id, 'desktop', 'Desk') },
  };
  optional.mockResolvedValue(container);
  return { manager, exec, pipe, optional, container };
}
it('executes fixed isolated Python argv only on the inspected managed running guest as uid1000', async () => {
  const { manager, exec, optional, container } = managerFixture();
  const path = '/workspace/";touch nope';
  await manager.operatorFiles(id, 'files', { path });
  expect(exec).toHaveBeenCalledWith(
    'immutable-guest',
    [
      '/usr/bin/timeout',
      '--signal=TERM',
      '--kill-after=2s',
      '18s',
      '/usr/bin/python3',
      '-I',
      '-c',
      operatorFilesScript,
      'files',
      JSON.stringify({ path }),
    ],
    '1000:1000',
    23000,
    2 * 1024 * 1024,
  );
  container.State.Running = false;
  await expect(manager.operatorFiles(id, 'files', { path })).rejects.toMatchObject({ code: 409 });
  container.State.Running = true;
  container.Config.Labels = {};
  await expect(manager.operatorFiles(id, 'files', { path })).rejects.toMatchObject({ code: 409 });
  optional.mockResolvedValue(null);
  await expect(manager.operatorFiles(id, 'files', { path })).rejects.toMatchObject({ code: 404 });
  expect(exec).toHaveBeenCalledTimes(1);
});
it('limits listing concurrency and releases admission after failed execution', async () => {
  const { manager, exec } = managerFixture();
  let reject!: (error: Error) => void;
  exec.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const first = manager.operatorFiles(id, 'files', { path: '/workspace' });
  await vi.waitFor(() => expect(exec).toHaveBeenCalledTimes(1));
  await expect(manager.operatorFiles(id, 'files', { path: '/workspace' })).rejects.toMatchObject({ code: 429 });
  reject(Error('failed'));
  await expect(first).rejects.toThrow('failed');
  await expect(manager.operatorFiles(id, 'files', { path: '/workspace' })).resolves.toHaveProperty('result');
});

it('streams a download piece as the guest reads it, without holding the listing lock', async () => {
  const { manager, pipe, exec } = managerFixture();
  const size = 3 * 1024 ** 3;
  let release!: () => void;
  const gate = new Promise<void>(done => (release = done));
  let produced = 0;
  const returned = vi.fn();
  pipe.mockResolvedValue({
    output: (async function* () {
      try {
        produced += 1024;
        yield Buffer.concat([downloadStatus(size, 0, 16 * 1024 * 1024), Buffer.alloc(1024, 1)]);
        await gate;
        for (let left = 16 * 1024 * 1024 - 1024; left > 0; left -= 1024 * 1024) {
          produced += Math.min(left, 1024 * 1024);
          yield Buffer.alloc(Math.min(left, 1024 * 1024), 2);
        }
      } finally {
        returned();
      }
    })(),
  });
  const query = { path: '/home/agent/big', start: 0, end: 16 * 1024 * 1024 - 1, match: '"5-1"' };
  const file = await manager.operatorDownload(id, query);
  expect(pipe).toHaveBeenCalledWith(
    'immutable-guest',
    ['/usr/bin/python3', '-I', '-c', operatorFilesScript, 'download', JSON.stringify(query)],
    '1000:1000',
    undefined,
    { idleTimeoutMs: 300_000 },
  );
  expect(file.result).toMatchObject({ size, length: 16 * 1024 * 1024 });
  // The first bytes arrive before the guest has produced anything more.
  const first = await file.stream.next();
  expect(first.value).toHaveLength(1024);
  expect(produced).toBe(1024);
  // A transfer does not hold the listing lock.
  await expect(manager.operatorFiles(id, 'files', { path: '/home/agent' })).resolves.toHaveProperty('result');
  expect(exec).toHaveBeenCalledTimes(1);
  release();
  let read = 1024;
  for await (const chunk of file.stream) read += chunk.length;
  expect(read).toBe(16 * 1024 * 1024);
  expect(returned).toHaveBeenCalledOnce();
});

it('ends a download piece that comes up short with an error, and maps guest refusals', async () => {
  const { manager, pipe } = managerFixture();
  pipe.mockResolvedValueOnce({
    output: (async function* () {
      yield Buffer.concat([downloadStatus(10), Buffer.from('12345')]);
    })(),
  });
  const file = await manager.operatorDownload(id, { path: '/f' });
  await file.stream.next();
  await expect(file.stream.next()).rejects.toMatchObject({ code: 503 });
  pipe.mockResolvedValueOnce({
    output: (async function* () {
      yield Buffer.from('{"status":416,"message":"x","size":99}\n');
    })(),
  });
  await expect(manager.operatorDownload(id, { path: '/f', start: 500 })).rejects.toMatchObject({ code: 416, size: 99 });
  pipe.mockResolvedValueOnce({
    output: (async function* () {
      yield Buffer.from('{"status":412,"message":"The file changed while it was downloaded."}\n');
    })(),
  });
  await expect(manager.operatorDownload(id, { path: '/f', start: 5, match: '"1-2"' })).rejects.toMatchObject({
    code: 412,
  });
  pipe.mockResolvedValueOnce({
    output: (async function* () {
      yield Buffer.from('{"status":403,"message":"secret /host"}\n');
    })(),
  });
  await expect(manager.operatorDownload(id, { path: '/f' })).rejects.toThrow(/^Path access denied/);
  for (const bad of [{ path: '/f', start: 5, end: 3 }, { path: 'relative' }, { path: '/f', match: 'x"; rm' }])
    await expect(manager.operatorDownload(id, bad)).rejects.toMatchObject({ code: 400 });
});

const uploadQuery = (extra = {}) => ({
  path: '/home/agent',
  name: 'a.txt',
  size: 5,
  offset: 0,
  length: 5,
  upload: 'b'.repeat(32),
  mode: 'refuse' as const,
  ...extra,
});
it('streams an upload part to the guest program, keeping its input open, and reports progress or the result', async () => {
  const { manager, pipe } = managerFixture();
  const sent: Buffer[] = [];
  pipe.mockImplementation(async (_guest, command: string[], _user, stdin: AsyncIterable<Uint8Array>) => ({
    output: (async function* () {
      for await (const chunk of stdin) sent.push(Buffer.from(chunk));
      const request = JSON.parse(command.at(-1)!);
      yield status(
        request.offset + request.length < request.size
          ? { received: request.offset + request.length }
          : { name: 'a (1).txt', size: 5 },
      );
    })(),
  }));
  const body = (...parts: string[]) =>
    (async function* () {
      for (const part of parts) yield Buffer.from(part);
    })();
  expect(await manager.operatorUpload(id, uploadQuery({ length: 3, mode: 'rename' }), body('hel'))).toEqual({
    received: 3,
  });
  const query = uploadQuery({ offset: 3, length: 2, mode: 'rename' });
  expect(await manager.operatorUpload(id, query, body('l', 'o'))).toEqual({
    name: 'a (1).txt',
    size: 5,
    path: '/home/agent/a (1).txt',
  });
  expect(Buffer.concat(sent).toString()).toBe('hello');
  expect(pipe.mock.calls[1]).toEqual([
    'immutable-guest',
    ['/usr/bin/python3', '-I', '-c', operatorFilesScript, 'upload', JSON.stringify(query)],
    '1000:1000',
    expect.anything(),
    { idleTimeoutMs: 600_000, keepStdinOpen: true },
  ]);
  for (const bad of [
    uploadQuery({ name: '../x' }),
    uploadQuery({ name: 'a/b' }),
    uploadQuery({ size: -1 }),
    uploadQuery({ offset: 4 }),
    uploadQuery({ upload: 'B'.repeat(32) }),
    uploadQuery({ mode: 'append' }),
  ])
    await expect(manager.operatorUpload(id, bad as ReturnType<typeof uploadQuery>, none())).rejects.toMatchObject({
      code: 400,
    });
  await expect(
    manager.operatorUpload(id, uploadQuery({ size: 2 ** 40, length: 64 * 1024 * 1024 + 1 }), none()),
  ).rejects.toMatchObject({ code: 413 });
});

it('closes the guest input when a part ends short or runs long, so nothing waits forever', async () => {
  const { manager, pipe } = managerFixture();
  const seen: unknown[] = [];
  pipe.mockImplementation(async (_guest, _command, _user, stdin: AsyncIterable<Uint8Array>) => ({
    output: (async function* () {
      try {
        for await (const _ of stdin);
      } catch (error) {
        seen.push(error);
        throw error; // pipeExec ends the connection: the guest sees the end of its input
      }
    })(),
  }));
  const short = (async function* () {
    yield Buffer.from('he');
  })();
  await expect(manager.operatorUpload(id, uploadQuery(), short)).rejects.toMatchObject({ code: 400 });
  const long = (async function* () {
    yield Buffer.from('hello!');
  })();
  await expect(manager.operatorUpload(id, uploadQuery(), long)).rejects.toMatchObject({ code: 400 });
  expect(seen.map(error => (error as Error).message)).toEqual([
    'The upload did not finish.',
    'The upload part is larger than announced.',
  ]);
});

it('answers a conflict the guest reported before the part was sent, and a dropped sender as unfinished', async () => {
  const { manager, pipe } = managerFixture();
  pipe.mockResolvedValueOnce({
    output: (async function* () {
      yield Buffer.from('{"status":409,"message":"A file with that name already exists."}\n');
      throw new Error('Docker exec stream closed.');
    })(),
  });
  await expect(manager.operatorUpload(id, uploadQuery(), none())).rejects.toMatchObject({
    code: 409,
    message: 'A file with that name already exists.',
  });
  pipe.mockResolvedValueOnce({
    output: (async function* () {
      throw new Error('The browser went away.');
    })(),
  });
  await expect(manager.operatorUpload(id, uploadQuery(), none())).rejects.toMatchObject({ code: 400 });
  pipe.mockResolvedValueOnce({
    output: (async function* () {
      yield Buffer.from('{"status":507,"message":"There is not enough free space on this computer."}\n');
    })(),
  });
  await expect(manager.operatorUpload(id, uploadQuery(), none())).rejects.toMatchObject({ code: 507 });
});

it('cancels an upload by removing its hidden file, as the guest user', async () => {
  const { manager, exec } = managerFixture();
  exec.mockResolvedValueOnce(status({ cancelled: true }));
  await expect(manager.operatorCancelUpload(id, '/home/agent', 'a.txt', 'c'.repeat(32))).resolves.toEqual({
    cancelled: true,
  });
  const call = exec.mock.calls[0] as unknown as [string, string[], string];
  expect(call[1].slice(-2)).toEqual([
    'cancel',
    JSON.stringify({ path: '/home/agent', name: 'a.txt', upload: 'c'.repeat(32) }),
  ]);
  expect(call[2]).toBe('1000:1000');
  await expect(manager.operatorCancelUpload(id, '/home/agent', '..', 'c'.repeat(32))).rejects.toMatchObject({
    code: 400,
  });
});

it('bounds transfers per computer and overall, and releases each slot when it ends', async () => {
  const { manager, pipe } = managerFixture();
  const pending: (() => void)[] = [];
  pipe.mockImplementation(async () => ({
    output: (async function* () {
      await new Promise<void>(done => pending.push(done));
      yield status({ name: 'a.txt', size: 5 });
    })(),
  }));
  const running = Array.from({ length: 6 }, () => manager.operatorUpload(id, uploadQuery({ mode: 'rename' }), none()));
  await vi.waitFor(() => expect(pending).toHaveLength(6));
  await expect(manager.operatorUpload(id, uploadQuery(), none())).rejects.toMatchObject({ code: 429 });
  pending.forEach(done => done());
  await Promise.all(running);
  pending.length = 0;
  const next = manager.operatorUpload(id, uploadQuery(), none());
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  pending[0]!();
  await expect(next).resolves.toMatchObject({ name: 'a.txt' });
});

it('reads the status line without consuming the bytes after it, and maps only fixed messages', async () => {
  const iterator = (async function* () {
    yield Buffer.from('{"status":200,');
    yield Buffer.from('"result":{}}\nbytes');
    yield Buffer.from('more');
  })();
  const { line, rest } = await readStatusLine(iterator);
  expect(JSON.parse(line.toString())).toEqual({ status: 200, result: {} });
  expect(rest.toString()).toBe('bytes');
  expect((await iterator.next()).value?.toString()).toBe('more');
  expect(() => headerResult(Buffer.from('not-json'))).toThrow('Invalid guest');
  expect(() => headerResult(Buffer.from('{"status":403,"message":"secret"}'))).toThrow('Path access denied');
  expect(() => decodeFileResult(Buffer.from('{"status":200,"result":{}}\nextra'), 'files')).toThrow('Invalid guest');
  expect(() => downloadResult({ name: 'x', size: 1, start: 1, length: 1 })).toThrow('Invalid guest');
});

it('rejects virtual filesystem aliases by descriptor filesystem type', async () => {
  const root = await fixture();
  const program = `
ns = {'__name__': 'fixture'}
exec(sys.argv[1], ns)
class Virtual:
    def fstatfs(self, fd, result):
        result._obj[0] = 0x9fa0
        return 0
ns['ctypes'].CDLL = lambda *args, **kwargs: Virtual()
try:
    ns['safe_open'](sys.argv[2], True)
except ns['Failure'] as error:
    assert error.status == 403
else:
    raise AssertionError('virtual mount alias accepted')
`;
  await execute('/usr/bin/python3', ['-I', '-c', 'import sys\n' + program, operatorFilesScript, root]);
});

it('keeps the guest program within one argv string', () => {
  // Linux refuses a single argument over 128 KiB (MAX_ARG_STRLEN).
  expect(Buffer.byteLength(operatorFilesScript)).toBeLessThan(100 * 1024);
});
