import { expect, it } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from '../test-database';
import { DeepStorage, entryText } from './deep';

const user = (id: string, channel: string, text: string, at: string) => ({
  type: 'message',
  id,
  timestamp: at,
  message: { role: 'user', content: [{ type: 'text', text: `[channel: ${channel}]\n${text}` }] },
});
const said = (id: string, text: string, at: string) => ({
  type: 'message',
  id,
  timestamp: at,
  message: {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'secret thoughts' },
      { type: 'text', text },
      { type: 'toolCall', name: 'send_message', arguments: { text: 'ok' } },
    ],
  },
});

it('finds archive entries word for word, newest first, only in channels still readable', async () => {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  try {
    const agent = await database.createAgent({ name: 'Ada', endpointId: 'm', model: 'm', thinkingLevel: 'off' });
    const entries = [
      user('a', 'private-1', 'The deploy key lives in the vault.', '2026-09-01T10:00:00Z'),
      said('b', 'Noted: deploy key in the vault.', '2026-09-01T10:00:05Z'),
      user('c', 'group:gone', 'Deploy secrets for group only.', '2026-09-02T10:00:00Z'),
      said('d', 'Deploy done for the group.', '2026-09-02T10:00:05Z'),
      user('e', 'private-1', 'Unrelated chat about lunch.', '2026-09-03T10:00:00Z'),
    ];
    await database.client.agentSession.create({
      data: { agentId: agent.id, sessionId: 's', header: '{}', entryCount: entries.length },
    });
    await database.client.agentSessionEntry.createMany({
      data: entries.map((entry, position) => ({
        agentId: agent.id,
        position,
        entryId: entry.id,
        parentId: position ? entries[position - 1].id : null,
        payload: JSON.stringify(entry),
      })),
    });
    const deep = new DeepStorage(database, async (_agent, channel) => channel === 'private-1');
    const found = await deep.search(agent.id, { query: 'deploy' });
    // The group's entries (the input and the reply after it) are left out: that channel is no longer readable.
    expect(found.map(item => [item.id, item.channel, item.kind])).toEqual([
      ['b', 'private-1', 'you'],
      ['a', 'private-1', 'input'],
    ]);
    expect(found[0].text).not.toContain('secret thoughts');
    expect(found[0].text).toContain('→ send_message({"text":"ok"})');
    expect(await deep.search(agent.id, { query: 'deploy vault', to: new Date('2026-09-01T10:00:01Z') })).toHaveLength(
      1,
    );
    expect(await deep.search(agent.id, { query: 'deploy', channel: 'group:gone' })).toEqual([]);
    const episode = await deep.episode(agent.id, 'b', 2);
    expect(episode.entries.map(item => item.id)).toEqual(['a', 'b']);
    expect(episode.hidden).toContain('2 entries');
    await expect(deep.episode(agent.id, 'd')).rejects.toThrow('can no longer read');
    expect(entryText({ type: 'compaction', id: 'x', summary: 'Earlier: things.' })).toEqual({
      kind: 'summary',
      text: 'Earlier: things.',
    });
  } finally {
    await database.close();
  }
});
