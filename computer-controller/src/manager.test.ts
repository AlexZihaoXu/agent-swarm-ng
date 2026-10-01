import { expect, it, vi } from 'vitest';
import { ComputerManager, computerHostname, desktopCreateBody, desktopEnvironment } from './manager';
import { DockerApi } from './docker-api';

const id = '4a18018a-4689-4fa5-86ca-4dc080d41fb4';
const name = 'Work computer';
function fixture(renderDevice = '', timezone = '') {
  const resources = new Map<string, unknown>();
  const request = vi.fn(async (..._args: unknown[]) => Buffer.alloc(0));
  const execute = vi.fn(async () => Buffer.alloc(0));
  const docker = {
    optional: async (path: string) => resources.get(path) ?? null,
    request,
    json: vi.fn(async () => []),
    exec: execute,
  } as unknown as DockerApi;
  const manager = new ComputerManager(
    docker,
    'swarm-ng-test',
    '{}',
    undefined,
    undefined,
    undefined,
    renderDevice,
    2,
    timezone,
  );
  return { manager, resources, request, execute, docker };
}

function existingRunning(manager: ComputerManager, resources: Map<string, unknown>) {
  resources.set(`/containers/${manager.names.desktop(id)}/json`, {
    Id: 'desktop',
    State: { Running: true },
    Config: { Labels: manager.names.labels(id, 'desktop', name), Env: ['COMPUTER_KEPT_PATHS=/home/agent:/usr/local'] },
    Mounts: (['keep', 'cache'] as const).map(role => ({
      Type: 'volume',
      Name: manager.names.volume(id, role),
      Destination: `/${role}`,
    })),
    NetworkSettings: { Networks: { [manager.names.privateNetwork(id)]: { IPAddress: '172.25.10.2' } } },
  });
  resources.set(`/containers/${manager.names.gateway(id)}/json`, {
    Id: 'gateway',
    State: { Running: true },
    Config: { Labels: manager.names.labels(id, 'egress', name) },
  });
  resources.set(`/networks/${manager.names.privateNetwork(id)}`, {
    Id: 'private',
    Labels: manager.names.labels(id, 'private-network'),
  });
  for (const role of ['keep', 'cache'] as const) {
    resources.set(`/volumes/${manager.names.volume(id, role)}`, {
      Name: manager.names.volume(id, role),
      Labels: manager.names.labels(id, role),
    });
  }
}

function stoppedReplacementFixture() {
  const context = fixture();
  const { manager, resources, request, docker } = context;
  existingRunning(manager, resources);
  const canonical = manager.names.desktop(id),
    next = `${canonical}-settings-next`,
    previous = `${canonical}-settings-previous`;
  const old = resources.get(`/containers/${canonical}/json`) as Record<string, any>;
  Object.assign(old, {
    Id: 'old-desktop',
    Image: 'sha256:approved',
    HostConfig: { Devices: [] },
    State: { Running: false, Status: 'exited' },
  });
  const gateway = resources.get(`/containers/${manager.names.gateway(id)}/json`) as Record<string, any>;
  gateway.NetworkSettings = { Networks: { [manager.names.privateNetwork(id)]: { IPAddress: '172.25.10.1' } } };
  resources.set('/images/sha256%3Aapproved/json', { Config: { Labels: {} } });
  let failNewRename = false,
    loseOldDeleteResponse = false;
  vi.mocked(docker.json).mockImplementation(async (method: string, path: string, body?: unknown) => {
    if (method === 'GET' && path === '/info') return { NCPU: 16, MemTotal: 28 * 1024 ** 3 };
    if (method === 'POST' && path.startsWith('/containers/create?name=')) {
      const config = body as Record<string, any>;
      resources.set(`/containers/${next}/json`, {
        Id: 'new-desktop',
        Image: 'sha256:approved',
        State: { Running: false, Status: 'created' },
        Config: { Labels: config.Labels, Env: config.Env },
        HostConfig: config.HostConfig,
        NetworkSettings: { Networks: { [manager.names.privateNetwork(id)]: { IPAddress: '172.25.10.3' } } },
      });
      return { Id: 'new-desktop' };
    }
    return [];
  });
  request.mockImplementation(async (method: unknown, path: unknown) => {
    const url = String(path);
    if (method === 'POST' && url === `/containers/old-desktop/rename?name=${encodeURIComponent(previous)}`) {
      resources.set(`/containers/${previous}/json`, resources.get(`/containers/${canonical}/json`));
      resources.delete(`/containers/${canonical}/json`);
    } else if (method === 'POST' && url.startsWith('/containers/new-desktop/rename?')) {
      if (failNewRename) throw Error('simulated rename failure');
      resources.set(`/containers/${canonical}/json`, resources.get(`/containers/${next}/json`));
      resources.delete(`/containers/${next}/json`);
    } else if (method === 'DELETE' && url.startsWith('/containers/new-desktop?')) {
      resources.delete(`/containers/${canonical}/json`);
      resources.delete(`/containers/${next}/json`);
    } else if (method === 'POST' && url === `/containers/old-desktop/rename?name=${encodeURIComponent(canonical)}`) {
      resources.set(`/containers/${canonical}/json`, resources.get(`/containers/${previous}/json`));
      resources.delete(`/containers/${previous}/json`);
    } else if (method === 'DELETE' && url.startsWith('/containers/old-desktop?')) {
      resources.delete(`/containers/${previous}/json`);
      if (loseOldDeleteResponse) throw Error('simulated lost delete response');
    }
    return Buffer.alloc(0);
  });
  return {
    ...context,
    canonical,
    next,
    previous,
    failRename: () => {
      failNewRename = true;
    },
    loseDeleteResponse: () => {
      loseOldDeleteResponse = true;
    },
  };
}

