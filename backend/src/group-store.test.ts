import { expect, it } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from './test-database';
import { GroupStore } from './group-store';
import { SwarmStore } from './swarm-store';

async function fixture() {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const agent = (name: string) =>
    database.createAgent({ name, endpointId: 'mock', model: 'test', thinkingLevel: 'off' });
  const a = await agent('A'),
    b = await agent('B'),
    c = await agent('C');
  return { database, groups: new GroupStore(database), a, b, c };
}
it('creates group membership without DM grants and restricts discovery/history to members', async () => {
  const { database, groups, a, b, c } = await fixture();
  try {
    const group = await groups.create('Research', [a.id, b.id]);
    expect(await database.client.dmGrant.count()).toBe(0);
    expect((await groups.list(a.id)).groups.map(item => item.id)).toEqual([group.id]);
    expect((await groups.list(c.id)).groups).toEqual([]);
    await expect(groups.history(group.id, c.id)).rejects.toThrow('member');
    await expect(groups.create('Bad', [a.id, a.id])).rejects.toThrow('different');
    await expect(groups.create('Bad', ['missing'])).rejects.toThrow('exist');
    expect(await database.client.groupChat.count()).toBe(1);
  } finally {
    await database.close();
  }
});
it('commits publications and fan-out once, binds authors, and preserves delivery for unchanged members', async () => {
  const { database, groups, a, b, c } = await fixture();
  try {
    const group = await groups.create('Team', [a.id, b.id]);
    const first = await groups.publishHuman(group.id, 'Discuss the task', 'request');
    expect(first.deliveries.map(delivery => delivery.agentId).sort()).toEqual([a.id, b.id].sort());
    expect((await groups.publishHuman(group.id, 'Discuss the task', 'request')).duplicate).toBe(true);
    await expect(groups.publishHuman(group.id, 'Different', 'request')).rejects.toThrow('different');
    const reply = await groups.publishAgent(group.id, a.id, 'My findings', first.message.chainId, 'reply');
    expect(reply.message).toMatchObject({ role: 'assistant', authorId: a.id, authorName: 'A' });
    expect(reply.deliveries.map(delivery => delivery.agentId)).toEqual([b.id]);
    expect(await database.client.dmMessage.count()).toBe(0);
    await groups.update(group.id, 'Renamed', [a.id, b.id, c.id]);
    expect(await groups.claim(first.message.id, a.id)).not.toBeNull();
    expect(await groups.claim(first.message.id, a.id)).toBeNull();
    expect(await groups.claim(first.message.id, c.id)).toBeNull(); // No replay on joining.
    await groups.update(group.id, 'Renamed', [b.id, c.id]);
    await expect(groups.publishAgent(group.id, a.id, 'Not allowed', first.message.chainId, 'revoked')).rejects.toThrow(
      'member',
    );
    await expect(groups.history(group.id, a.id)).rejects.toThrow('member');
    expect((await groups.history(group.id, b.id)).messages.map(message => message.text)).toEqual([
      'Discuss the task',
      'My findings',
    ]);
  } finally {
    await database.close();
  }
});
it('rejects foreign reply targets before group fan-out and binds duplicate keys to their original parent', async () => {
  const { database, groups, a, b } = await fixture();
  try {
    const group = await groups.create('Team', [a.id, b.id]);
    const other = await groups.create('Private', [a.id]);
    const parent = await groups.publishHuman(group.id, 'Original', 'root');
    const foreign = await groups.publishHuman(other.id, 'Foreign', 'other');
    await expect(groups.publishHuman(group.id, 'No', 'bad', foreign.message.id)).rejects.toThrow(
      'Reply target not found',
    );
    expect(await database.client.groupMessage.count({ where: { groupId: group.id } })).toBe(1);
    const reply = await groups.publishHuman(group.id, 'About that', 'reply', parent.message.id);
    expect(reply.message.replyTo?.text).toBe('Original');
    expect((await groups.history(group.id, a.id, undefined, 1)).messages[0].replyTo?.id).toBe(parent.message.id);
    expect((await groups.publishHuman(group.id, 'About that', 'reply', parent.message.id)).duplicate).toBe(true);
    await expect(groups.publishHuman(group.id, 'About that', 'reply', undefined)).rejects.toThrow('different');
    const agentReply = await groups.publishAgent(
      group.id,
      a.id,
      'My answer',
      parent.message.chainId,
      'agent-reply',
      reply.message.id,
    );
    expect(agentReply.message.replyToId).toBe(reply.message.id);
    await groups.update(group.id, 'Team', [b.id]);
    await expect(
      groups.publishAgent(group.id, a.id, 'No', parent.message.chainId, 'revoked-reply', parent.message.id),
    ).rejects.toThrow('member');
    await database.client.groupMessage.delete({ where: { id: parent.message.id } });
    expect((await groups.message(group.id, reply.message.id, b.id)).replyTo).toBeNull();
  } finally {
    await database.close();
  }
});

