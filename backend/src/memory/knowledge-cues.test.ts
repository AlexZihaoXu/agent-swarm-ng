import { expect, it } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from '../test-database';
import { SwarmSettingsStore } from '../swarm-settings';
import { swarmKnowledge } from '../swarm-knowledge/entries';
import { KnowledgeCatalog } from '../swarm-knowledge/catalog';
import { MemoryStore } from './store';
import { CueRecall, knowledgeReminder } from './cues';

it('matches curated cue phrases on word edges, most matches first', () => {
  const catalog = new KnowledgeCatalog([
    {
      id: 'a',
      parentId: null,
      title: 'A',
      summary: 'a',
      source: 's',
      content: 'c',
      cues: ['claude code', '"currentcommand":"claude"'],
    },
    { id: 'b', parentId: null, title: 'B', summary: 'b', source: 's', content: 'c', cues: ['claude'] },
  ]);
  expect(catalog.cued('Use Claude Code please').map(hit => hit.id)).toEqual(['a', 'b']);
  expect(catalog.cued('{"session":{"currentCommand":"claude"}}').map(hit => hit.id)).toEqual(['a', 'b']);
  expect(catalog.cued('claudette')).toEqual([]);
  expect(
    () =>
      new KnowledgeCatalog([
        { id: 'x', parentId: null, title: 'X', summary: 'x', source: 's', content: 'c', cues: ['Upper'] },
      ]),
  ).toThrow('Invalid knowledge cues');
});

it('points to one Knowledge entry at a time, cue phrases before a tool family, not again soon or after reading it', async () => {
  const db = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  try {
    const cues = new CueRecall(new MemoryStore(db, new SwarmSettingsStore(db)), swarmKnowledge);
    const agent = 'agent-1';
    const window = 30_000;
    // terminal_create starting Claude Code: the Claude Code entry, not the generic terminals one.
    const first = cues.knowledgeCue(
      agent,
      '{"name":"cc","command":"claude"} {"session":{"currentCommand":"claude"}}',
      window,
      'terminal_create',
    );
    expect(first?.id).toBe('practices/harnesses/claude-code');
    expect(knowledgeReminder(first!)).toMatch(
      /^\[Knowledge: practices\/harnesses\/claude-code \(Claude Code\): .+ read_knowledge\(\{id:"practices\/harnesses\/claude-code"\}\)/,
    );
    // Next terminal call: Claude Code was just shown, so the terminals entry comes up once.
    expect(cues.knowledgeCue(agent, '{"session":{"currentCommand":"claude"}}', window, 'terminal_view')?.id).toBe(
      'concepts/computers/terminals',
    );
    expect(cues.knowledgeCue(agent, '{"session":{"currentCommand":"claude"}}', window, 'terminal_view')).toBeNull();
    // After a third of the context it may come back; reading it postpones it again.
    cues.advance(agent, 11_000);
    cues.readKnowledge(agent, 'practices/harnesses/claude-code');
    expect(cues.knowledgeCue(agent, 'use claude code', window)).toBeNull();
    cues.advance(agent, 11_000);
    expect(cues.knowledgeCue(agent, 'use claude code', window)?.id).toBe('practices/harnesses/claude-code');
    // Everyday tools and plain chat bring nothing.
    expect(cues.knowledgeCue(agent, 'hello there', window, 'send_message')).toBeNull();
  } finally {
    await db.close();
  }
});
