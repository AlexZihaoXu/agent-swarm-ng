import { expect, it } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from '../test-database';
import { DiscordStore } from './store';

const DAY = 24 * 60 * 60 * 1000;

it('keeps saved Discord messages for the retention period and prunes older ones', async () => {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  try {
    const agent = await database.createAgent({ name: 'Aether', endpointId: 'mock', model: 'm', thinkingLevel: 'off' });
    const store = new DiscordStore(database);
    const saved = (id: string, age: number) =>
      database.client.discordMessage.create({
        data: {
          agentId: agent.id,
          id,
          channelId: '3000000000000000002',
          authorId: '4000000000000000001',
          authorName: 'alex',
          content: id,
          createdAt: new Date(Date.now() - age),
        },
      });
    await saved('1300000000000000001', 31 * DAY);
    await saved('1300000000000000002', 29 * DAY);
    await saved('1300000000000000003', 0);
    await saved('1300000000000000004', 40 * DAY);
    await saved('1300000000000000005', 50 * DAY);
    // In short batches (here 2 at a time), so a backlog never holds one long write.
    expect(await store.prune(30, 2)).toBe(3);
    const left = await database.client.discordMessage.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
    expect(left.map(row => row.id)).toEqual(['1300000000000000002', '1300000000000000003']);
    // With the announced message pruned, everything left still reads as unread after it.
    expect((await store.unread(agent.id, '3000000000000000002', '1300000000000000001')).count).toBe(2);
    // Reading an agent's Discord policies never creates a row.
    expect((await store.bot(agent.id)).admission).toBe('check');
    expect(await database.client.discordBot.count()).toBe(0);
  } finally {
    await database.close();
  }
});

it('files every channel under its server’s name, also channels created later and after a rename', async () => {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  try {
    const agent = await database.createAgent({ name: 'Aether', endpointId: 'mock', model: 'm', thinkingLevel: 'off' });
    const store = new DiscordStore(database);
    const guild = '2000000000000000001';
    const channel = (channelId: string, name: string, guildName: string | null) => ({
      channelId,
      guildId: guild,
      guildName,
      name,
      kind: 'text',
    });
    // Created before the server's name was known (a later GUILD_CREATE fills it in).
    await store.discovered(agent.id, [channel('3000000000000000001', 'early', null)]);
    await store.discovered(agent.id, [channel('3000000000000000002', 'general', 'study group')]);
    // Created afterwards (CHANNEL_CREATE carries no server name).
    await store.discovered(agent.id, [channel('3000000000000000003', 'alex-bot', null)]);
    const names = async () => (await store.channels(agent.id)).map(row => [row.name, row.guildName]);
    expect(await names()).toEqual(
      expect.arrayContaining([
        ['early', 'study group'],
        ['general', 'study group'],
        ['alex-bot', 'study group'],
      ]),
    );
    await store.nameServer(agent.id, guild, 'Study Group');
    expect(new Set((await names()).map(([, server]) => server))).toEqual(new Set(['Study Group']));
  } finally {
    await database.close();
  }
});
