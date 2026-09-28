import { expect, it } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from './test-database';
import { GroupStore } from './group-store';
import { ReactionStore } from './reaction-store';

it('persists idempotent participant reactions without granting access, spoofing identities or scheduling work', async () => {
  const db = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  try {
    const a = await db.createAgent({ name: 'A', endpointId: 'mock', model: 'test', thinkingLevel: 'off' });
    const b = await db.createAgent({ name: 'B', endpointId: 'mock', model: 'test', thinkingLevel: 'off' });
    const reactions = new ReactionStore(db),
      groups = new GroupStore(db);
    const group = await groups.create('Team', [a.id]);
    const post = await groups.publishHuman(group.id, 'Result', 'post');
    const channel = `group:${group.id}`,
      id = post.message.id;
    await reactions.set(channel, id, '👍', true);
    await reactions.set(channel, id, '👍', true);
    await reactions.set(channel, id, '👍', true, a.id);
    expect((await reactions.read(channel, [id]))[id]).toEqual([{ emoji: '👍', count: 2, mine: true }]);
    await expect(reactions.set(channel, id, '👍', true, b.id)).rejects.toThrow('member');
    await reactions.set(channel, id, '👩🏽‍💻', true, a.id);
    await reactions.set(channel, id, '🇨🇦', true, a.id);
    const all = (await reactions.read(channel, [id]))[id];
    expect(all).toEqual(
      expect.arrayContaining([
        { emoji: '👩🏽‍💻', count: 1, mine: false },
        { emoji: '🇨🇦', count: 1, mine: false },
      ]),
    );
    expect(await reactions.recent(a.id)).toEqual(['🇨🇦', '👩🏽‍💻', '👍']);
    for (const emoji of ['🔥', '😂', '🫶']) await reactions.set(channel, id, emoji, true, a.id);
    expect(await reactions.recent(a.id)).toEqual(['🫶', '😂', '🔥', '🇨🇦']);
    for (const invalid of ['not emoji', '👍👍', 'a', '', '🔥'.repeat(40)])
      await expect(reactions.set(channel, id, invalid, true)).rejects.toThrow('reaction');
    expect(await db.client.groupDelivery.count()).toBe(1);
    expect(await db.client.dmGrant.count()).toBe(0);
    const privateMessage = await db.appendMessage(a.channels[0].id, 'user', 'Private');
    await expect(reactions.read(a.channels[0].id, [privateMessage.id], b.id)).rejects.toThrow('available');
    await expect(reactions.set(channel, privateMessage.id, '👍', true, a.id)).rejects.toThrow('not found');
    await reactions.set(a.channels[0].id, privateMessage.id, '👀', true, a.id);
    expect((await reactions.read(a.channels[0].id, [privateMessage.id]))[privateMessage.id][0]).toMatchObject({
      count: 1,
      mine: false,
    });
    await groups.update(group.id, 'Team', [b.id]);
    await expect(reactions.set(channel, id, '👍', false, a.id)).rejects.toThrow('member');
    await reactions.set(channel, id, '👍', false);
    expect((await reactions.read(channel, [id]))[id].find(item => item.emoji === '👍')).toMatchObject({
      count: 1,
      mine: false,
    });
    await db.deleteAgent(a.id, a.name);
    expect(await db.client.agentEmojiRecent.count()).toBe(0);
    expect((await reactions.read(channel, [id]))[id]).toEqual([]);
  } finally {
    await db.close();
  }
});
