import { expect, it } from 'vitest';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { prepareDatabase } from './test-database';
import { SwarmStore, DM_CHAIN_LIMIT, dmConversationId } from './swarm-store';

async function fixture() {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const agent = (name: string) =>
    database.createAgent({ name, endpointId: 'fixture', model: 'test-model', thinkingLevel: 'off' });
  const a = await agent('A'),
    b = await agent('B'),
    c = await agent('C');
  const swarm = new SwarmStore(database),
    chainId = crypto.randomUUID();
  await swarm.beginChain(a.id, chainId);
  const send = (senderId = a.id, recipientId = b.id, text = 'Hello', deliveryKey: string = crypto.randomUUID()) =>
    swarm.send({ senderId, recipientId, text, deliveryKey, chainId });
  return { database, swarm, a, b, c, chainId, send };
}
it('upgrades existing one-way grants without losing the original connection', async () => {
  const { database, swarm, a, b } = await fixture();
  try {
    await database.client.dmGrant.create({ data: { senderId: a.id, recipientId: b.id } });
    const sql = await readFile(
      new URL('../prisma/migrations/20260923023000_mutual_dm_connections/migration.sql', import.meta.url),
      'utf8',
    );
    const statement = sql.replace(/^--.*$/gm, '').split(';')[0];
    await database.client.$executeRawUnsafe(statement);
    await database.client.$executeRawUnsafe(statement);
    expect(await swarm.contacts(a.id)).toEqual([{ id: b.id, name: 'B' }]);
    expect(await swarm.contacts(b.id)).toEqual([{ id: a.id, name: 'A' }]);
    expect(await database.client.dmGrant.count()).toBe(2);
  } finally {
    await database.close();
  }
});

it('saves and revokes a mutual connection from either participant without affecting other pairs', async () => {
  const { database, swarm, a, b, c, send } = await fixture();
  try {
    await swarm.updateSettings(a.id, { allowedDmAgentIds: [b.id] });
    expect(await swarm.contacts(b.id)).toEqual([{ id: a.id, name: 'A' }]);
    await send(b.id, a.id, 'Automatic reverse permission');
    await swarm.updateSettings(c.id, { allowedDmAgentIds: [b.id] });
    await swarm.updateSettings(a.id, { allowedDmAgentIds: [] });
    expect(await swarm.contacts(b.id)).toEqual([{ id: c.id, name: 'C' }]);
    await expect(send(b.id, a.id)).rejects.toThrow('not allowed');
    await swarm.updateSettings(b.id, { allowedDmAgentIds: [] });
    expect(await swarm.contacts(c.id)).toEqual([]);
  } finally {
    await database.close();
  }
});