it('keeps DM permission independent when a group task branches, while sharing its budget', async () => {
  const { database, groups, a, b } = await fixture();
  const swarm = new SwarmStore(database);
  try {
    const group = await groups.create('Team', [a.id, b.id]);
    const root = await groups.publishHuman(group.id, 'Collaborate', 'root');
    const send = () =>
      swarm.send({
        senderId: a.id,
        recipientId: b.id,
        chainId: root.message.chainId,
        deliveryKey: crypto.randomUUID(),
        text: 'Focused assignment',
      });
    await expect(send()).rejects.toThrow('not allowed');
    await groups.publishAgent(
      group.id,
      a.id,
      'Shared finding with 50% improvement',
      root.message.chainId,
      'group-reply',
    );
    expect((await groups.search(group.id, b.id, '50%')).messages).toHaveLength(1);
    expect((await groups.search(group.id, b.id, '50_')).messages).toHaveLength(0);
    await swarm.updateSettings(a.id, { allowedDmAgentIds: [b.id] });
    await send();
    expect((await database.client.dmChain.findUnique({ where: { id: root.message.chainId } }))?.remaining).toBe(30);
    await database.client.groupChat.delete({ where: { id: group.id } });
    await expect(send()).rejects.toThrow('chain stopped');
  } finally {
    await database.close();
  }
});

it('requires the exact name, rejects unfinished deliveries, and deletes only the chosen group and its history', async () => {
  const { database, groups, a, b } = await fixture();
  try {
    const group = await groups.create('Team', [a.id, b.id]);
    const other = await groups.create('Other', [a.id]);
    const root = await groups.publishHuman(group.id, 'Hello', 'delete-root');
    await groups.publishHuman(group.id, 'Reply', 'delete-reply', root.message.id);
    await database.client.messageReaction.create({
      data: { groupMessageId: root.message.id, actorKey: 'human', emoji: '👍' },
    });
    const swarm = new SwarmStore(database);
    await swarm.updateSettings(a.id, { allowedDmAgentIds: [b.id] });
    await swarm.send({
      senderId: a.id,
      recipientId: b.id,
      chainId: root.message.chainId,
      deliveryKey: 'keep-private',
      text: 'Private branch',
    });
    await groups.publishHuman(other.id, 'Keep', 'keep-root');
    await expect(groups.remove(group.id, 'team')).rejects.toThrow('exact group name');
    await expect(groups.remove('missing', 'Team')).rejects.toThrow('Group not found');
    await expect(groups.remove(group.id, 'Team')).rejects.toThrow('responding');
    for (const delivery of root.deliveries) await groups.finish(root.message.id, delivery.agentId, 'completed');
    const reply = (await groups.history(group.id)).messages.at(-1)!;
    const deliveries = await database.client.groupDelivery.findMany({ where: { messageId: reply.id } });
    for (const delivery of deliveries) await groups.finish(reply.id, delivery.agentId, 'completed');
    await groups.remove(group.id, 'Team');
    expect(await database.client.groupChat.count()).toBe(1);
    expect(await database.client.groupMessage.count({ where: { groupId: group.id } })).toBe(0);
    expect(await database.client.groupMember.count({ where: { groupId: group.id } })).toBe(0);
    expect(await database.client.groupDelivery.count({ where: { groupId: group.id } })).toBe(0);
    expect(await database.client.messageReaction.count({ where: { groupMessageId: root.message.id } })).toBe(0);
    expect(await database.client.dmMessage.findUnique({ where: { deliveryKey: 'keep-private' } })).toMatchObject({
      text: 'Private branch',
    });
    expect(await database.client.dmChain.findUnique({ where: { id: root.message.chainId } })).toMatchObject({
      rootGroupId: null,
    });
    await expect(
      swarm.send({
        senderId: a.id,
        recipientId: b.id,
        chainId: root.message.chainId,
        deliveryKey: 'too-late',
        text: 'No',
      }),
    ).rejects.toThrow('chain stopped');
    expect((await groups.history(other.id)).messages.map(message => message.text)).toEqual(['Keep']);
    await expect(groups.publishHuman(group.id, 'Too late', 'late')).rejects.toThrow('Group not found');
    await expect(groups.history(group.id)).rejects.toThrow('Group not found');
    expect(await database.client.agent.count()).toBe(3);
  } finally {
    await database.close();
  }
});

it('shares the generated-message budget and isolates message expansion by group', async () => {
  const { database, groups, a, b } = await fixture();
  try {
    const group = await groups.create('One', [a.id, b.id]);
    const other = await groups.create('Two', [a.id]);
    const root = await groups.publishHuman(group.id, 'Start', 'root');
    await database.client.dmChain.update({ where: { id: root.message.chainId }, data: { remaining: 1 } });
    const published = await groups.publishAgent(group.id, a.id, 'One message', root.message.chainId, 'one');
    await expect(groups.publishAgent(group.id, b.id, 'Over budget', root.message.chainId, 'two')).rejects.toThrow(
      'limit',
    );
    expect((await groups.publishAgent(group.id, a.id, 'One message', root.message.chainId, 'one')).duplicate).toBe(
      true,
    );
    await expect(groups.publishAgent(group.id, a.id, 'One message', 'different-chain', 'one')).rejects.toThrow(
      'different',
    );
    await expect(groups.message(other.id, published.message.id, a.id)).rejects.toThrow('not found');
    expect((await groups.message(group.id, published.message.id, b.id)).text).toBe('One message');
    await database.deleteAgent(a.id, a.name);
    expect((await groups.history(group.id, b.id)).messages.at(-1)).toMatchObject({
      authorId: a.id,
      authorName: 'A',
      role: 'assistant',
    });
  } finally {
    await database.close();
  }
});
