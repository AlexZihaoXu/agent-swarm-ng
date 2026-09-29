import { expect, it, vi } from 'vitest';
import type { PlatformStore } from '../platform-store';
import { SwarmKnowledgePlugin } from './plugin';

it('grants read-only knowledge tools to a server-bound agent and rechecks existence on every call', async () => {
  let exists = true;
  const store = { hasAgent: vi.fn(async (id: string) => exists && id === 'agent-a') } as unknown as PlatformStore;
  const plugin = new SwarmKnowledgePlugin(store);
  const tools = plugin.toolsFor('agent-a');
  expect(tools.map(tool => tool.name)).toEqual(['list_knowledge', 'search_knowledge', 'read_knowledge']);
  const call = (name: string, args: object = {}) =>
    tools.find(tool => tool.name === name)!.execute('call', args as never, undefined, undefined, undefined as never);
  expect(((await call('list_knowledge')).details as any).entries[0].id).toBe('concepts');
  exists = false;
  await expect(call('read_knowledge', { id: 'concepts' })).rejects.toThrow('not granted');
  expect(store.hasAgent).toHaveBeenCalledTimes(2);
  expect(store.hasAgent).toHaveBeenCalledWith('agent-a');
});
