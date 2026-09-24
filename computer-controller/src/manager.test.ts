import { expect, it, vi } from 'vitest';
import { ComputerManager } from './manager';
import { DockerApi } from './docker-api';

const id = '4a18018a-4689-4fa5-86ca-4dc080d41fb4';
const name = 'Work computer';
function fixture() {
  const resources = new Map<string, unknown>();
  const request = vi.fn(async () => Buffer.alloc(0));
  const docker = { optional: async (path: string) => resources.get(path) ?? null, request, json: vi.fn(async () => []), exec: vi.fn(async () => Buffer.alloc(0)) } as unknown as DockerApi;
  const manager = new ComputerManager(docker, 'swarm-ng-test', '{}');
  return { manager, resources, request };
}

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

it('does not wipe a stopped computer or its data on a retried create', async () => {
  const { manager, resources, request } = fixture();
  resources.set(`/containers/${manager.names.desktop(id)}/json`, {
    Id: 'stopped', State: { Running: false }, Config: { Labels: manager.names.labels(id, 'desktop', name) },
  });
  await expect(manager.create(id, name)).rejects.toMatchObject({ code: 409 });
  expect(request).not.toHaveBeenCalled();
});

it('refuses invalid resource IDs and namespaces before calling Docker', async () => {
  const { manager, request } = fixture();
  await expect(manager.remove('../agent-swarm-v2', name)).rejects.toMatchObject({ code: 400 });
  expect(() => new ComputerManager({} as DockerApi, '../outside', '{}')).toThrow('namespace');
  expect(request).not.toHaveBeenCalled();
});