it.each(['agent-swarm-default:stage2', 'agent-swarm-computer-egress:dev', 'agent-swarm-computer-media:stage2'])(
  'refuses a Compose-labelled managed image before creating resources: %s',
  async tainted => {
    const { manager, resources, request } = fixture();
    for (const image of [
      'agent-swarm-default:stage2',
      'agent-swarm-computer-egress:dev',
      'agent-swarm-computer-media:stage2',
    ]) {
      resources.set(`/images/${encodeURIComponent(image)}/json`, {
        Config: { Labels: image === tainted ? { 'com.docker.compose.project': 'disposable' } : {} },
      });
    }
    await expect(manager.create(id, name)).rejects.toMatchObject({
      code: 503,
      message: expect.stringContaining('Compose'),
    });
    expect(request).not.toHaveBeenCalled();
  },
);

it('opens terminal streams only through the fixed helper in an inspected owned running guest', async () => {
  const { manager, resources, docker } = fixture();
  existingRunning(manager, resources);
  const stream = vi.fn(async () => ({ write: () => {}, close: () => {} }));
  docker.execStream = stream;
  const signal = new AbortController().signal,
    output = () => {},
    end = () => {};
  await manager.terminalStream(id, id, signal, output, end);
  expect(stream).toHaveBeenCalledWith(
    'desktop',
    ['/usr/bin/python3', '-I', '/opt/swarm/computer-terminal-viewer.py', id],
    signal,
    output,
    end,
  );
  const row = resources.get(`/containers/${manager.names.desktop(id)}/json`) as any;
  row.State.Running = false;
  await expect(manager.terminalStream(id, id, signal, output, end)).rejects.toMatchObject({ code: 409 });
  row.State.Running = true;
  row.Config.Labels['swarm.ng.namespace'] = 'foreign';
  await expect(manager.terminalStream(id, id, signal, output, end)).rejects.toMatchObject({ code: 409 });
  await expect(manager.terminalStream(id, '../host', signal, output, end)).rejects.toThrow();
  expect(stream).toHaveBeenCalledTimes(1);
});

it('uses a canonical DNS alias shorter than one label for isolated media relays', () => {
  const { manager } = fixture();
  expect(manager.names.mediaAlias(id)).toBe(`computer-${id}`);
  expect(manager.names.mediaAlias(id).length).toBeLessThan(63);
  expect(manager.names.mediaAlias(id)).not.toBe(manager.names.media(id));
});

it('does not remove a same-named foreign container or its volumes', async () => {
  const { manager, resources, request } = fixture();
  const path = `/containers/${manager.names.desktop(id)}/json`;
  resources.set(path, {
    Id: 'foreign',
    Config: { Labels: { 'swarm.ng.managed': 'computer', 'swarm.ng.namespace': 'other' } },
  });
  await expect(manager.remove(id, name)).rejects.toMatchObject({ code: 409 });
  expect(request).not.toHaveBeenCalled();
});

it('checks all volume and network labels before deleting any owned container', async () => {
  const { manager, resources, request } = fixture();
  resources.set(`/containers/${manager.names.desktop(id)}/json`, {
    Id: 'owned',
    Config: { Labels: manager.names.labels(id, 'desktop', name) },
  });
  resources.set(`/volumes/${manager.names.volume(id, 'home')}`, {
    Name: manager.names.volume(id, 'home'),
    Labels: { 'swarm.ng.namespace': 'other' },
  });
  await expect(manager.remove(id, name)).rejects.toMatchObject({ code: 409 });
  expect(request).not.toHaveBeenCalled();
});

it('refuses a foreign media relay before deleting a computer or either volume', async () => {
  const { manager, resources, request } = fixture();
  resources.set(`/containers/${manager.names.desktop(id)}/json`, {
    Id: 'owned',
    Config: { Labels: manager.names.labels(id, 'desktop', name) },
  });
  resources.set(`/containers/${manager.names.media(id)}/json`, {
    Id: 'foreign-media',
    Config: { Labels: { 'swarm.ng.namespace': 'other' } },
  });
  await expect(manager.remove(id, name)).rejects.toMatchObject({ code: 409 });
  expect(request).not.toHaveBeenCalled();
});

it('rejects a media bridge with a host gateway before attaching any relay', async () => {
  const { manager, resources, request } = fixture();
  existingRunning(manager, resources);
  resources.set(`/networks/${manager.names.mediaNetwork}`, {
    Id: 'unsafe',
    Driver: 'bridge',
    Internal: false,
    EnableIPv6: false,
    Labels: { 'com.docker.compose.project': manager.names.namespace },
    Options: { 'com.docker.network.bridge.gateway_mode_ipv4': 'isolated' },
  });
  await expect(manager.create(id, name)).rejects.toMatchObject({ code: 503 });
  expect(request).not.toHaveBeenCalled();
});

it('never starts an owned relay whose target changed to another address', async () => {
  const { manager, resources, request } = fixture();
  existingRunning(manager, resources);
  resources.set(`/networks/${manager.names.mediaNetwork}`, {
    Id: 'media',
    Driver: 'bridge',
    Internal: true,
    EnableIPv6: false,
    Labels: { 'com.docker.compose.project': manager.names.namespace },
    Options: { 'com.docker.network.bridge.gateway_mode_ipv4': 'isolated' },
    IPAM: { Config: [{ Subnet: '172.25.7.0/24', Gateway: '' }] },
  });
  resources.set(`/containers/${manager.names.media(id)}/json`, {
    Id: 'relay',
    State: { Running: false },
    Config: {
      Labels: manager.names.labels(id, 'media', name),
      Env: ['COMPUTER_PRIVATE_IP=172.25.10.99', 'COMPUTER_MEDIA_SUBNET=172.25.7.0/24'],
    },
    NetworkSettings: {
      Networks: {
        [manager.names.mediaNetwork]: { IPAddress: '172.25.7.3', DNSNames: [manager.names.mediaAlias(id)] },
        [manager.names.privateNetwork(id)]: { IPAddress: '172.25.10.3' },
      },
    },
  });
  await expect(manager.create(id, name)).rejects.toMatchObject({ code: 409 });
  expect(request).not.toHaveBeenCalled();
});

