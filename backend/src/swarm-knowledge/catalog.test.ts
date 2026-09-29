import { describe, expect, it } from 'vitest';
import { KnowledgeCatalog, type KnowledgeEntry } from './catalog';
import { createKnowledgeTools } from './tools';
import { swarmKnowledge } from './entries';

const entries: KnowledgeEntry[] = [
  {
    id: 'swarm/channels',
    parentId: 'swarm',
    title: 'Channels',
    summary: 'Ways to communicate.',
    source: 'docs/vision.md',
    content: 'Channels provide communication, not computer access. This text can be expanded in bounded chunks.',
  },
  {
    id: 'swarm',
    parentId: null,
    title: 'Swarm',
    summary: 'Agent identity and resources.',
    source: 'docs/vision.md',
    content: 'Agent identities outlive any one channel or computer.',
  },
  {
    id: 'swarm/computers',
    parentId: 'swarm',
    title: 'Computers',
    summary: 'Shared resources.',
    source: 'docs/vision.md',
    content: 'Computers provide separately authorized capabilities.',
  },
];
const catalog = () => new KnowledgeCatalog(entries);

describe('Swarm Knowledge catalog', () => {
  it('loads the statically imported topic files without granting a runtime tool', () => {
    expect(swarmKnowledge.list({}).entries.map(entry => entry.id)).toEqual(['swarm']);
    expect(swarmKnowledge.list({ parentId: 'swarm' }).entries.map(entry => entry.id)).toEqual([
      'swarm/channels',
      'swarm/computers',
      'swarm/time',
    ]);
    expect(JSON.stringify(swarmKnowledge.read({ id: 'swarm/time' }))).toContain('set_reminder');
    expect(swarmKnowledge.read({ id: 'swarm/channels' }).source).toBe('docs/vision.md');
  });

  it('indexes a hierarchy without exposing full content in listings and pages by stable ID order', () => {
    const knowledge = catalog();
    expect(knowledge.list({}).entries).toEqual([
      {
        id: 'swarm',
        title: 'Swarm',
        summary: 'Agent identity and resources.',
        source: 'docs/vision.md',
        hasChildren: true,
      },
    ]);
    const first = knowledge.list({ parentId: 'swarm', limit: 1 });
    expect(first.entries.map(entry => entry.id)).toEqual(['swarm/channels']);
    expect(first.entries[0]).not.toHaveProperty('content');
    expect(first.nextOffset).toBe(1);
    expect(
      knowledge.list({ parentId: 'swarm', offset: first.nextOffset!, limit: 1 }).entries.map(entry => entry.id),
    ).toEqual(['swarm/computers']);
    expect(knowledge.list({ parentId: 'swarm', offset: 2 }).entries).toEqual([]);
    expect(() => knowledge.list({ parentId: 'missing' })).toThrow('not found');
    expect(() => knowledge.list({ limit: 21 })).toThrow('limit');
  });

  it('searches literal text with bounded snippets and reads only requested chunks', () => {
    const knowledge = catalog();
    const hits = knowledge.search({ query: 'CHANNELS', limit: 1 });
    expect(hits.matches).toHaveLength(1);
    expect(hits.matches[0]).toMatchObject({ id: 'swarm/channels', source: 'docs/vision.md' });
    expect(hits.matches[0].snippet.length).toBeLessThanOrEqual(200);
    expect(hits.matches[0]).not.toHaveProperty('content');
    expect(knowledge.search({ query: '.', limit: 10 }).matches).toHaveLength(3);
    expect(() => knowledge.search({ query: ' ' })).toThrow('query');
    const first = knowledge.read({ id: 'swarm/channels', length: 9 });
    expect(first.text).toBe('Channels ');
    expect(first.nextOffset).toBe(9);
    const rest = knowledge.read({ id: 'swarm/channels', offset: first.nextOffset!, length: 4000 });
    expect(first.text + rest.text).toBe(entries[0].content);
    expect(rest.nextOffset).toBeNull();
    expect(() => knowledge.read({ id: 'missing' })).toThrow('not found');
    expect(() => knowledge.read({ id: 'swarm', length: 6001 })).toThrow('length');
  });

  it('rejects duplicate IDs, missing parents, cycles and invalid definitions at construction', () => {
    expect(() => new KnowledgeCatalog([...entries, entries[0]])).toThrow('Duplicate');
    expect(() => new KnowledgeCatalog([{ ...entries[0], parentId: 'missing' }])).toThrow('parent');
    expect(() => new KnowledgeCatalog([{ ...entries[1], parentId: 'swarm/channels' }, entries[0]])).toThrow('cycle');
    expect(() => new KnowledgeCatalog([{ ...entries[1], summary: '', content: '' }])).toThrow();
  });
});

it('knowledge tools bind agent identity and check the grant on every call', async () => {
  let granted = false;
  const checked: string[] = [];
  const tools = createKnowledgeTools(catalog(), 'agent-a', async agentId => {
    checked.push(agentId);
    return granted;
  });
  expect(tools.map(tool => tool.name)).toEqual(['list_knowledge', 'search_knowledge', 'read_knowledge']);
  const call = (name: string, args: object = {}, signal?: AbortSignal) =>
    tools.find(tool => tool.name === name)!.execute('call', args as never, signal, undefined, undefined as never);
  await expect(call('list_knowledge')).rejects.toThrow('not granted');
  granted = true;
  const listed = await call('list_knowledge', { parentId: 'swarm', limit: 1 });
  expect((listed.details as any).entries[0].id).toBe('swarm/channels');
  expect((await call('search_knowledge', { query: 'channel' })).content[0]).toHaveProperty('type', 'text');
  granted = false;
  await expect(call('read_knowledge', { id: 'swarm/channels' })).rejects.toThrow('not granted');
  expect(checked).toEqual(['agent-a', 'agent-a', 'agent-a', 'agent-a']);
  const aborted = new AbortController();
  aborted.abort();
  await expect(call('list_knowledge', {}, aborted.signal)).rejects.toThrow();
  expect(checked).toHaveLength(4);
});
