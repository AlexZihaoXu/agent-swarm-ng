import { expect, it, vi } from 'vitest';
import { ComputerManager } from './manager';
import { DockerApi } from './docker-api';

const id = '4a18018a-4689-4fa5-86ca-4dc080d41fb4';
const name = 'Work computer';
function fixture() {
  const resources = new Map<string, unknown>();
  const request = vi.fn(async () => Buffer.alloc(0));
  const execute = vi.fn(async () => Buffer.alloc(0));
  const docker = { optional: async (path: string) => resources.get(path) ?? null, request, json: vi.fn(async () => []), exec: execute } as unknown as DockerApi;
  const manager = new ComputerManager(docker, 'swarm-ng-test', '{}');
  return { manager, resources, request, execute };
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

it('does not wipe a stopped computer or its data on a retried create', async () => {
  const { manager, resources, request } = fixture();
  resources.set(`/containers/${manager.names.desktop(id)}/json`, {
    Id: 'stopped', State: { Running: false }, Config: { Labels: manager.names.labels(id, 'desktop', name) },
  });
  await expect(manager.create(id, name)).rejects.toMatchObject({ code: 409 });
  expect(request).not.toHaveBeenCalled();
});

it('executes only one bounded pointer click as ubuntu in the selected owned running computer', async () => {
  const { manager, resources, execute } = fixture();
  const path = `/containers/${manager.names.desktop(id)}/json`;
  resources.set(path, { State: { Running: true }, Config: { Labels: manager.names.labels(id, 'desktop', name) } });
  for (const [x, y] of [[-0.01, 0.5], [0.5, Infinity], [0.5, 1.1]]) {
    await expect(manager.pointer(id, x, y)).rejects.toMatchObject({ code: 400 });
  }
  expect(execute).not.toHaveBeenCalled();
  await manager.pointer(id, 0.5, 0.3);
  expect(execute).toHaveBeenCalledWith(manager.names.desktop(id), ['/opt/swarm/desktop-input.sh', '0.5', '0.3'], 'ubuntu', 10_000);
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
  expect(execute).toHaveBeenNthCalledWith(1, manager.names.desktop(id), ['/opt/swarm/render-preview.sh'], 'ubuntu', 16_000);
  expect(execute).toHaveBeenNthCalledWith(2, manager.names.desktop(id), ['/opt/swarm/render-preview.sh', '--full'], 'ubuntu', 16_000);
});

it('refuses invalid resource IDs and namespaces before calling Docker', async () => {
  const { manager, request } = fixture();
  await expect(manager.remove('../agent-swarm-v2', name)).rejects.toMatchObject({ code: 400 });
  expect(() => new ComputerManager({} as DockerApi, '../outside', '{}')).toThrow('namespace');
  expect(request).not.toHaveBeenCalled();
});