it('stops a running owned desktop on controller restart if its GPU grant was revoked', async () => {
  const { manager, resources, request, docker } = fixture();
  existingRunning(manager, resources);
  const desktop = resources.get(`/containers/${manager.names.desktop(id)}/json`) as { HostConfig?: unknown };
  desktop.HostConfig = {
    Devices: [{ PathOnHost: '/dev/dri/renderD128', PathInContainer: '/dev/dri/renderD128', CgroupPermissions: 'rwm' }],
  };
  const network = resources.get(`/networks/${manager.names.privateNetwork(id)}`) as { IPAM?: unknown };
  network.IPAM = { Config: [{ Subnet: '172.25.10.0/24' }] };
  vi.mocked(docker.json).mockResolvedValue([
    { Id: 'desktop', State: 'running', Labels: manager.names.labels(id, 'desktop', name) },
  ]);
  await manager.resume();
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith('POST', '/containers/desktop/stop?t=5');
});

it('does not wipe a stopped computer or its data on a retried create', async () => {
  const { manager, resources, request } = fixture();
  resources.set(`/containers/${manager.names.desktop(id)}/json`, {
    Id: 'stopped',
    State: { Running: false },
    Config: { Labels: manager.names.labels(id, 'desktop', name) },
  });
  await expect(manager.create(id, name)).rejects.toMatchObject({ code: 409 });
  expect(request).not.toHaveBeenCalled();
});

it('executes only one bounded pointer click as agent in the selected owned running computer', async () => {
  const { manager, resources, execute } = fixture();
  const path = `/containers/${manager.names.desktop(id)}/json`;
  resources.set(path, { State: { Running: true }, Config: { Labels: manager.names.labels(id, 'desktop', name) } });
  for (const [x, y] of [
    [-0.01, 0.5],
    [0.5, Infinity],
    [0.5, 1.1],
  ]) {
    await expect(manager.pointer(id, x, y)).rejects.toMatchObject({ code: 400 });
  }
  expect(execute).not.toHaveBeenCalled();
  await manager.pointer(id, 0.5, 0.3);
  expect(execute).toHaveBeenCalledWith(
    manager.names.desktop(id),
    ['/opt/swarm/desktop-input.sh', '0.5', '0.3'],
    'agent',
    10_000,
  );
  resources.set(path, { State: { Running: true }, Config: { Labels: { 'swarm.ng.namespace': 'foreign' } } });
  await expect(manager.pointer(id, 0.5, 0.3)).rejects.toMatchObject({ code: 409 });
  expect(execute).toHaveBeenCalledTimes(1);
});

