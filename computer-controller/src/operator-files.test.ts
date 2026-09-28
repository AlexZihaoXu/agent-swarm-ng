import { afterEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile, symlink, truncate } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ComputerManager } from './manager';
import { DockerApi } from './docker-api';
import { decodeFileResult, fileAttachment, MAX_DOWNLOAD, operatorFilesScript, type FileOperation } from './operator-files';

const execute = promisify(execFile);
const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const root = resolve('.scratch');
  await mkdir(root, { recursive: true });
  const path = await mkdtemp(join(root, 'operator-files-'));
  folders.push(path);
  return path;
}
async function guest(mode: FileOperation, path: string, extra = {}) {
  const { stdout } = await execute('/usr/bin/python3', ['-I', '-c', operatorFilesScript, mode, JSON.stringify({ path, ...extra })], { encoding: 'buffer', maxBuffer: MAX_DOWNLOAD + 2 * 1024 * 1024, timeout: 20_000 });
  return decodeFileResult(stdout, mode);
}

it('lists, filters and pages metadata; previews UTF-8 and downloads exact hostile-named bytes', async () => {
  const root = await fixture();
  const name = 'quotes";$(echo nope)\n雪.txt';
  await writeFile(join(root, name), 'hello 雪\n');
  await mkdir(join(root, 'folder'));
  await symlink(join(root, name), join(root, 'link'));
  const result = (await guest('files', root)).result;
  expect(result).toMatchObject({ path: root, parent: resolve(root, '..'), nextOffset: null, truncated: false });
  expect(result.entries[0]).toMatchObject({ name: 'folder', type: 'directory' });
  expect(result.entries.find((e: { name: string }) => e.name === 'link')).toMatchObject({ type: 'other', isSymlink: true });
  expect((await guest('files', root, { filter: '雪' })).result.entries).toHaveLength(1);
  expect((await guest('file-preview', join(root, name))).result).toMatchObject({ text: 'hello 雪\n', binary: false, truncated: false, size: 10 });
  expect((await guest('download', join(root, name))).bytes).toEqual(Buffer.from('hello 雪\n'));
  expect(fileAttachment(name)).not.toMatch(/[\r\n]/);
  expect(fileAttachment(name)).toContain('%E9%9B%AA');
  await Promise.all(Array.from({ length: 201 }, (_, i) => writeFile(join(root, `entry${i}`), '')));
  const page = (await guest('files', root, { filter: 'entry' })).result;
  expect(page.entries).toHaveLength(200);
  expect(page.nextOffset).toBe(200);
  expect((await guest('files', root, { filter: 'entry', offset: 200 })).result.entries).toHaveLength(1);
});

it('bounds previews, detects binaries and refuses oversized downloads before reading', async () => {
  const root = await fixture(), path = join(root, 'file');
  await writeFile(path, Buffer.alloc(65537, 97));
  const preview = (await guest('file-preview', path)).result;
  expect(Buffer.byteLength(preview.text)).toBe(65536);
  expect(preview.truncated).toBe(true);
  await writeFile(path, Buffer.from([0, 1, 255]));
  expect((await guest('file-preview', path)).result).toMatchObject({ binary: true, text: null });
  await truncate(path, MAX_DOWNLOAD + 1);
  await expect(guest('download', path)).rejects.toMatchObject({ code: 413 });
  await truncate(path, MAX_DOWNLOAD);
  expect((await guest('download', path)).bytes?.length).toBe(MAX_DOWNLOAD);
});

it('rejects symlinks, parent symlinks, FIFO, directories and virtual paths without blocking', async () => {
  const root = await fixture();
  await writeFile(join(root, 'file'), 'secret');
  await symlink(join(root, 'file'), join(root, 'link'));
  await symlink(root, join(root, 'parent'));
  await symlink('/proc', join(root, 'virtual'));
  await execute('mkfifo', [join(root, 'pipe')]);
  for (const path of [join(root, 'link'), join(root, 'parent/file'), join(root, 'virtual/self/environ'), join(root, 'pipe'), root, '/proc/self/environ', '/dev/zero', '/sys/kernel/uevent_seqnum']) {
    await expect(guest('download', path)).rejects.toHaveProperty('code');
  }
  await expect(guest('download', join(root, 'missing'))).rejects.toMatchObject({ code: 404 });
  await expect(guest('files', 'relative')).rejects.toMatchObject({ code: 400 });
  await expect(guest('files', root, { offset: 20001 })).rejects.toMatchObject({ code: 400 });
});

