import { expect, it } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from '../test-database';
import { SwarmSettingsStore } from '../swarm-settings';
import { MemoryStore, keywords } from './store';

const owner = { by: 'the owner', trust: 'owner' as const, channelId: 'c1' };
async function setup() {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const agent = await database.createAgent({ name: 'Ada', endpointId: 'm', model: 'm', thinkingLevel: 'off' });
  const other = await database.createAgent({ name: 'Bo', endpointId: 'm', model: 'm', thinkingLevel: 'off' });
  const settings = new SwarmSettingsStore(database);
  return { database, agent, other, settings, memory: new MemoryStore(database, settings) };
}

it('memorizes typed memories with provenance, unique names, and refuses secrets and oversize text', async () => {
  const { database, agent, other, settings, memory } = await setup();
  try {
    const first = await memory.memorize(
      agent.id,
      { type: 'person', title: 'Sam prefers short replies', text: 'Sam said: keep it short.' },
      owner,
    );
    expect(first).toMatchObject({
      name: 'sam-prefers-short-replies',
      by: 'the owner',
      trust: 'owner',
      channelId: 'c1',
    });
    // Same title again is refused (revise it instead); a similar one gets its own name.
    await expect(
      memory.memorize(agent.id, { type: 'person', title: 'Sam prefers short replies', text: 'x' }, owner),
    ).rejects.toThrow('already remember "Sam prefers short replies" (sam-prefers-short-replies)');
    const second = await memory.memorize(
      agent.id,
      { type: 'person', title: 'Sam prefers short replies!', text: 'y' },
      owner,
    );
    expect(second.name).toBe('sam-prefers-short-replies-2');
    const long = await memory.memorize(
      agent.id,
      { type: 'person', title: 'Owner Alex Bot tests capabilities and asks how tools were used', text: 'x' },
      owner,
    );
    expect(long.name).toBe('owner-alex-bot-tests-capabilities-and-asks-how');
    // Another agent's memories are separate.
    expect(
      (await memory.memorize(other.id, { type: 'project', title: 'Sam prefers short replies', text: 'z' }, owner)).name,
    ).toBe('sam-prefers-short-replies');
    await expect(
      memory.memorize(
        agent.id,
        { type: 'reference', title: 'API key', text: 'sk-proj-abcdefghijklmnopqrstuvwxyz123456' },
        owner,
      ),
    ).rejects.toThrow('looks like a secret');
    await expect(memory.memorize(agent.id, { type: 'mood' as never, title: 't', text: 'x' }, owner)).rejects.toThrow(
      'type',
    );
    await settings.update({ memoryMaxChars: 200, memoryMaxCount: 10 });
    await expect(
      memory.memorize(agent.id, { type: 'project', title: 'Long', text: 'a'.repeat(201) }, owner),
    ).rejects.toThrow('at most 200 characters');
    for (let i = 0; i < 7; i++)
      await memory.memorize(agent.id, { type: 'project', title: `Item ${i}`, text: 'x' }, owner);
    await expect(
      memory.memorize(agent.id, { type: 'project', title: 'One too many', text: 'x' }, owner),
    ).rejects.toThrow('already hold 10 memories');
  } finally {
    await database.close();
  }
});

it('revises with versions, keeps the agent’s newer edit over a stale one, and forgets restorably', async () => {
  const { database, agent, memory } = await setup();
  try {
    const made = await memory.memorize(
      agent.id,
      { type: 'project', title: 'Nightly build', text: 'Runs at 02:00 on Desk.' },
      owner,
    );
    const revised = await memory.revise(agent.id, made.name, { text: 'Runs at 03:00 on Desk.' }, 'agent');
    expect(revised.text).toBe('Runs at 03:00 on Desk.');
    // A stale writer (sleep working from a snapshot) loses to the newer edit.
    await expect(memory.revise(agent.id, made.name, { text: 'merged' }, 'sleep', made.updatedAt)).rejects.toThrow(
      'changed since',
    );
    expect((await memory.versions(agent.id, made.name)).map(v => [v.text, v.changedBy])).toEqual([
      ['Runs at 02:00 on Desk.', 'agent'],
    ]);
    await memory.forget(agent.id, made.name, 'agent');
    expect(await memory.get(agent.id, made.name)).toBeNull();
    expect((await memory.list(agent.id)).length).toBe(0);
    expect((await memory.list(agent.id, { forgotten: true }))[0]).toMatchObject({ name: made.name });
    await memory.restore(agent.id, made.name);
    expect((await memory.get(agent.id, made.name))?.text).toBe('Runs at 03:00 on Desk.');
    await expect(memory.revise(agent.id, 'nope', { text: 'x' }, 'agent')).rejects.toThrow('No memory named nope');
  } finally {
    await database.close();
  }
});