it('defaults to denial, enforces mutual revocation, and atomically saves appearance plus grants', async () => {
  const { database, swarm, a, b, c, send } = await fixture();
  try {
    expect((await swarm.settings(a.id)).allowedDmAgents).toEqual([]);
    await expect(send()).rejects.toThrow('not allowed');
    const avatar = { shape: 'bean', color: '#F7AD51', seed: 123 };
    await swarm.updateSettings(a.id, { avatar, allowedDmAgentIds: [b.id] });
    expect((await swarm.settings(a.id)).avatar).toEqual({ ...avatar, color: '#f7ad51' });
    await send();
    await send(b.id, a.id);
    await expect(
      swarm.updateSettings(a.id, { avatar: { ...avatar, shape: 'pebble' }, allowedDmAgentIds: ['missing'] }),
    ).rejects.toThrow('no longer exist');
    expect((await swarm.settings(a.id)).avatar?.shape).toBe('bean');
    await expect(swarm.updateSettings(a.id, { allowedDmAgentIds: [a.id] })).rejects.toThrow('excluding');
    await expect(swarm.updateSettings(a.id, { allowedDmAgentIds: [b.id, b.id] })).rejects.toThrow('different');
    await swarm.updateSettings(a.id, { allowedDmAgentIds: [c.id] });
    await expect(send()).rejects.toThrow('not allowed');
    expect(await swarm.contacts(a.id)).toEqual([{ id: c.id, name: 'C' }]);
  } finally {
    await database.close();
  }
});
it('shares one monotonic chain budget across replies and fan-out, and deduplicates without spending twice', async () => {
  const { database, swarm, a, b, c, chainId, send } = await fixture();
  try {
    await swarm.updateSettings(a.id, { allowedDmAgentIds: [b.id, c.id] });
    await swarm.updateSettings(b.id, { allowedDmAgentIds: [a.id] });
    const first = await send(a.id, b.id, 'First', 'first-key');
    expect((await send(a.id, b.id, 'First', 'first-key')).duplicate).toBe(true);
    expect((await swarm.beginChain(a.id, chainId)).remaining).toBe(DM_CHAIN_LIMIT - 1);
    await expect(send(a.id, b.id, 'Different', 'first-key')).rejects.toThrow('different message');
    for (let i = 1; i < DM_CHAIN_LIMIT; i++) {
      const message = i % 2 ? (await send(b.id, a.id)).message : (await send(a.id, c.id)).message;
      await swarm.claim(message.id, message.recipientId);
      await swarm.finish(message.id, message.recipientId, 'completed');
    }
    await expect(send()).rejects.toThrow('message limit');
    expect((await swarm.beginChain(a.id, chainId)).remaining).toBe(0);
    expect((await send(a.id, b.id, 'First', 'first-key')).message.id).toBe(first.message.id);
    expect(await database.client.dmMessage.count()).toBe(DM_CHAIN_LIMIT);
  } finally {
    await database.close();
  }
});
it('binds agent DM replies to one conversation and refuses changed retry targets', async () => {
  const { database, swarm, a, b, c, chainId } = await fixture();
  try {
    await swarm.updateSettings(a.id, { allowedDmAgentIds: [b.id, c.id] });
    const first = await swarm.send({ senderId: a.id, recipientId: b.id, chainId, deliveryKey: 'first', text: 'First' });
    const foreign = await swarm.send({
      senderId: a.id,
      recipientId: c.id,
      chainId,
      deliveryKey: 'foreign',
      text: 'Foreign',
    });
    const send = (replyToId?: string) =>
      swarm.send({ senderId: a.id, recipientId: b.id, chainId, deliveryKey: 'reply', text: 'About that', replyToId });
    await expect(send(foreign.message.id)).rejects.toThrow('Reply target not found');
    const reply = await send(first.message.id);
    expect(reply.message.replyTo?.text).toBe('First');
    expect((await swarm.history(b.id, a.id)).messages.at(-1)?.replyTo?.id).toBe(first.message.id);
    expect((await send(first.message.id)).duplicate).toBe(true);
    await expect(send()).rejects.toThrow('different');
    await database.client.dmMessage.delete({ where: { id: first.message.id } });
    expect((await swarm.history(b.id, a.id)).messages.at(-1)?.replyTo).toBeNull();
  } finally {
    await database.close();
  }
});

it('does not overspend the chain when deliveries race', async () => {
  const { database, swarm, a, b, c, chainId, send } = await fixture();
  try {
    await swarm.updateSettings(a.id, { allowedDmAgentIds: [b.id, c.id] });
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => send(a.id, i % 2 ? b.id : c.id, `Concurrent ${i}`)),
    );
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(DM_CHAIN_LIMIT);
    expect(await database.client.dmMessage.count()).toBe(DM_CHAIN_LIMIT);
    expect((await database.client.dmChain.findUnique({ where: { id: chainId } }))?.remaining).toBe(0);
  } finally {
    await database.close();
  }
});

it('scopes histories to the participant pair, preserves authors, and never mixes private human messages', async () => {
  const { database, swarm, a, b, c, send } = await fixture();
  try {
    await swarm.updateSettings(a.id, { allowedDmAgentIds: [b.id, c.id] });
    await database.appendMessage(a.channels[0].id, 'user', 'Private human conversation');
    for (let i = 0; i < 4; i++) await send(a.id, b.id, `AB ${i}`);
    const privateMessage = (await send(a.id, c.id, 'AC private')).message;
    await expect(swarm.message(a.id, b.id, privateMessage.id)).rejects.toThrow('not found');
    const page = await swarm.history(b.id, a.id, undefined, 2);
    expect(page.messages.map(m => m.text)).toEqual(['AB 2', 'AB 3']);
    expect(page.messages[0].sender.name).toBe('A');
    expect((await swarm.history(a.id, b.id, page.nextCursor!, 2)).messages.map(m => m.text)).toEqual(['AB 0', 'AB 1']);
    expect((await swarm.history(b.id, c.id)).messages).toEqual([]);
    expect(JSON.stringify(await swarm.history(a.id, b.id))).not.toContain('Private human');
    expect(dmConversationId(a.id, b.id)).toBe(dmConversationId(b.id, a.id));
    await expect(swarm.history(a.id, b.id, undefined, 41)).rejects.toThrow('Invalid');
    await expect(send(a.id, b.id, 'x'.repeat(8001))).rejects.toThrow('Invalid');
  } finally {
    await database.close();
  }
});
it('lists only actual DM counterparts in either direction, not merely enabled agents', async () => {
  const { database, swarm, a, b, c, send } = await fixture();
  try {
    await swarm.updateSettings(a.id, { allowedDmAgentIds: [b.id, c.id] });
    expect((await swarm.dmPeers(a.id)).peers).toEqual([]);
    await send(a.id, b.id, 'Outgoing only');
    await send(a.id, b.id, 'Same conversation');
    expect((await swarm.dmPeers(a.id)).peers.map(peer => peer.id)).toEqual([b.id]);
    expect((await swarm.dmPeers(b.id)).peers.map(peer => peer.id)).toEqual([a.id]);
    expect((await swarm.dmPeers(c.id)).peers).toEqual([]);
    await send(c.id, a.id, 'Incoming only');
    const page = await swarm.dmPeers(a.id, undefined, 1);
    expect(page.peers.map(peer => peer.id)).toEqual([b.id]);
    expect((await swarm.dmPeers(a.id, page.nextCursor!, 1)).peers.map(peer => peer.id)).toEqual([c.id]);
    await swarm.updateSettings(a.id, { allowedDmAgentIds: [] });
    expect((await swarm.dmPeers(a.id)).peers).toHaveLength(2);
  } finally {
    await database.close();
  }
});

