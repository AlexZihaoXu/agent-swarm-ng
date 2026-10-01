import { expect, it, vi } from 'vitest';
import { DockerApi } from './docker-api';
import { ComputerManager } from './manager';
import { mountedStorage, storageMounts, validateFolder, validateKeptPaths, validateStorage } from './storage';

const id = '8f5b0e5c-1f2a-4b3c-9d4e-5f6a7b8c9d0e';
const name = 'Workspace-TEST';

it('keeps only safe paths, always the home folder', () => {
  expect(validateKeptPaths(['/usr/local', '/var/lib/postgresql', '/etc/postgresql', '/opt/myapp'])).toEqual([
    '/home/agent',
    '/usr/local',
    '/var/lib/postgresql',
    '/etc/postgresql',
    '/opt/myapp',
  ]);
  for (const bad of [
    '/',
    '/etc',
    '/usr',
    '/var',
    '/proc/1',
    '/sys',
    '/run/x',
    '/keep',
    '/cache/a',
    '/opt/swarm',
    'relative',
    '/a/../b',
    '/a b',
    '/a/',
    '/usr/lib/agent-swarm/bin',
  ])
    expect(() => validateKeptPaths([bad]), bad).toThrow('cannot be kept');
  expect(() => validateKeptPaths(Array.from({ length: 33 }, (_, index) => `/srv/${index}`))).toThrow('at most 32');
});

it('accepts only absolute, plain host folders, and empty for the default volumes', () => {
  expect(validateFolder('', 'keep')).toBeNull();
  expect(validateFolder(null, 'cache')).toBeNull();
  expect(validateFolder('/srv/agent-swarm', 'keep')).toBe('/srv/agent-swarm');
  for (const bad of ['srv', '/', '/srv/', '/srv/../etc', '/srv:/etc', '/srv,x', '/srv\nx'])
    expect(() => validateFolder(bad, 'keep'), bad).toThrow('absolute host path');
  expect(validateStorage(undefined)).toEqual({
    keepFolder: null,
    cacheFolder: null,
    keptPaths: ['/home/agent', '/usr/local'],
  });
});

it('mounts two places per computer and reads them back from its container', () => {
  const mounts = storageMounts(id, { keepFolder: '/srv/keep', cacheFolder: null }, kind => `vol-${kind}`);
  expect(mounts).toEqual([
    { Type: 'bind', Source: `/srv/keep/computers/${id}`, Target: '/keep' },
    { Type: 'volume', Source: 'vol-cache', Target: '/cache' },
  ]);
  expect(
    mountedStorage(id, [
      { Type: 'bind', Source: `/srv/keep/computers/${id}`, Destination: '/keep' },
      { Type: 'volume', Name: 'vol-cache', Destination: '/cache' },
      { Type: 'bind', Source: '/elsewhere', Destination: '/other' },
    ]),
  ).toEqual({ keep: { kind: 'bind', folder: '/srv/keep' }, cache: { kind: 'volume', name: 'vol-cache' } });
});

/** A Docker stand-in for the storage helper containers: records each script and answers with `exitFor`. */
function helperDocker(exitFor: (script: string) => { code: number; stderr?: string; stdout?: string }) {
  const scripts: { script: string; mounts: unknown }[] = [];
  const docker = new DockerApi('/nonexistent.sock');
  let last = { code: 0, stderr: '', stdout: '' };
  const frame = (stream: number, text: string) => {
    const payload = Buffer.from(text);
    const header = Buffer.alloc(8);
    header[0] = stream;
    header.writeUInt32BE(payload.length, 4);
    return Buffer.concat([header, payload]);
  };
  vi.spyOn(docker, 'optional').mockImplementation(
    async path => (path.startsWith('/images/') ? { Config: { Labels: {} } } : null) as never,
  );
  vi.spyOn(docker, 'json').mockImplementation(async (method, path, body) => {
    if (method === 'POST' && path === '/containers/create') {
      const config = body as { Entrypoint: string[]; HostConfig: { Mounts: unknown } };
      scripts.push({ script: config.Entrypoint[2], mounts: config.HostConfig.Mounts });
      last = { stderr: '', stdout: '', ...exitFor(config.Entrypoint[2]) };
      return { Id: `helper-${scripts.length}` } as never;
    }
    return [] as never;
  });
  vi.spyOn(docker, 'request').mockImplementation(async (method, path) => {
    if (path.endsWith('/wait')) return Buffer.from(JSON.stringify({ StatusCode: last.code }));
    if (path.includes('/logs')) return Buffer.concat([frame(1, last.stdout), frame(2, last.stderr)]);
    return Buffer.alloc(0);
  });
  return { docker, scripts };
}

