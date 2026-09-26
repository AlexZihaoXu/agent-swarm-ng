import { expect, it, vi } from 'vitest';
import { ComputerManager, computerHostname, desktopCreateBody, desktopEnvironment } from './manager';
import { DockerApi } from './docker-api';

const id = '4a18018a-4689-4fa5-86ca-4dc080d41fb4';
const name = 'Work computer';
function fixture(renderDevice = '', timezone = '') {
  const resources = new Map<string, unknown>();
  const request = vi.fn(async () => Buffer.alloc(0));
  const execute = vi.fn(async () => Buffer.alloc(0));
  const docker = { optional: async (path: string) => resources.get(path) ?? null, request, json: vi.fn(async () => []), exec: execute } as unknown as DockerApi;
  const manager = new ComputerManager(docker, 'swarm-ng-test', '{}', undefined, undefined, undefined, 4, renderDevice, 2, timezone);
  return { manager, resources, request, execute, docker };
}

function existingRunning(manager: ComputerManager, resources: Map<string, unknown>) {
  resources.set(`/containers/${manager.names.desktop(id)}/json`, {
    Id: 'desktop', State: { Running: true }, Config: { Labels: manager.names.labels(id, 'desktop', name) },
    NetworkSettings: { Networks: { [manager.names.privateNetwork(id)]: { IPAddress: '172.25.10.2' } } },
  });
  resources.set(`/containers/${manager.names.gateway(id)}/json`, {
    Id: 'gateway', State: { Running: true }, Config: { Labels: manager.names.labels(id, 'egress', name) },
  });
  resources.set(`/networks/${manager.names.privateNetwork(id)}`, {
    Id: 'private', Labels: manager.names.labels(id, 'private-network'),
  });
  for (const role of ['home', 'workspace'] as const) {
    resources.set(`/volumes/${manager.names.volume(id, role)}`, {
      Name: manager.names.volume(id, role), Labels: manager.names.labels(id, role),
    });
  }
}

it.each(['agent-swarm-default:stage2', 'agent-swarm-computer-egress:dev', 'agent-swarm-computer-media:stage2'])(
  'refuses a Compose-labelled managed image before creating resources: %s', async tainted => {
    const { manager, resources, request } = fixture();
    for (const image of ['agent-swarm-default:stage2', 'agent-swarm-computer-egress:dev', 'agent-swarm-computer-media:stage2']) {
      resources.set(`/images/${encodeURIComponent(image)}/json`, { Config: { Labels: image === tainted ? { 'com.docker.compose.project': 'disposable' } : {} } });
    }
    await expect(manager.create(id, name)).rejects.toMatchObject({ code: 503, message: expect.stringContaining('Compose') });
    expect(request).not.toHaveBeenCalled();
  },
);

it('uses a canonical DNS alias shorter than one label for isolated media relays', () => {
  const { manager } = fixture();
  expect(manager.names.mediaAlias(id)).toBe(`computer-${id}`);
  expect(manager.names.mediaAlias(id).length).toBeLessThan(63);
  expect(manager.names.mediaAlias(id)).not.toBe(manager.names.media(id));
});

it('does not remove a same-named foreign container or its volumes', async () => {
  const { manager, resources, request } = fixture();
  const path = `/containers/${manager.names.desktop(id)}/json`;
  resources.set(path, { Id: 'foreign', Config: { Labels: { 'swarm.ng.managed': 'computer', 'swarm.ng.namespace': 'other' } } });
  await expect(manager.remove(id, name)).rejects.toMatchObject({ code: 409 });
  expect(request).not.toHaveBeenCalled();
});

it('checks all volume and network labels before deleting any owned container', async () => {
  const { manager, resources, request } = fixture();
  resources.set(`/containers/${manager.names.desktop(id)}/json`, { Id: 'owned', Config: { Labels: manager.names.labels(id, 'desktop', name) } });
  resources.set(`/volumes/${manager.names.volume(id, 'home')}`, { Name: manager.names.volume(id, 'home'), Labels: { 'swarm.ng.namespace': 'other' } });
  await expect(manager.remove(id, name)).rejects.toMatchObject({ code: 409 });
  expect(request).not.toHaveBeenCalled();
});

it('refuses a foreign media relay before deleting a computer or either volume', async () => {
  const { manager, resources, request } = fixture();
  resources.set(`/containers/${manager.names.desktop(id)}/json`, {
    Id: 'owned', Config: { Labels: manager.names.labels(id, 'desktop', name) },
  });
  resources.set(`/containers/${manager.names.media(id)}/json`, {
    Id: 'foreign-media', Config: { Labels: { 'swarm.ng.namespace': 'other' } },
  });
  await expect(manager.remove(id, name)).rejects.toMatchObject({ code: 409 });
  expect(request).not.toHaveBeenCalled();
});

