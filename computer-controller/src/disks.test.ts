import { expect, it, vi } from 'vitest';
import { DockerApi, DockerApiError } from './docker-api';
import { ComputerManager } from './manager';
import { diskScript, parseDiskOutput, parseExtraDisks, validateRequestedPaths } from './disks';

const DF_HEADER = 'Filesystem             Type 1024-blocks      Used Available Capacity Mounted on';
const helperOutput = [
  DF_HEADER,
  '/dev/nvme0n1p2      ext4   490048472 390261140  74820728      84% /m/0',
  'tank/agent-swarm-ng zfs    412190464    803456 411387008       1% /m/1',
  'bulk                zfs    595062144       384 595061760       1% /m/2',
  '---',
  DF_HEADER,
  'tank/agent-swarm-ng    zfs    412190464    803456 411387008       1% /m/1',
  'bulk                   zfs    595062144       384 595061760       1% /m/2',
  'bulk/drive-2026        zfs    812038656 216976896 595061760      27% /m/2/drive-2026',
  'bulk/uwlearn/backups   zfs    595950592    888832 595061760       1% /m/2/uwlearn/backups',
  '',
].join('\n');

it('accepts only plain absolute host paths', () => {
  expect(validateRequestedPaths(['/srv/keep', '/srv/keep', '/'])).toEqual(['/srv/keep', '/']);
  for (const bad of [['relative'], ['/a/../b'], ['/a/'], ['/a//b'], ['/a b'], ['/a,b'], 'x', [1]])
    expect(() => validateRequestedPaths(bad)).toThrow();
  expect(() => validateRequestedPaths(Array.from({ length: 17 }, (_, i) => `/p${i}`))).toThrow();
  expect(parseExtraDisks(' /home/user/storage/drives/bulk, ,/srv/x/../y,/mnt/tank ,/mnt/tank')).toEqual({
    paths: ['/home/user/storage/drives/bulk', '/mnt/tank'],
    invalid: ['/srv/x/../y'],
  });
  expect(parseExtraDisks(undefined)).toEqual({ paths: [], invalid: [] });
});

it('reads df output back onto the requested paths, with every ZFS dataset seen', () => {
  const paths = [
    { path: '/var/lib/docker', use: 'docker' as const },
    { path: '/srv/keep', use: 'requested' as const },
    { path: '/home/user/storage/drives/bulk', use: 'listed' as const },
    { path: '/gone', use: 'listed' as const },
  ];
  const { disks, zfs } = parseDiskOutput(helperOutput, paths);
  expect(disks).toEqual([
    {
      path: '/var/lib/docker',
      use: 'docker',
      source: '/dev/nvme0n1p2',
      fstype: 'ext4',
      size: 490048472 * 1024,
      used: 390261140 * 1024,
      avail: 74820728 * 1024,
    },
    expect.objectContaining({ path: '/srv/keep', source: 'tank/agent-swarm-ng', fstype: 'zfs' }),
    expect.objectContaining({ path: '/home/user/storage/drives/bulk', source: 'bulk', used: 384 * 1024 }),
    { path: '/gone', use: 'listed', error: 'unavailable' },
  ]);
  expect(zfs.map(item => item.dataset)).toEqual([
    'tank/agent-swarm-ng',
    'bulk',
    'bulk/drive-2026',
    'bulk/uwlearn/backups',
  ]);
  expect(zfs[2]).toEqual({ dataset: 'bulk/drive-2026', used: 216976896 * 1024, avail: 595061760 * 1024 });
  expect(diskScript(2)).toBe('df -P -k -T /m/0 /m/1 2>/dev/null; echo ---; df -P -k -T -t zfs 2>/dev/null; true');
});