it('uses a host folder only when its marker is there, and says so when it is not', async () => {
  const { docker, scripts } = helperDocker(script =>
    script.includes('.agent-swarm-cache-root')
      ? { code: 3, stderr: 'The Cache folder /mnt/usb is not ready: its disk may not be mounted' }
      : { code: 0 },
  );
  const manager = new ComputerManager(docker, 'swarm-ng-test', '{}');
  await expect(manager.checkFolder('keep', '/srv/keep')).resolves.toBeUndefined();
  expect(scripts[0]).toMatchObject({ mounts: [{ Type: 'bind', Source: '/srv/keep', Target: '/base' }] });
  expect(scripts[0].script).toContain('test -f /base/.agent-swarm-keep-root');
  await expect(manager.checkFolder('cache', '/mnt/usb')).rejects.toMatchObject({
    code: 409,
    message: expect.stringContaining('not ready'),
  });
  await expect(manager.checkFolder('keep', 'relative')).rejects.toMatchObject({ code: 400 });
});

it('deletes a computer’s host folders with it, but only once their disks are there', async () => {
  let markerMissing = true;
  const { docker, scripts } = helperDocker(script =>
    markerMissing && script.startsWith('test -f')
      ? { code: 3, stderr: 'The Keep folder /srv/keep is not ready' }
      : { code: 0 },
  );
  const manager = new ComputerManager(docker, 'swarm-ng-test', '{}');
  const storage = { keepFolder: '/srv/keep', cacheFolder: null, keptPaths: ['/home/agent'] };
  // No container any more (a failed create): the folders saved by the backend are used.
  await expect(manager.remove(id, name, storage)).rejects.toMatchObject({ code: 409 });
  expect(scripts.some(entry => entry.script.includes('rm -rf'))).toBe(false);
  markerMissing = false;
  await manager.remove(id, name, storage);
  expect(scripts.at(-1)).toMatchObject({
    script: `rm -rf /base/computers/${id}`,
    mounts: [{ Source: '/srv/keep', Target: '/base' }],
  });
});

it('carries a newly kept path over from the old computer, unless the Keep folder already has it', async () => {
  const { docker, scripts } = helperDocker(script => ({
    code: 0,
    stdout: script.includes('/var/lib/redis') ? 'kept\n' : 'copy\n',
  }));
  const copies: string[][] = [];
  vi.spyOn(docker, 'copyArchive').mockImplementation(async (from, path, to, directory) => {
    copies.push([from, path, to, directory]);
    return true;
  });
  const manager = new ComputerManager(docker, 'swarm-ng-test', '{}');
  const keep = { Type: 'volume' as const, Source: 'vol-keep', Target: '/keep' };
  const carryOver = (
    manager as unknown as { carryOver: (id: string, path: string, mounts: unknown[]) => Promise<void> }
  ).carryOver.bind(manager);
  await carryOver('old-desktop', '/var/lib/postgresql', [keep]);
  await carryOver('old-desktop', '/var/lib/redis', [keep]);
  expect(scripts[0]).toMatchObject({ mounts: [keep] });
  expect(scripts[0].script).toContain("mkdir -p '/keep/root/var/lib'");
  expect(copies).toEqual([['old-desktop', '/var/lib/postgresql', 'helper-1', '/keep/root/var/lib']]);
});