it('rejects a media bridge with a host gateway before attaching any relay', async () => {
  const { manager, resources, request } = fixture();
  existingRunning(manager, resources);
  resources.set(`/networks/${manager.names.mediaNetwork}`, {
    Id: 'unsafe', Driver: 'bridge', Internal: false, EnableIPv6: false,
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
    Id: 'media', Driver: 'bridge', Internal: true, EnableIPv6: false,
    Labels: { 'com.docker.compose.project': manager.names.namespace },
    Options: { 'com.docker.network.bridge.gateway_mode_ipv4': 'isolated' },
    IPAM: { Config: [{ Subnet: '172.25.7.0/24', Gateway: '' }] },
  });
  resources.set(`/containers/${manager.names.media(id)}/json`, {
    Id: 'relay', State: { Running: false },
    Config: { Labels: manager.names.labels(id, 'media', name), Env: ['COMPUTER_PRIVATE_IP=172.25.10.99', 'COMPUTER_MEDIA_SUBNET=172.25.7.0/24'] },
    NetworkSettings: { Networks: {
      [manager.names.mediaNetwork]: { IPAddress: '172.25.7.3', DNSNames: [manager.names.mediaAlias(id)] },
      [manager.names.privateNetwork(id)]: { IPAddress: '172.25.10.3' },
    } },
  });
  await expect(manager.create(id, name)).rejects.toMatchObject({ code: 409 });
  expect(request).not.toHaveBeenCalled();
});

it('stops a running owned desktop on controller restart if its GPU grant was revoked', async () => {
  const { manager, resources, request, docker } = fixture();
  existingRunning(manager, resources);
  const desktop = resources.get(`/containers/${manager.names.desktop(id)}/json`) as { HostConfig?: unknown };
  desktop.HostConfig = { Devices: [{ PathOnHost: '/dev/dri/renderD128', PathInContainer: '/dev/dri/renderD128', CgroupPermissions: 'rwm' }] };
  const network = resources.get(`/networks/${manager.names.privateNetwork(id)}`) as { IPAM?: unknown };
  network.IPAM = { Config: [{ Subnet: '172.25.10.0/24' }] };
  vi.mocked(docker.json).mockResolvedValue([{ Id: 'desktop', State: 'running', Labels: manager.names.labels(id, 'desktop', name) }]);
  await manager.resume();
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith('POST', '/containers/desktop/stop?t=5');
});

it('does not wipe a stopped computer or its data on a retried create', async () => {
  const { manager, resources, request } = fixture();
  resources.set(`/containers/${manager.names.desktop(id)}/json`, {
    Id: 'stopped', State: { Running: false }, Config: { Labels: manager.names.labels(id, 'desktop', name) },
  });
  await expect(manager.create(id, name)).rejects.toMatchObject({ code: 409 });
  expect(request).not.toHaveBeenCalled();
});

it('executes only one bounded pointer click as agent in the selected owned running computer', async () => {
  const { manager, resources, execute } = fixture();
  const path = `/containers/${manager.names.desktop(id)}/json`;
  resources.set(path, { State: { Running: true }, Config: { Labels: manager.names.labels(id, 'desktop', name) } });
  for (const [x, y] of [[-0.01, 0.5], [0.5, Infinity], [0.5, 1.1]]) {
    await expect(manager.pointer(id, x, y)).rejects.toMatchObject({ code: 400 });
  }
  expect(execute).not.toHaveBeenCalled();
  await manager.pointer(id, 0.5, 0.3);
  expect(execute).toHaveBeenCalledWith(manager.names.desktop(id), ['/opt/swarm/desktop-input.sh', '0.5', '0.3'], 'agent', 10_000);
  resources.set(path, { State: { Running: true }, Config: { Labels: { 'swarm.ng.namespace': 'foreign' } } });
  await expect(manager.pointer(id, 0.5, 0.3)).rejects.toMatchObject({ code: 409 });
  expect(execute).toHaveBeenCalledTimes(1);
});