it('lists persisted received messages without mixing outgoing messages or human context', async () => {
  const { database, swarm, a, b, c, send } = await fixture();
  try {
    await swarm.updateSettings(a.id, { allowedDmAgentIds: [b.id, c.id] });
    await send(a.id, b.id, 'Received by B');
    await send(b.id, a.id, 'Received by A');
    await send(a.id, c.id, 'Only C');
    const inbox = await swarm.received(b.id);
    expect(inbox.messages.map(message => message.text)).toEqual(['Received by B']);
    expect(inbox.messages[0].sender.name).toBe('A');
    await swarm.updateSettings(b.id, { allowedDmAgentIds: [] });
    expect((await swarm.received(b.id)).messages).toHaveLength(1);
    expect((await database.messages(b.channels[0].id)).messages).toEqual([]);
  } finally {
    await database.close();
  }
});

it('refreshes worker context after preceding replies while excluding queued peer inputs', async () => {
  const { database, swarm, a, b, send } = await fixture();
  try {
    await swarm.updateSettings(a.id, { allowedDmAgentIds: [b.id] });
    await swarm.updateSettings(b.id, { allowedDmAgentIds: [a.id] });
    await send(a.id, b.id, 'First request');
    const incoming = (await send(a.id, b.id, 'Queued request')).message;
    await send(b.id, a.id, 'Preceding reply finished');
    await send(a.id, b.id, 'Later queued input');
    expect((await swarm.context(b.id, a.id, incoming.sequence)).map(message => message.text)).toEqual([
      'First request',
      'Preceding reply finished',
    ]);
  } finally {
    await database.close();
  }
});

it('claims once for the correct recipient, cancels chains, and marks interrupted delivery without replay', async () => {
  const { database, swarm, a, b, chainId, send } = await fixture();
  try {
    await swarm.updateSettings(a.id, { allowedDmAgentIds: [b.id] });
    const first = (await send()).message;
    expect(await swarm.claim(first.id, a.id)).toBeNull();
    expect(await swarm.claim(first.id, b.id)).not.toBeNull();
    expect(await swarm.claim(first.id, b.id)).toBeNull();
    const second = (await send()).message;
    await swarm.cancelInterruptedDeliveries();
    expect(await swarm.claim(second.id, b.id)).toBeNull();
    expect((await database.client.dmMessage.findUnique({ where: { id: first.id } }))?.status).toBe('cancelled');
    await expect(send()).rejects.toThrow('chain stopped');
    const another = crypto.randomUUID();
    await swarm.beginChain(a.id, another);
    await swarm.cancelChain(another);
    expect((await database.client.dmChain.findUnique({ where: { id: chainId } }))?.cancelled).toBe(true);
  } finally {
    await database.close();
  }
});
it('deletion removes grants/participant transcripts and leaves unrelated forwarded transcripts intact', async () => {
  const { database, swarm, a, b, c, chainId, send } = await fixture();
  try {
    await swarm.updateSettings(a.id, { allowedDmAgentIds: [b.id] });
    await swarm.updateSettings(b.id, { allowedDmAgentIds: [a.id, c.id] });
    await send();
    const forwarded = (await send(b.id, c.id, 'Forwarded')).message;
    await database.deleteAgent(a.id, a.name);
    expect(await database.client.dmGrant.count({ where: { senderId: a.id } })).toBe(0);
    expect((await swarm.history(b.id, c.id)).messages.map(m => m.id)).toEqual([forwarded.id]);
    expect((await database.client.dmChain.findUnique({ where: { id: chainId } }))?.rootAgentId).toBeNull();
    expect(await swarm.claim(forwarded.id, c.id)).toBeNull();
    await expect(send(b.id, c.id, 'More')).rejects.toThrow('chain stopped');
  } finally {
    await database.close();
  }
});