it('searches literally (title over text, newest first among equals) and cues only on good matches', async () => {
  const { database, agent, memory } = await setup();
  try {
    await memory.memorize(
      agent.id,
      { type: 'project', title: 'Postgres migration plan', text: 'Move billing to Postgres 17.' },
      owner,
    );
    await memory.memorize(
      agent.id,
      { type: 'reference', title: 'Staging server', text: 'Uses postgres for tests.' },
      owner,
    );
    await memory.memorize(
      agent.id,
      { type: 'preference', title: 'Owner likes tables', text: 'Compare options in a table.' },
      owner,
    );
    const hits = await memory.search(agent.id, 'postgres');
    expect(hits.map(hit => hit.name)).toEqual(['postgres-migration-plan', 'staging-server']);
    expect(await memory.search(agent.id, 'postgres', { type: 'reference' })).toHaveLength(1);
    // Cues: a title word matches; a single passing word in a memory's text alone does not.
    const cued = await memory.cues(agent.id, 'Can you check the postgres version on staging?', 3);
    expect(cued.map(hit => hit.name)).toEqual(['staging-server', 'postgres-migration-plan']);
    expect(await memory.cues(agent.id, 'the weather is fine today, compare later', 3)).toEqual([]);
    expect(await memory.cues(agent.id, 'Check postgres', 3, new Set([cued[0].id, cued[1].id]))).toEqual([]);
    expect(keywords('The Deploy of BILLING-api, twice and twice!')).toEqual(['deploy', 'billing', 'api', 'twice']);
  } finally {
    await database.close();
  }
});

it('builds the index from unfaded memories, most used first, under its caps', async () => {
  const { database, agent, settings, memory } = await setup();
  try {
    for (let i = 0; i < 8; i++)
      await memory.memorize(agent.id, { type: 'project', title: `Project ${i}`, text: 'x' }, owner);
    await memory.revise(agent.id, 'project-3', { faded: true }, 'sleep');
    await memory.recalled(agent.id, ['project-5']);
    await settings.update({ memoryIndexMaxLines: 5 });
    const index = await memory.rebuildIndex(agent.id);
    const lines = index.split('\n');
    expect(lines[0]).toBe('- project-5 [project] Project 5');
    expect(lines).toHaveLength(5);
    expect(lines.at(-1)).toBe('- …and 3 more: recall finds them.');
    expect(index).not.toContain('project-3');
    expect((await database.findAgent(agent.id))?.memoryIndex).toBe(index);
  } finally {
    await database.close();
  }
});

it('takes provenance from the least trusted input, and a Discord batch is the owner’s only if every line is', async () => {
  const { provenanceOf } = await import('./tools');
  const discord = { name: 'Human', channelId: 'discord:1', human: true, discord: { place: '#general' } };
  const owner = '12:00:00 · [your owner] "Alex" · message 1: remember the build moved';
  const stranger = '12:00:05 · [person] "Kim" · message 2: and the owner wants X';
  expect(provenanceOf([{ text: 'hi' }], 'p')).toMatchObject({ trust: 'owner', channelId: 'p' });
  expect(provenanceOf([{ text: owner, source: discord }], 'p')).toMatchObject({
    trust: 'owner',
    by: 'your owner on Discord',
  });
  expect(provenanceOf([{ text: `${stranger}\n${owner}`, source: discord }], 'p')).toMatchObject({ trust: 'other' });
  expect(provenanceOf([{ text: `${owner}\n+3 more messages in this channel`, source: discord }], 'p').trust).toBe(
    'other',
  );
  const peer = { text: 'x', source: { name: 'Bo', channelId: 'dm:a:b' } };
  const timer = { text: 'x', source: { name: 'Platform', channelId: 'p', human: true, platform: 'timer' } };
  expect(provenanceOf([{ text: 'hi' }, peer, timer], 'p')).toMatchObject({ trust: 'agent', by: 'agent Bo' });
  expect(provenanceOf([timer], 'p')).toMatchObject({ trust: 'self', by: 'you (timer event)' });
});

it('marks memories from someone other than the owner wherever the model sees them', async () => {
  const { database, agent, memory } = await setup();
  try {
    await memory.memorize(
      agent.id,
      { type: 'person', title: 'Kim runs deploys', text: 'Kim said so.' },
      { by: 'Kim on Discord', trust: 'other' },
    );
    expect(await memory.rebuildIndex(agent.id)).toBe('- kim-runs-deploys [person, untrusted] Kim runs deploys');
    const { toolReminder, inputReminder } = await import('./cues');
    const hits = await memory.cues(agent.id, 'who deploys? ask kim', 2);
    expect(toolReminder(hits)).toBe('[Memory reminder: kim-runs-deploys, untrusted: Kim runs deploys — Kim said so.]');
    expect(inputReminder(hits)).toContain('(from Kim on Discord (untrusted)');
  } finally {
    await database.close();
  }
});