it('keeps full consent frames separate from the small grid JPEG cache', async () => {
  const { manager, resources, execute } = fixture();
  resources.set(`/containers/${manager.names.desktop(id)}/json`, {
    State: { Running: true }, Config: { Labels: manager.names.labels(id, 'desktop', name) },
  });
  execute.mockResolvedValue(Buffer.from(Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')));
  expect(await manager.preview(id)).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  expect(await manager.preview(id, true)).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  expect(execute).toHaveBeenNthCalledWith(1, manager.names.desktop(id), ['/opt/swarm/render-preview.sh'], 'agent', 16_000);
  expect(execute).toHaveBeenNthCalledWith(2, manager.names.desktop(id), ['/opt/swarm/render-preview.sh', '--full'], 'agent', 16_000);
});

it('rejects unbounded or fractional operator CPU quotas before creating Docker resources', () => {
  for (const limit of [0, 1.5, 9, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => new ComputerManager({} as DockerApi, 'swarm-ng-test', '{}', undefined, undefined, undefined, 4, '', limit)).toThrow('CPU limit');
  }
  expect(() => new ComputerManager({} as DockerApi, 'swarm-ng-test', '{}', undefined, undefined, undefined, 4, '', 4)).not.toThrow();
});

it('rejects operator timezones that are not a plain IANA zone name', () => {
  const make = (timezone: string) => () => new ComputerManager({} as DockerApi, 'swarm-ng-test', '{}', undefined, undefined, undefined, 4, '', 2, timezone);
  for (const bad of ['../etc/passwd', '/etc/localtime', 'America/../..', 'America/Toronto;reboot', 'Not A Zone', 'America//Toronto', '.', '..']) {
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
    image: 'agent-swarm-default:av1-xorg120', labels: { role: 'desktop' },
    env: desktopEnvironment(id, '172.25.10.1', '/dev/dri/renderD128', 'America/Toronto'),
    hostname: computerHostname('Workspace-NGCLZR', id),
    privateNetwork: 'swarm-ng-test-computer-' + id + '-private', seccomp: '{"defaultAction":"SCMP_ACT_ERRNO"}',
    renderDevice: '/dev/dri/renderD128', cpuLimit: 4,
    homeVolume: 'swarm-ng-test-computer-' + id + '-home', workspaceVolume: 'swarm-ng-test-computer-' + id + '-workspace',
  };
  const body = desktopCreateBody(input);
  // Must be top-level Config: inside HostConfig Docker ignores it silently.
  expect(body.Hostname).toBe('workspace-ngclzr');
  expect('Hostname' in body.HostConfig).toBe(false);
  // The isolation contract must survive the extraction unchanged.
  expect(body.HostConfig).toMatchObject({
    Runtime: 'sysbox-runc', CapDrop: ['ALL'], Init: true,
    NanoCpus: 4_000_000_000, PidsLimit: 1024, RestartPolicy: { Name: 'no' }, Dns: ['1.1.1.1'],
  });
  expect(body.User).toBe('root');
  expect(body.Cmd).toEqual(['/opt/swarm/start-computer.sh']);
  expect(body.HostConfig.Devices).toEqual([{ PathOnHost: '/dev/dri/renderD128', PathInContainer: '/dev/dri/renderD128', CgroupPermissions: 'rwm' }]);
  expect(body.HostConfig.Mounts.map((mount: { Target: string }) => mount.Target)).toEqual(['/home/agent', '/workspace']);
  expect(body.HostConfig.SecurityOpt).toEqual(['seccomp={"defaultAction":"SCMP_ACT_ERRNO"}']);
  expect(body.Env).toContain('TZ=America/Toronto');
  // A computer without the GPU grant still gets a hostname.
  const plain = desktopCreateBody({ ...input, renderDevice: '', env: desktopEnvironment(id, '172.25.10.1', '', '') });
  expect(plain.Hostname).toBe('workspace-ngclzr');
  expect('Devices' in plain.HostConfig).toBe(false);
});




it('publishes the operator timezone only to the desktop container', () => {
  expect(desktopEnvironment(id, '172.25.10.1', '', 'America/Toronto')).toEqual([
    `COMPUTER_GATEWAY=172.25.10.1`, `COMPUTER_ID=${id}`, 'TZ=America/Toronto', 'COMPUTER_TIMEZONE=America/Toronto',
  ]);
  // Absent timezone keeps today's behaviour exactly: the image's own default.
  expect(desktopEnvironment(id, '172.25.10.1', '', '')).toEqual([`COMPUTER_GATEWAY=172.25.10.1`, `COMPUTER_ID=${id}`]);
  expect(desktopEnvironment(id, '172.25.10.1', '/dev/dri/renderD128', 'Etc/UTC')).toEqual([
    `COMPUTER_GATEWAY=172.25.10.1`, `COMPUTER_ID=${id}`, 'COMPUTER_GPU_RENDER_DEVICE=/dev/dri/renderD128', 'TZ=Etc/UTC', 'COMPUTER_TIMEZONE=Etc/UTC',
  ]);
});

it('refuses invalid resource IDs and namespaces before calling Docker', async () => {
  const { manager, request } = fixture();
  await expect(manager.remove('../agent-swarm-v2', name)).rejects.toMatchObject({ code: 400 });
  expect(() => new ComputerManager({} as DockerApi, '../outside', '{}')).toThrow('namespace');
  expect(() => new ComputerManager({} as DockerApi, 'swarm-ng-test', '{}', undefined, undefined, undefined, 4, '/dev/dri/card0')).toThrow('render device');
  expect(() => new ComputerManager({} as DockerApi, 'swarm-ng-test', '{}', undefined, undefined, undefined, 4, '/etc/shadow')).toThrow('render device');
  expect(request).not.toHaveBeenCalled();
});
