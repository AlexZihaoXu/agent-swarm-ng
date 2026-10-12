import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import { prepareDatabase } from './test-database';
import { BlobStore } from './files/blob-store';
import { DiscordTokenStore } from './discord/token-store';
import { EndpointStore } from './endpoint-store';
import { CodexProvider } from './codex-provider';
import { Connections } from './users/connections';
import { Reach } from './users/reach';
import { OpenedArchive } from './agent-archive';
import { DEFAULT_INCLUDES, exportAgent, type ExportIncludes } from './agent-export';
import { importAgent, unresolvedOf } from './agent-import';
import { agentProblems, removeUnresolved } from './agent-review';
import type { PlatformStore } from './platform-store';

let folder = '';
afterEach(async () => {
  if (folder) await rm(folder, { recursive: true, force: true });
});

async function setup() {
  folder = await mkdtemp(join('.scratch', 'agent-export-'));
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const blobs = new BlobStore(join(folder, 'files'));
  const tokens = new DiscordTokenStore(join(folder, 'discord-bots.json'));
  const endpoints = new EndpointStore(join(folder, 'endpoints.json'));
  await endpoints.save({ id: 'mine', name: 'Mine', baseUrl: 'http://127.0.0.1:1/v1' });
  const connections = new Connections(endpoints, new Reach(database), new CodexProvider());
  return { database, blobs, tokens, connections };
}

/** Exports an agent and opens the file again, as an import would. */
async function roundTrip(
  database: PlatformStore,
  blobs: BlobStore,
  tokens: DiscordTokenStore,
  agentId: string,
  includes: ExportIncludes = DEFAULT_INCLUDES,
) {
  const exported = (await exportAgent(database, blobs, tokens, agentId, includes))!;
  return OpenedArchive.open(Readable.from(exported.tar).pipe(createGzip()), 1e9, 1e9);
}

it('carries everything inside an agent to a new, paused agent, with its ids rewritten even in its context', async () => {
  const { database, blobs, tokens, connections } = await setup();
  try {
    const source = await database.createAgent({
      name: 'Aether',
      endpointId: 'somebody-elses-endpoint',
      model: 'gpt-x',
      thinkingLevel: 'high',
    });
    const client = database.client;
    const channel = source.channels[0].id;
    await client.agent.update({
      where: { id: source.id },
      data: { instructions: 'Be brief.', heartbeatEnabled: true },
    });
    const message = await database.appendMessage(channel, 'user', 'Hello Aether');
    await database.appendMessage(channel, 'assistant', 'Hi!', undefined, message.id);
    const stored = await blobs.put(Buffer.from('file bytes'), 1000);
    await client.fileBlob.create({ data: { id: stored.id, size: stored.size } });
    await client.channelFile.create({
      data: {
        channelKey: `chat:${channel}`,
        messageKind: 'chat',
        messageId: message.id,
        uploaderKind: 'human',
        uploaderName: 'Owner',
        name: 'notes.txt',
        mime: 'text/plain',
        kind: 'text',
        size: stored.size,
        blobId: stored.id,
      },
    });
    await client.agentSession.create({ data: { agentId: source.id, sessionId: 's1', header: '{}', entryCount: 1 } });
    await client.agentSessionEntry.create({
      data: {
        agentId: source.id,
        position: 0,
        entryId: 'e1',
        payload: JSON.stringify({ text: `[channel: ${channel}] message ${message.id} from agent ${source.id}` }),
      },
    });
    await client.agentMemory.create({
      data: {
        agentId: source.id,
        name: 'owner-likes-tea',
        type: 'preference',
        title: 'Tea',
        text: 'The owner likes tea.',
        by: 'owner',
        trust: 'owner',
        versions: { create: { title: 'Tea', text: 'The owner likes tea.', type: 'preference', changedBy: 'owner' } },
      },
    });
    await client.agentTimer.create({
      data: { agentId: source.id, kind: 'reminder', note: 'Stand up', nextAt: new Date() },
    });
    await client.scratchFile.create({ data: { agentId: source.id, path: 'plan.md', content: '# Plan', size: 6 } });
    await client.discordChannel.create({
      data: { agentId: source.id, channelId: '123456789012345678', name: 'general', kind: 'text', allowed: true },
    });
    await tokens.set(source.id, 'aaaaaaaaaaaaaaaaaaaaaaaa.bbbbbb.cccccccccccccccccccccccccc');

    const archive = await roundTrip(database, blobs, tokens, source.id);
    // The bot token stays out unless asked for.
    expect(JSON.stringify(await archive.json('discord.json'))).not.toContain('aaaaaaaa');
    const { agentId, skipped } = await importAgent(database, blobs, tokens, archive, 'personal');
    await archive.close();

    expect(agentId).not.toBe(source.id);
    const copy = (await client.agent.findUnique({ where: { id: agentId }, include: { channels: true } }))!;
    expect(copy).toMatchObject({
      name: 'Aether',
      endpointId: 'somebody-elses-endpoint',
      model: 'gpt-x',
      thinkingLevel: 'high',
      instructions: 'Be brief.',
      heartbeatEnabled: true,
      paused: true,
    });
    const copyChannel = copy.channels[0]!.id;
    expect(copyChannel).not.toBe(channel);
    const messages = await client.message.findMany({ where: { channelId: copyChannel }, orderBy: { sequence: 'asc' } });
    expect(messages.map(row => row.text)).toEqual(['Hello Aether', 'Hi!']);
    expect(messages[1]!.replyToId).toBe(messages[0]!.id);
    expect(messages[0]!.id).not.toBe(message.id);
    const files = await client.channelFile.findMany({ where: { channelKey: `chat:${copyChannel}` } });
    expect(files).toMatchObject([{ name: 'notes.txt', messageId: messages[0]!.id, blobId: stored.id }]);
    const entry = (await client.agentSessionEntry.findFirst({ where: { agentId } }))!;
    expect(entry.payload).toContain(`[channel: ${copyChannel}]`);
    expect(entry.payload).toContain(messages[0]!.id);
    expect(entry.payload).toContain(agentId);
    expect(entry.payload).not.toContain(source.id);
    expect(await client.agentMemory.findMany({ where: { agentId }, include: { versions: true } })).toMatchObject([
      { name: 'owner-likes-tea', trust: 'owner', versions: [{ changedBy: 'owner' }] },
    ]);
    expect(await client.agentTimer.count({ where: { agentId } })).toBe(1);
    expect(await client.scratchFile.findMany({ where: { agentId } })).toMatchObject([{ path: 'plan.md' }]);
    expect(skipped.dms).toBe(0);

    // In red: the provider that does not exist here, and Discord without its token.
    const review = await agentProblems(database, connections, tokens, agentId);
    expect(review.paused).toBe(true);
    expect(review.problems.map(problem => problem.section).sort()).toEqual(['discord', 'model']);
  } finally {
    await database.close();
  }
});