it('bounds directory scans honestly at 20,000', async () => {
  const root = await fixture();
  await execute('/usr/bin/python3', ['-I', '-c', 'import os,sys\nfor i in range(20001):\n fd=os.open(os.path.join(sys.argv[1],str(i)),os.O_CREAT|os.O_WRONLY,0o600);os.close(fd)', root]);
  const result = (await guest('files', root, { offset: 19800 })).result;
  expect(result.entries).toHaveLength(200);
  expect(result.nextOffset).toBeNull();
  expect(result.truncated).toBe(true);
});

const id = '4a18018a-4689-4fa5-86ca-4dc080d41fb4';
function managerFixture() {
  const exec = vi.fn(async () => Buffer.from('{"status":200,"result":{"name":"file"}}\nhello'));
  const optional = vi.fn();
  const manager = new ComputerManager({ exec, optional } as unknown as DockerApi, 'files-test', '{}');
  const container = { Id: 'immutable-guest', State: { Running: true }, Config: { Labels: manager.names.labels(id, 'desktop', 'Desk') } };
  optional.mockResolvedValue(container);
  return { manager, exec, optional, container };
}
it('executes fixed isolated Python argv only on the inspected managed running guest as uid1000', async () => {
  const { manager, exec, optional, container } = managerFixture();
  const path = '/workspace/";touch nope';
  expect((await manager.operatorFiles(id, 'download', { path })).bytes?.toString()).toBe('hello');
  expect(exec).toHaveBeenCalledWith('immutable-guest', ['/usr/bin/timeout', '--signal=TERM', '--kill-after=2s', '18s', '/usr/bin/python3', '-I', '-c', operatorFilesScript, 'download', JSON.stringify({ path })], '1000:1000', 23000, MAX_DOWNLOAD + 1024 * 1024);
  container.State.Running = false;
  await expect(manager.operatorFiles(id, 'download', { path })).rejects.toMatchObject({ code: 409 });
  container.State.Running = true;
  container.Config.Labels = {};
  await expect(manager.operatorFiles(id, 'download', { path })).rejects.toMatchObject({ code: 409 });
  optional.mockResolvedValue(null);
  await expect(manager.operatorFiles(id, 'download', { path })).rejects.toMatchObject({ code: 404 });
  expect(exec).toHaveBeenCalledTimes(1);
});
it('limits concurrency and releases admission after failed execution', async () => {
  const { manager, exec } = managerFixture();
  let reject!: (error: Error) => void;
  exec.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const first = manager.operatorFiles(id, 'files', { path: '/workspace' });
  await vi.waitFor(() => expect(exec).toHaveBeenCalledTimes(1));
  await expect(manager.operatorFiles(id, 'files', { path: '/workspace' })).rejects.toMatchObject({ code: 429 });
  reject(Error('failed'));
  await expect(first).rejects.toThrow('failed');
  await expect(manager.operatorFiles(id, 'download', { path: '/workspace/file' })).resolves.toHaveProperty('bytes');
});

it('rejects virtual filesystem aliases by descriptor filesystem type and bounds malformed envelopes', async () => {
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
  expect(() => decodeFileResult(Buffer.from('not-json\n'), 'files')).toThrow('Invalid guest');
  expect(() => decodeFileResult(Buffer.from('{"status":403,"message":"secret"}\n'), 'files')).toThrow('Path access denied');
  expect(() => decodeFileResult(Buffer.from('{"status":200,"result":{}}\nextra'), 'files')).toThrow('Invalid guest');
});