it('keeps full consent frames separate from the small grid JPEG cache', async () => {
  const { manager, resources, execute } = fixture();
  resources.set(`/containers/${manager.names.desktop(id)}/json`, {
    State: { Running: true },
    Config: { Labels: manager.names.labels(id, 'desktop', name) },
  });
  execute.mockResolvedValue(Buffer.from(Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')));
  expect(await manager.preview(id)).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  expect(await manager.preview(id, true)).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  expect(execute).toHaveBeenNthCalledWith(
    1,
    manager.names.desktop(id),
    ['/opt/swarm/render-preview.sh'],
    'agent',
    16_000,
  );
  expect(execute).toHaveBeenNthCalledWith(
    2,
    manager.names.desktop(id),
    ['/opt/swarm/render-preview.sh', '--full'],
    'agent',
    16_000,
  );
});

it('refreshes grid thumbnails at the 500 ms card cadence but retains the full-preview cache', async () => {
  const { manager, resources, execute } = fixture();
  resources.set(`/containers/${manager.names.desktop(id)}/json`, {
    State: { Running: true },
    Config: { Labels: manager.names.labels(id, 'desktop', name) },
  });
  let sequence = 0;
  execute.mockImplementation(async () =>
    Buffer.from(Buffer.from([0xff, 0xd8, ++sequence, 0xff, 0xd9]).toString('base64')),
  );
  let now = 1_000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  try {
    const firstThumb = await manager.preview(id);
    const firstFull = await manager.preview(id, true);
    now += 300;
    expect(await manager.preview(id)).toEqual(firstThumb);
    now += 200; // one card poll after the first image
    expect(await manager.preview(id)).not.toEqual(firstThumb);
    expect(await manager.preview(id, true)).toEqual(firstFull);
    expect(execute).toHaveBeenCalledTimes(3);
  } finally {
    clock.mockRestore();
  }
});

it('detects and caches Docker host capacity for per-computer creation choices', async () => {
  const { manager, docker } = fixture('', 'America/Toronto');
  vi.mocked(docker.json).mockResolvedValue({ NCPU: 16, MemTotal: 28 * 1024 ** 3 });
  expect(await manager.limits()).toMatchObject({
    cpuCores: { max: 8, default: 2 },
    memoryGiB: { max: 16, default: 4 },
    timezoneDefault: 'America/Toronto',
  });
  expect(await manager.limits()).toMatchObject({ cpuCores: { max: 8 } });
  expect(docker.json).toHaveBeenCalledTimes(1);
  expect(docker.json).toHaveBeenCalledWith('GET', '/info', undefined, 256 * 1024);
});

it('refuses browser settings above host capacity before creating Docker resources', async () => {
  const { manager, docker, request } = fixture();
  vi.mocked(docker.json).mockResolvedValue({ NCPU: 2, MemTotal: 4 * 1024 ** 3 });
  await expect(
    manager.create(id, name, { cpuCores: 3, memoryGiB: 4, timezone: 'America/Toronto' }),
  ).rejects.toMatchObject({ code: 400 });
  expect(request).not.toHaveBeenCalled();
});

it('updates only an owned desktop’s CPU, RAM and equal swap live, without restarting it', async () => {
  const { manager, resources, request, docker } = fixture();
  existingRunning(manager, resources);
  vi.mocked(docker.json).mockResolvedValue({ NCPU: 16, MemTotal: 28 * 1024 ** 3 });
  await manager.updateResources(id, name, { cpuCores: 2, memoryGiB: 6 });
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith('POST', '/containers/desktop/update', {
    NanoCpus: 2_000_000_000,
    Memory: 6 * 1024 ** 3,
    MemorySwap: 12 * 1024 ** 3,
  });
  const desktop = resources.get(`/containers/${manager.names.desktop(id)}/json`) as {
    Config: { Labels: Record<string, string> };
  };
  desktop.Config.Labels['swarm.ng.namespace'] = 'foreign';
  await expect(manager.updateResources(id, name, { cpuCores: 2, memoryGiB: 6 })).rejects.toMatchObject({ code: 409 });
  expect(request).toHaveBeenCalledTimes(1);
});

it('never replaces a running or foreign desktop for a timezone edit', async () => {
  const { manager, resources, request, docker } = fixture();
  existingRunning(manager, resources);
  vi.mocked(docker.json).mockResolvedValue({ NCPU: 16, MemTotal: 28 * 1024 ** 3 });
  const settings = { cpuCores: 2, memoryGiB: 6, timezone: 'Etc/UTC' };
  await expect(manager.replaceStopped(id, name, settings)).rejects.toMatchObject({
    code: 409,
    message: expect.stringContaining('Power off'),
  });
  const desktop = resources.get(`/containers/${manager.names.desktop(id)}/json`) as {
    State: { Running: boolean };
    Config: { Labels: Record<string, string> };
  };
  desktop.State.Running = false;
  desktop.Config.Labels['swarm.ng.namespace'] = 'foreign';
  await expect(manager.replaceStopped(id, name, settings)).rejects.toMatchObject({ code: 409 });
  expect(request).not.toHaveBeenCalled();
});

it('replaces a stopped owned desktop with new TZ/env while preserving both named volumes and not starting it', async () => {
  const { manager, resources, request, canonical, previous } = stoppedReplacementFixture();
  await manager.replaceStopped(id, name, { cpuCores: 2, memoryGiB: 6, timezone: 'Etc/UTC' });
  const replacement = resources.get(`/containers/${canonical}/json`) as Record<string, any>;
  expect(replacement.Id).toBe('new-desktop');
  expect(replacement.State.Running).toBe(false);
  expect(replacement.Config.Env).toContain('TZ=Etc/UTC');
  expect(replacement.HostConfig).toMatchObject({
    NanoCpus: 2_000_000_000,
    Memory: 6 * 1024 ** 3,
    MemorySwap: 12 * 1024 ** 3,
  });
  expect(resources.has(`/containers/${previous}/json`)).toBe(false);
  for (const role of ['keep', 'cache'] as const)
    expect(resources.has(`/volumes/${manager.names.volume(id, role)}`)).toBe(true);
  expect(request.mock.calls.some(call => String(call[1]).includes('/start'))).toBe(false);
  expect(request.mock.calls.some(call => String(call[1]).startsWith('/volumes/') && call[0] === 'DELETE')).toBe(false);
});

it('keeps a computer’s Keep/Cache mounts on replacement, and can change its kept paths or move it to the current image', async () => {
  const { manager, resources, canonical, docker } = stoppedReplacementFixture();
  resources.set(`/images/${encodeURIComponent('agent-swarm-default:stage2')}/json`, { Config: { Labels: {} } });
  // Carrying newly kept paths over is covered in storage.test.ts.
  const carried: string[] = [];
  vi.spyOn(
    manager as unknown as { carryOver: (id: string, path: string) => Promise<void> },
    'carryOver',
  ).mockImplementation(async (_id, path) => void carried.push(path));
  await manager.replaceStopped(
    id,
    name,
    { cpuCores: 2, memoryGiB: 6, timezone: 'Etc/UTC' },
    { keptPaths: ['/var/lib/postgresql', '/etc/postgresql'], image: 'current' },
  );
  const replacement = resources.get(`/containers/${canonical}/json`) as Record<string, any>;
  expect(replacement.HostConfig.Mounts).toEqual(
    (['keep', 'cache'] as const).map(role => ({
      Type: 'volume',
      Source: manager.names.volume(id, role),
      Target: `/${role}`,
    })),
  );
  // The home folder is always kept.
  expect(replacement.Config.Env).toContain('COMPUTER_KEPT_PATHS=/home/agent:/var/lib/postgresql:/etc/postgresql');
  expect(carried).toEqual(['/var/lib/postgresql', '/etc/postgresql']);
  const create = vi.mocked(docker.json).mock.calls.find(call => String(call[1]).startsWith('/containers/create?name='));
  expect((create?.[2] as { Image: string }).Image).toBe('agent-swarm-default:stage2');
  await expect(
    manager.replaceStopped(id, name, { cpuCores: 2, memoryGiB: 6, timezone: 'Etc/UTC' }, { keptPaths: ['/etc'] }),
  ).rejects.toThrow('cannot be kept');
});

it('restores the old stopped desktop if promotion of the replacement fails', async () => {
  const { manager, resources, request, canonical, next, previous, failRename } = stoppedReplacementFixture();
  failRename();
  await expect(manager.replaceStopped(id, name, { cpuCores: 2, memoryGiB: 6, timezone: 'Etc/UTC' })).rejects.toThrow(
    'simulated rename failure',
  );
  expect((resources.get(`/containers/${canonical}/json`) as { Id: string }).Id).toBe('old-desktop');
  expect(resources.has(`/containers/${next}/json`)).toBe(false);
  expect(resources.has(`/containers/${previous}/json`)).toBe(false);
  for (const role of ['keep', 'cache'] as const)
    expect(resources.has(`/volumes/${manager.names.volume(id, role)}`)).toBe(true);
  expect(request.mock.calls.some(call => call[0] === 'DELETE' && String(call[1]).startsWith('/volumes/'))).toBe(false);
});

it('keeps the new desktop if Docker deleted the old one but lost the DELETE response', async () => {
  const { manager, resources, canonical, previous, loseDeleteResponse } = stoppedReplacementFixture();
  loseDeleteResponse();
  await manager.replaceStopped(id, name, { cpuCores: 2, memoryGiB: 6, timezone: 'Etc/UTC' });
  expect((resources.get(`/containers/${canonical}/json`) as { Id: string }).Id).toBe('new-desktop');
  expect(resources.has(`/containers/${previous}/json`)).toBe(false);
});

it('rejects unbounded or fractional operator CPU quotas before creating Docker resources', () => {
  for (const limit of [0, 1.5, 9, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(
      () => new ComputerManager({} as DockerApi, 'swarm-ng-test', '{}', undefined, undefined, undefined, '', limit),
    ).toThrow('CPU limit');
  }
  expect(
    () => new ComputerManager({} as DockerApi, 'swarm-ng-test', '{}', undefined, undefined, undefined, '', 4),
  ).not.toThrow();
});

it('rejects operator timezones that are not a plain IANA zone name', () => {
  const make = (timezone: string) => () =>
    new ComputerManager({} as DockerApi, 'swarm-ng-test', '{}', undefined, undefined, undefined, '', 2, timezone);
  for (const bad of [
    '../etc/passwd',
    '/etc/localtime',
    'America/../..',
    'America/Toronto;reboot',
    'Not A Zone',
    'America//Toronto',
    '.',
    '..',
  ]) {
    expect(make(bad)).toThrow('timezone');
  }
  // Absent means "leave the image default"; valid zones must not throw.
  for (const good of ['', 'America/Toronto', 'Etc/UTC', 'Etc/GMT+5', 'America/Argentina/Buenos_Aires']) {
    expect(make(good)).not.toThrow();
  }
});

it('derives a valid guest hostname from the computer name', () => {
  // The owner reads this in the guest prompt: agent@workspace-ngclzr, not a
  // Docker container ID.
  expect(computerHostname('Workspace-NGCLZR', id)).toBe('workspace-ngclzr');
  expect(computerHostname('Design machine', id)).toBe('design-machine');
  expect(computerHostname('  Lots   of    spaces  ', id)).toBe('lots-of-spaces');
  expect(computerHostname('Desk_prime.v2', id)).toBe('desk-prime-v2');
  // Undecodable-as-a-hostname input must still yield something usable.
  expect(computerHostname('☕', id)).toBe(`computer-${id.slice(0, 8)}`);
  expect(computerHostname('', id)).toBe(`computer-${id.slice(0, 8)}`);
  // RFC 1123 shape: lowercase labels, no leading/trailing hyphen, <=63 chars.
  const long = computerHostname('a'.repeat(40) + '-' + 'b'.repeat(40), id);
  expect(long.length).toBeLessThanOrEqual(63);
  expect(long).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
  for (const label of long.split('-')) expect(label.length).toBeLessThanOrEqual(63);
  expect(computerHostname('-leading and trailing-', id)).toBe('leading-and-trailing');
});

it('puts the derived hostname and every grant in one desktop create body', () => {
  const input = {
    image: 'agent-swarm-default:av1-xorg120',
    labels: { role: 'desktop' },
    env: desktopEnvironment(id, '172.25.10.1', '/dev/dri/renderD128', 'America/Toronto'),
    hostname: computerHostname('Workspace-NGCLZR', id),
    privateNetwork: 'swarm-ng-test-computer-' + id + '-private',
    seccomp: '{"defaultAction":"SCMP_ACT_ERRNO"}',
    renderDevice: '/dev/dri/renderD128',
    cpuLimit: 4,
    memoryGiB: 6,
    mounts: [
      { Type: 'volume' as const, Source: 'swarm-ng-test-computer-' + id + '-keep', Target: '/keep' },
      { Type: 'bind' as const, Source: '/srv/cache/computers/' + id, Target: '/cache' },
    ],
  };
  const body = desktopCreateBody(input);
  // Must be top-level Config: inside HostConfig Docker ignores it silently.
  expect(body.Hostname).toBe('workspace-ngclzr');
  expect('Hostname' in body.HostConfig).toBe(false);
  // The isolation contract must survive the extraction unchanged.
  expect(body.HostConfig).toMatchObject({
    Runtime: 'sysbox-runc',
    CapDrop: ['ALL'],
    Init: true,
    NanoCpus: 4_000_000_000,
    Memory: 6 * 1024 ** 3,
    MemorySwap: 12 * 1024 ** 3,
    PidsLimit: 1024,
    RestartPolicy: { Name: 'no' },
    Dns: ['1.1.1.1'],
  });
  expect(body.User).toBe('root');
  expect(body.Cmd).toEqual(['/opt/swarm/start-computer.sh']);
  expect(body.HostConfig.Devices).toEqual([
    { PathOnHost: '/dev/dri/renderD128', PathInContainer: '/dev/dri/renderD128', CgroupPermissions: 'rwm' },
  ]);
  // Only the computer's Keep and Cache mounts; the guest binds kept paths from them at every start.
  expect(body.HostConfig.Mounts).toEqual(input.mounts);
  expect(body.HostConfig.SecurityOpt).toEqual(['seccomp={"defaultAction":"SCMP_ACT_ERRNO"}']);
  expect(body.Env).toContain('TZ=America/Toronto');
  // A computer without the GPU grant still gets a hostname.
  const plain = desktopCreateBody({ ...input, renderDevice: '', env: desktopEnvironment(id, '172.25.10.1', '', '') });
  expect(plain.Hostname).toBe('workspace-ngclzr');
  expect('Devices' in plain.HostConfig).toBe(false);
});

it('publishes the operator timezone only to the desktop container', () => {
  expect(desktopEnvironment(id, '172.25.10.1', '', 'America/Toronto')).toEqual([
    `COMPUTER_GATEWAY=172.25.10.1`,
    `COMPUTER_ID=${id}`,
    'TZ=America/Toronto',
    'COMPUTER_TIMEZONE=America/Toronto',
  ]);
  // Absent timezone keeps today's behaviour exactly: the image's own default.
  expect(desktopEnvironment(id, '172.25.10.1', '', '')).toEqual([`COMPUTER_GATEWAY=172.25.10.1`, `COMPUTER_ID=${id}`]);
  expect(desktopEnvironment(id, '172.25.10.1', '/dev/dri/renderD128', 'Etc/UTC')).toEqual([
    `COMPUTER_GATEWAY=172.25.10.1`,
    `COMPUTER_ID=${id}`,
    'COMPUTER_GPU_RENDER_DEVICE=/dev/dri/renderD128',
    'TZ=Etc/UTC',
    'COMPUTER_TIMEZONE=Etc/UTC',
  ]);
});

it('refuses invalid resource IDs and namespaces before calling Docker', async () => {
  const { manager, request } = fixture();
  await expect(manager.remove('../agent-swarm-v2', name)).rejects.toMatchObject({ code: 400 });
  expect(() => new ComputerManager({} as DockerApi, '../outside', '{}')).toThrow('namespace');
  expect(
    () =>
      new ComputerManager({} as DockerApi, 'swarm-ng-test', '{}', undefined, undefined, undefined, '/dev/dri/card0'),
  ).toThrow('render device');
  expect(
    () => new ComputerManager({} as DockerApi, 'swarm-ng-test', '{}', undefined, undefined, undefined, '/etc/shadow'),
  ).toThrow('render device');
  expect(request).not.toHaveBeenCalled();
});

it('stops only the owned desktop and its media relay, preserving gateway, volumes and record', async () => {
  const { manager, resources, request } = fixture();
  existingRunning(manager, resources);
  resources.set(`/containers/${manager.names.media(id)}/json`, {
    Id: 'relay',
    State: { Running: true },
    Config: { Labels: manager.names.labels(id, 'media', name) },
  });
  await manager.stop(id, name);
  const calls = request.mock.calls.map(call => `${call[0]} ${call[1]}`);
  expect(calls).toContain('POST /containers/relay/stop?t=5');
  expect(calls).toContain('POST /containers/desktop/stop?t=5');
  // The filtered egress gateway and both volumes must survive a power stop.
  expect(calls.some(call => call.includes('/containers/gateway/'))).toBe(false);
  expect(calls.some(call => call.includes('volumes/') && call.startsWith('DELETE'))).toBe(false);
  expect(calls.some(call => call.startsWith('DELETE'))).toBe(false);
});

it('always allows stopping but never starts a computer with a stale render grant', async () => {
  // Power-off is safe regardless of operator grants; power-on must not revive a
  // desktop with host-device access the current operator no longer grants.
  const stopped = fixture('/dev/dri/renderD129');
  existingRunning(stopped.manager, stopped.resources);
  await stopped.manager.stop(id, name);
  expect(stopped.request.mock.calls.map(call => `${call[0]} ${call[1]}`)).toContain(
    'POST /containers/desktop/stop?t=5',
  );
  const started = fixture('/dev/dri/renderD129');
  existingRunning(started.manager, started.resources);
  (
    started.resources.get(`/containers/${started.manager.names.desktop(id)}/json`) as { State: { Running: boolean } }
  ).State.Running = false;
  await expect(started.manager.start(id, name)).rejects.toMatchObject({ code: 409 });
  expect(started.request.mock.calls.filter(call => String(call[1]).includes('/start'))).toHaveLength(0);
});

it('starts a stopped computer through its filtered gateway before the desktop', async () => {
  const { manager, resources, request } = fixture();
  existingRunning(manager, resources);
  // Everything owned exists but is stopped.
  for (const role of ['desktop', 'egress'] as const) {
    const key =
      role === 'desktop'
        ? `/containers/${manager.names.desktop(id)}/json`
        : `/containers/${manager.names.gateway(id)}/json`;
    const container = resources.get(key) as { State: { Running: boolean } };
    container.State.Running = false;
  }
  // The private bridge must look like the real isolated one before a desktop
  // may reattach: bridge driver, internal, no IPv6, isolated gateway mode.
  // The shared filtered egress bridge is Compose-owned and must already exist.
  resources.set(`/networks/${manager.names.egressNetwork}`, {
    Id: 'egress',
    Labels: manager.names.labels(null, 'egress-network'),
    Driver: 'bridge',
    Internal: false,
    EnableIPv6: false,
    Options: {},
    IPAM: { Config: [] },
  });
  resources.set(`/networks/${manager.names.privateNetwork(id)}`, {
    Id: 'private',
    Labels: manager.names.labels(id, 'private-network'),
    Driver: 'bridge',
    Internal: true,
    EnableIPv6: false,
    Options: { 'com.docker.network.bridge.gateway_mode_ipv4': 'isolated' },
    IPAM: { Config: [{ Subnet: '172.25.10.0/24' }] },
  });
  await manager.start(id, name);
  const posts = request.mock.calls.filter(call => call[0] === 'POST').map(call => String(call[1]));
  // The gateway must be running before the desktop attaches to the bridge.
  expect(posts.indexOf('/containers/gateway/start')).toBeGreaterThanOrEqual(0);
  expect(posts.indexOf('/containers/desktop/start')).toBeGreaterThan(posts.indexOf('/containers/gateway/start'));
});

it('refuses power changes for an unknown, foreign or invalid computer before calling Docker', async () => {
  const { manager, resources, request } = fixture();
  existingRunning(manager, resources);
  // A well-formed ID with no owned desktop is a 404; a renamed computer is a
  // 409 ownership refusal; a malformed ID is rejected before any Docker call.
  await expect(manager.start('550e8400-e29b-41d4-a716-446655440000', name)).rejects.toMatchObject({ code: 404 });
  await expect(manager.stop(id, 'Other name')).rejects.toMatchObject({ code: 409 });
  await expect(manager.start('../escape', name)).rejects.toMatchObject({ code: 400 });
  await expect(manager.stop(id, 'x'.repeat(81))).rejects.toMatchObject({ code: 400 });
  expect(request.mock.calls.filter(call => call[0] === 'POST')).toHaveLength(0);
});

it('uses the enforced container quota, not the cgroup limit stats reports', async () => {
  const { manager, docker } = fixture();
  vi.mocked(docker.json).mockImplementation(async (_method: unknown, path: unknown) => {
    if (String(path).startsWith('/containers/json')) {
      return [{ Id: 'desktop', State: 'running', Labels: manager.names.labels(id, 'desktop', name) }];
    }
    if (String(path) === '/containers/desktop/json') {
      return {
        Id: 'desktop',
        State: { Running: true },
        Config: { Labels: manager.names.labels(id, 'desktop', name) },
        HostConfig: { Memory: 4_294_967_296, NanoCpus: 4_000_000_000 },
      };
    }
    if (String(path).includes('/stats?stream=false')) {
      return {
        cpu_stats: { cpu_usage: { total_usage: 2_000_000_000 }, system_cpu_usage: 20_000_000_000, online_cpus: 4 },
        precpu_stats: { cpu_usage: { total_usage: 1_000_000_000 }, system_cpu_usage: 10_000_000_000 },
        // Sysbox nests the desktop, so the stats payload reports the parent
        // cgroup's 28 GiB limit rather than the 4 GiB quota Docker enforces.
        memory_stats: { usage: 2_147_483_648, limit: 30_208_245_760, stats: { inactive_file: 104_857_600 } },
      };
    }
    return [];
  });
  const rows = await manager.observe();
  const row = rows.find(item => item.id === id);
  // 2 GiB used minus 100 MiB inactive file, against the enforced 4 GiB quota.
  expect(row).toMatchObject({
    status: 'running',
    memoryBytes: 2_042_626_048,
    memoryLimitBytes: 4_294_967_296,
    cpuCount: 4,
  });
  // Docker sums CPU across cores, so 40% of one core of four reads as 40 here.
  expect(row?.cpuPercent).toBe(40);
  // The quota is read once per container id, not on every 5s roster poll.
  const inspects = vi.mocked(docker.json).mock.calls.filter(call => String(call[1]) === '/containers/desktop/json');
  await manager.observe();
  expect(vi.mocked(docker.json).mock.calls.filter(call => String(call[1]) === '/containers/desktop/json')).toHaveLength(
    inspects.length,
  );
});

it('computer-use executes only the fixed bounded guest program against an owned immutable container ID', async () => {
  const { manager, resources, execute } = fixture();
  existingRunning(manager, resources);
  const input = { actions: [{ type: 'keyboard.type', text: '$(touch /host); "' }] };
  await manager.computerUseExec(id, 'validate', input);
  expect(execute).toHaveBeenCalledWith(
    'desktop',
    [
      '/usr/bin/timeout',
      '--signal=TERM',
      '--kill-after=2s',
      '18s',
      '/usr/bin/python3',
      '/opt/swarm/computer-use.py',
      'validate',
      JSON.stringify(input),
    ],
    'agent',
    23_000,
    3 * 1024 * 1024,
  );
});

it('core tools run only the fixed root guest supervisor against the owned immutable ID', async () => {
  const { manager, resources, execute } = fixture();
  existingRunning(manager, resources);
  const input = { kind: 'bash', command: '$(touch /host); "' };
  await manager.computerCoreExec(id, 'execute', input);
  expect(execute).toHaveBeenCalledWith(
    'desktop',
    [
      '/usr/bin/timeout',
      '--signal=TERM',
      '--kill-after=8s',
      '130s',
      '/usr/bin/python3',
      '-I',
      '/opt/swarm/computer-core.py',
      'execute',
      JSON.stringify(input),
    ],
    'root',
    145_000,
    3 * 1024 * 1024,
  );
});
it('core tools reject foreign ownership and admit stopped cancellation without executing a helper', async () => {
  const { manager, resources, execute } = fixture();
  const path = `/containers/${manager.names.desktop(id)}/json`;
  resources.set(path, { Id: 'foreign', State: { Running: true }, Config: { Labels: {} } });
  await expect(manager.computerCoreExec(id, 'execute', {})).rejects.toMatchObject({ code: 409 });
  resources.set(path, {
    Id: 'stopped',
    State: { Running: false },
    Config: { Labels: manager.names.labels(id, 'desktop') },
  });
  await expect(manager.computerCoreExec(id, 'execute', {})).rejects.toMatchObject({ code: 503 });
  expect(JSON.parse((await manager.computerCoreExec(id, 'cancel', {})).toString())).toEqual({ settled: true });
  expect(execute).not.toHaveBeenCalled();
});

it('computer-use rejects foreign and stopped desktops without input, and stopped cancellation is already settled', async () => {
  const { manager, resources, execute } = fixture();
  const path = `/containers/${manager.names.desktop(id)}/json`;
  resources.set(path, { Id: 'foreign', State: { Running: true }, Config: { Labels: {} } });
  await expect(manager.computerUseExec(id, 'capture', {})).rejects.toMatchObject({ code: 409 });
  await expect(manager.computerUseExec(id, 'cancel', {})).rejects.toMatchObject({ code: 409 });
  resources.set(path, {
    Id: 'stopped',
    State: { Running: false },
    Config: { Labels: manager.names.labels(id, 'desktop') },
  });
  await expect(manager.computerUseExec(id, 'execute', {})).rejects.toMatchObject({ code: 503 });
  expect(JSON.parse((await manager.computerUseExec(id, 'cancel', {})).toString())).toEqual({ settled: true });
  expect(execute).not.toHaveBeenCalled();
});

it('samples running computers concurrently so listing time does not grow per computer', async () => {
  const { manager, docker } = fixture();
  const ids = ['1', '2', '3', '4'].map(n => `4a18018a-4689-4fa5-86ca-4dc080d41f${n}${n}`);
  vi.mocked(docker.json).mockImplementation(async (_method: unknown, path: unknown) => {
    const p = String(path);
    if (p.startsWith('/containers/json'))
      return ids.map(value => ({
        Id: `c-${value}`,
        State: 'running',
        Labels: manager.names.labels(value, 'desktop', name),
      }));
    if (p.includes('/stats?stream=false')) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return {
        cpu_stats: { cpu_usage: { total_usage: 2 }, system_cpu_usage: 20, online_cpus: 1 },
        precpu_stats: { cpu_usage: { total_usage: 1 }, system_cpu_usage: 10 },
        memory_stats: { usage: 1024 },
      };
    }
    return { Id: 'x', HostConfig: { Memory: 4_294_967_296, NanoCpus: 2_000_000_000 } };
  });
  const started = Date.now();
  const rows = await manager.observe();
  expect(rows.map(row => row.id)).toEqual(ids); // order preserved
  expect(rows.every(row => row.cpuPercent === 10 && row.cpuCount === 2)).toBe(true);
  expect(Date.now() - started).toBeLessThan(900); // sequential sampling would take about 1200 ms
});

it("reports each computer's display server from its image label, falling back to the project's image tags", async () => {
  const { displayServerOf } = await import('./manager');
  expect(displayServerOf({ Image: 'agent-swarm-default:stage2', Labels: {} })).toBe('wayland');
  expect(displayServerOf({ Image: 'agent-swarm-default:http-jpeg', Labels: {} })).toBe('wayland');
  expect(displayServerOf({ Image: 'agent-swarm-default:h265-stage2', Labels: {} })).toBe('wayland');
  for (const image of [
    'agent-swarm-default:http-jpeg-x11',
    'agent-swarm-default:h265-xorg120',
    'agent-swarm-default:xorg120-120-candidate',
    'agent-swarm-default:h264-x11',
  ])
    expect(displayServerOf({ Image: image, Labels: {} }), image).toBe('x11');
  expect(displayServerOf({ Image: 'agent-swarm-default:whatever', Labels: { 'swarm.ng.display-server': 'x11' } })).toBe(
    'x11',
  ); // label wins
  expect(
    displayServerOf({ Image: 'agent-swarm-default:h265-xorg120', Labels: { 'swarm.ng.display-server': 'wayland' } }),
  ).toBe('wayland');
  expect(displayServerOf({ Labels: {} })).toBe('wayland');
});

it('refuses a new computer past the limit the backend sends, before creating Docker resources', async () => {
  const { manager, docker, request } = fixture();
  const other = '11111111-2222-4333-8444-555555555555';
  vi.mocked(docker.json).mockImplementation(async (_method: string, path: string) =>
    path.startsWith('/containers/json')
      ? [{ Id: 'a', Names: ['/x'], Labels: manager.names.labels(other, 'desktop', 'Other') }]
      : { NCPU: 16, MemTotal: 34_359_738_368 },
  );
  await expect(manager.create(id, name, undefined, 1)).rejects.toMatchObject({
    code: 409,
    message: 'Computer limit reached.',
  });
  expect(request).not.toHaveBeenCalled();
});

it('reports host limits without a computer count', async () => {
  const { manager, docker } = fixture();
  vi.mocked(docker.json).mockImplementation(async () => ({ NCPU: 16, MemTotal: 34_359_738_368 }));
  expect(await manager.limits()).toMatchObject({ cpuCores: { max: 8 } });
  expect(await manager.limits()).not.toHaveProperty('maxComputers'); // the backend's Settings → Swarm owns the count
});

it('finds the display server from the inspected creation-time image when the list only reports an image ID', async () => {
  const { manager, docker } = fixture();
  vi.mocked(docker.json).mockImplementation(async (_method: unknown, path: unknown) => {
    const p = String(path);
    if (p.startsWith('/containers/json'))
      return [
        {
          Id: 'x11-box',
          State: 'running',
          Image: 'sha256:aaaaaaaaaaaa',
          Labels: manager.names.labels(id, 'desktop', name),
        },
        {
          Id: 'wayland-box',
          State: 'running',
          Image: 'sha256:bbbbbbbbbbbb',
          Labels: manager.names.labels('5b29129a-5790-4fa5-86ca-4dc080d41fb4', 'desktop', 'Other'),
        },
        {
          Id: 'stopped-box',
          State: 'exited',
          Image: 'sha256:cccccccccccc',
          Labels: manager.names.labels('6c39239a-6890-4fa5-86ca-4dc080d41fb4', 'desktop', 'Off'),
        },
      ];
    if (p === '/containers/x11-box/json')
      return {
        HostConfig: { Memory: 1, NanoCpus: 1e9 },
        Config: { Image: 'agent-swarm-default:h265-xorg120', Labels: {} },
      };
    if (p === '/containers/wayland-box/json')
      return { HostConfig: {}, Config: { Image: 'agent-swarm-default:stage2', Labels: {} } };
    if (p === '/containers/stopped-box/json')
      return {
        HostConfig: {},
        Config: { Image: 'agent-swarm-default:whatever', Labels: { 'swarm.ng.display-server': 'x11' } },
      };
    return { cpu_stats: {}, precpu_stats: {}, memory_stats: {} };
  });
  const rows = await manager.observe();
  expect(rows.map(row => row.displayServer)).toEqual(['x11', 'wayland', 'x11']);
});