it('keeps links that do not exist here as unresolved, to remove; the token travels only when chosen', async () => {
  const { database, blobs, tokens, connections } = await setup();
  try {
    const peer = await database.createAgent({ name: 'Peer', endpointId: 'mine', model: 'm', thinkingLevel: 'off' });
    const source = await database.createAgent({ name: 'Solo', endpointId: 'mine', model: 'm', thinkingLevel: 'off' });
    await database.client.dmGrant.create({ data: { senderId: source.id, recipientId: peer.id } });
    await tokens.set(source.id, 'aaaaaaaaaaaaaaaaaaaaaaaa.bbbbbb.cccccccccccccccccccccccccc');
    const archive = await roundTrip(database, blobs, tokens, source.id, { ...DEFAULT_INCLUDES, discordToken: true });
    // As if the peer were not on this swarm: it is deleted before the import.
    await database.client.agent.delete({ where: { id: peer.id } });
    const { agentId, skipped } = await importAgent(database, blobs, tokens, archive, 'personal');
    await archive.close();
    expect(skipped.links).toBe(1);
    expect(await tokens.get(agentId)).toBe('aaaaaaaaaaaaaaaaaaaaaaaa.bbbbbb.cccccccccccccccccccccccccc');
    const { problems } = await agentProblems(database, connections, tokens, agentId);
    expect(problems).toMatchObject([{ section: 'links', kind: 'dmPeers', name: 'Peer' }]);
    expect(await removeUnresolved(database, agentId, 'dmPeers', peer.id)).toBe(true);
    expect(
      unresolvedOf((await database.client.agent.findUnique({ where: { id: agentId } }))!.unresolved).dmPeers,
    ).toEqual([]);
    expect((await agentProblems(database, connections, tokens, agentId)).problems).toEqual([]);
  } finally {
    await database.close();
  }
});

it('exports and imports over HTTP: a download, a new paused agent, and resume once nothing is in red', async () => {
  const { buildApp } = await import('./app');
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const app = await buildApp({ requireLogin: false, database, computerController: null });
  try {
    const source = await database.createAgent({ name: 'Wire', endpointId: '', model: 'm', thinkingLevel: 'off' });
    await database.appendMessage(source.channels[0].id, 'user', 'Over the wire');
    const exported = await app.inject({ method: 'GET', url: `/api/agents/${source.id}/export` });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-disposition']).toContain('Wire.swarm-agent');
    const imported = await app.inject({
      method: 'POST',
      url: '/api/agents/import?organizationId=personal',
      headers: { 'content-type': 'application/octet-stream' },
      payload: exported.rawPayload,
    });
    expect(imported.statusCode).toBe(201);
    const { agent } = imported.json() as { agent: { id: string; name: string; paused: boolean } };
    expect(agent).toMatchObject({ name: 'Wire', paused: true });
    // A paused agent takes no messages; with no provider chosen it cannot resume yet.
    const send = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { agentId: agent.id, message: 'hi', clientMessageId: crypto.randomUUID() },
    });
    expect(send.statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/api/agents/${agent.id}/resume`, payload: {} })).statusCode).toBe(
      409,
    );
    const review = await app.inject({ method: 'GET', url: `/api/agents/${agent.id}/review` });
    expect(review.json()).toMatchObject({ paused: true, problems: [{ section: 'model' }] });
    const refused = await app.inject({
      method: 'POST',
      url: '/api/agents/import?organizationId=personal',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('not an agent file'),
    });
    expect(refused.statusCode).toBe(400);
  } finally {
    await app.close();
  }
});