function diskDocker(missing: string[] = []) {
  const docker = new DockerApi('/nonexistent.sock');
  const helpers: {
    script: string;
    mounts: { Source: string; ReadOnly?: boolean; BindOptions?: unknown }[];
    caps: unknown;
  }[] = [];
  const frame = (text: string) => {
    const payload = Buffer.from(text);
    const header = Buffer.alloc(8);
    header[0] = 1;
    header.writeUInt32BE(payload.length, 4);
    return Buffer.concat([header, payload]);
  };
  vi.spyOn(docker, 'optional').mockImplementation(
    async path => (path.startsWith('/images/') ? { Config: { Labels: {} } } : null) as never,
  );
  vi.spyOn(docker, 'json').mockImplementation(async (method, path, body) => {
    if (method === 'GET' && path === '/info') return { DockerRootDir: '/var/lib/docker' } as never;
    if (method === 'POST' && path === '/containers/create') {
      const config = body as {
        Entrypoint: string[];
        HostConfig: { Mounts: (typeof helpers)[number]['mounts']; CapAdd: unknown; NetworkMode: string };
      };
      expect(config.HostConfig.NetworkMode).toBe('none');
      if (config.HostConfig.Mounts.some(mount => missing.includes(mount.Source))) throw new DockerApiError(400); // Docker: bind source path does not exist
      helpers.push({ script: config.Entrypoint[2], mounts: config.HostConfig.Mounts, caps: config.HostConfig.CapAdd });
      return { Id: `helper-${helpers.length}` } as never;
    }
    return [] as never;
  });
  vi.spyOn(docker, 'request').mockImplementation(async (_method, path) => {
    if (path.endsWith('/wait')) return Buffer.from(JSON.stringify({ StatusCode: 0 }));
    if (path.includes('/logs')) {
      // Each helper answers for its own mounts, in order.
      const mounts = helpers.at(-1)!.mounts;
      const line = (source: string, index: number) =>
        source === '/var/lib/docker'
          ? `/dev/nvme0n1p2 ext4 100 60 40 60% /m/${index}`
          : `bulk zfs 200 10 190 5% /m/${index}`;
      return frame(
        `${DF_HEADER}\n${mounts.map((mount, index) => line(mount.Source, index)).join('\n')}\n---\n${DF_HEADER}\nbulk/x zfs 300 110 190 37% /m/9/x\n`,
      );
    }
    return Buffer.alloc(0);
  });
  return { docker, helpers };
}

it('measures Docker’s root, the listed and the requested paths read-only in one helper', async () => {
  const { docker, helpers } = diskDocker();
  const manager = new ComputerManager(docker, 'swarm-ng-test', '{}');
  const result = await manager.diskUsage(['/srv/cache'], ['/mnt/bulk', '/']);
  expect(helpers).toHaveLength(1);
  expect(helpers[0].caps).toEqual(['DAC_READ_SEARCH']);
  expect(helpers[0].mounts).toEqual([
    { Type: 'bind', Source: '/var/lib/docker', Target: '/m/0', ReadOnly: true, BindOptions: { NonRecursive: true } },
    { Type: 'bind', Source: '/mnt/bulk', Target: '/m/1', ReadOnly: true },
    { Type: 'bind', Source: '/', Target: '/m/2', ReadOnly: true, BindOptions: { NonRecursive: true } },
    { Type: 'bind', Source: '/srv/cache', Target: '/m/3', ReadOnly: true },
  ]);
  expect(result.disks.map(disk => [disk.path, disk.use])).toEqual([
    ['/var/lib/docker', 'docker'],
    ['/mnt/bulk', 'listed'],
    ['/', 'listed'],
    ['/srv/cache', 'requested'],
  ]);
  expect(result.disks[0]).toMatchObject({ source: '/dev/nvme0n1p2', size: 100 * 1024, used: 60 * 1024 });
  expect(result.zfs).toEqual([{ dataset: 'bulk/x', used: 110 * 1024, avail: 190 * 1024 }]);
  await expect(manager.diskUsage(['../etc'], [])).rejects.toMatchObject({ code: 400 });
});

it('reports a missing host path as unavailable and still measures the rest', async () => {
  const { docker, helpers } = diskDocker(['/mnt/unplugged']);
  const manager = new ComputerManager(docker, 'swarm-ng-test', '{}');
  const result = await manager.diskUsage(['/srv/cache'], ['/mnt/unplugged']);
  expect(helpers.map(helper => helper.mounts.map(mount => mount.Source))).toEqual([
    ['/var/lib/docker'],
    ['/srv/cache'],
  ]);
  expect(result.disks).toEqual([
    expect.objectContaining({ path: '/var/lib/docker', source: '/dev/nvme0n1p2' }),
    { path: '/mnt/unplugged', use: 'listed', error: 'unavailable' },
    expect.objectContaining({ path: '/srv/cache', source: 'bulk' }),
  ]);
});
