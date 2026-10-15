import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { prepareDatabase } from './test-database';
import { BlobStore } from './files/blob-store';
import { FileStore } from './files/store';
import { Scratchpad } from './scratchpad';
import { SwarmSettingsStore } from './swarm-settings';
import { DiscordTokenStore } from './discord/token-store';
import { AgentSessionStore } from './agent-session-store';
import { ArchiveError, jsonPart, OpenedArchive, writeTar, type ArchivePart } from './agent-archive';
import { AGENT_FILE_FORMAT } from './agent-export';
import { importAgent } from './agent-import';
import { dmConversationId } from './swarm-store';

let folder = '';
afterEach(async () => {
  if (folder) await rm(folder, { recursive: true, force: true });
});

async function setup() {
  folder = await mkdtemp(join('.scratch', 'agent-import-'));
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const settings = new SwarmSettingsStore(database);
  const stores = {
    files: new FileStore(database, new BlobStore(join(folder, 'files')), settings),
    scratch: new Scratchpad(database, settings),
    tokens: new DiscordTokenStore(join(folder, 'discord-bots.json')),
  };
  return { database, stores };
}

const OLD = '00000000-0000-4000-8000-000000000001';
/** A hand-made agent file: what an attacker controls. */
function agentFile(settings: Record<string, unknown>, parts: ArchivePart[] = []) {
  const tar = writeTar([
    jsonPart('manifest.json', { format: AGENT_FILE_FORMAT, version: 1, agent: { id: OLD, name: 'Forged' } }),
    jsonPart('agent.json', { settings: { name: 'Forged', ...settings }, channels: [] }),
    jsonPart('links.json', {}),
    ...parts,
  ]);
  return OpenedArchive.open(Readable.from(tar).pipe(createGzip()), 1e8, 1e8);
}

it('keeps settings within what the settings routes accept', async () => {
  const { database, stores } = await setup();
  try {
    const archive = await agentFile(
      {
        avatar: '{not json',
        heartbeatMinutes: 1,
        timeNoteMinutes: 7,
        compactAtPercent: 1000,
        idleCompactPercent: -5,
        sleepFrom: '99:99',
      },
      [
        jsonPart('timers.json', {
          timers: [{ kind: 'reminder', note: 'x'.repeat(1000), nextAt: '2999-01-01', intervalMs: 1, total: null }],
        }),
      ],
    );
    const { agentId } = await importAgent(database, stores, archive, 'personal');
    await archive.close();
    expect(await database.client.agent.findUnique({ where: { id: agentId } })).toMatchObject({
      avatar: null,
      heartbeatMinutes: 5,
      timeNoteMinutes: 15,
      compactAtPercent: 90,
      idleCompactPercent: 10,
      sleepFrom: '03:00',
    });
    const timer = (await database.client.agentTimer.findFirst({ where: { agentId } }))!;
    expect(timer.intervalMs).toBe(10_000);
    expect(timer.total).toBe(360);
    expect(timer.note).toHaveLength(256);
    expect(timer.nextAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * 24 * 60 * 60 * 1000);
  } finally {
    await database.close();
  }
});

it('brings over only its own DMs with agents in the same organization, never as their publications', async () => {
  const { database, stores } = await setup();
  try {
    const other = await database.client.organization.create({ data: { name: 'Elsewhere' } });
    const agent = (name: string, organizationId?: string) =>
      database.createAgent({ name, endpointId: 'mock', model: 'm', thinkingLevel: 'off', organizationId });
    const peer = await agent('Peer');
    const bystander = await agent('Bystander');
    const outsider = await agent('Outsider', other.id);
    // The peer's context is saved, so a later DM it "sent" would be recovered as its own publication.
    const sessions = new AgentSessionStore(database);
    const saved = SessionManager.inMemory();
    saved.appendMessage({ role: 'user', content: 'Earlier', timestamp: 1 });
    await sessions.save(peer.id, saved);

    const dm = (n: number, senderId: string, recipientId: string) => ({
      id: `00000000-0000-4000-8000-00000000010${n}`,
      senderId,
      recipientId,
      chainId: 'chain',
      text: `dm ${n}`,
    });
    const file = (n: number, channelKey: string) => ({
      id: `00000000-0000-4000-8000-00000000020${n}`,
      channelKey,
      blobId: '',
      name: `f${n}`,
      status: 'deleted',
    });
    const archive = await agentFile({}, [
      jsonPart(
        'dm-messages.jsonl',
        [
          dm(1, OLD, peer.id),
          dm(2, peer.id, OLD),
          dm(3, peer.id, bystander.id), // Neither side is the agent: a forgery.
          dm(4, OLD, outsider.id), // Another organization.
          dm(5, OLD, OLD),
        ],
        true,
      ),
      jsonPart(
        'files.jsonl',
        [
          file(1, `dm:${OLD}:${peer.id}`),
          file(2, `dm:${peer.id}:${bystander.id}`),
          file(3, `dm:${OLD}:${outsider.id}`),
        ],
        true,
      ),
    ]);
    const { agentId, skipped } = await importAgent(database, stores, archive, 'personal');
    await archive.close();

    const rows = await database.client.dmMessage.findMany({ orderBy: { sequence: 'asc' } });
    expect(rows.map(row => [row.text, row.senderId, row.recipientId, row.status])).toEqual([
      ['dm 1', agentId, peer.id, 'imported'],
      ['dm 2', peer.id, agentId, 'imported'],
    ]);
    expect(skipped.dms).toBe(3);
    expect((await database.client.channelFile.findMany()).map(row => row.channelKey)).toEqual([
      dmConversationId(agentId, peer.id),
    ]);
    const context = JSON.stringify((await sessions.load(peer.id))!.buildSessionContext().messages);
    expect(context).not.toContain('dm 2');
  } finally {
    await database.close();
  }
});

it('stores files and scratch files through their usual checks, and leaves nothing behind when one fails', async () => {
  const { database, stores } = await setup();
  try {
    const bytes = Buffer.from('<html><script>alert(1)</script></html>');
    const blob = (await new BlobStore(join(folder, 'source')).put(bytes, 1e6)).id;
    const parts = (scratch: Record<string, unknown>[]) => [
      jsonPart(
        'files.jsonl',
        [
          {
            id: '00000000-0000-4000-8000-000000000301',
            channelKey: 'chat:x',
            blobId: blob,
            name: 'page‮LMTH.png',
            kind: 'image',
            mime: 'text/html',
            size: 1,
          },
        ],
        true,
      ),
      { name: `files/${blob}`, size: bytes.byteLength, body: bytes },
      jsonPart('scratch.jsonl', scratch, true),
      { name: 'scratch/0', size: bytes.byteLength, body: bytes },
    ];
    const archive = await agentFile({}, parts([{ path: '/notes/plan.md', content: '# Plan' }]));
    const { agentId } = await importAgent(database, stores, archive, 'personal');
    await archive.close();
    const [file] = await database.client.channelFile.findMany();
    expect(file).toMatchObject({ kind: 'text', mime: 'text/plain', size: bytes.byteLength, status: 'available' });
    expect(file!.name).not.toContain('‮');
    expect(await database.client.scratchFile.findMany({ where: { agentId } })).toMatchObject([
      { path: 'notes/plan.md', content: '# Plan' },
    ]);

    // HTML posing as a scratch image is refused, and the half-imported agent is gone with its files.
    const refused = await agentFile({}, parts([{ path: 'shot.png', data: 'scratch/0', mime: 'image/png' }]));
    await expect(importAgent(database, stores, refused, 'personal')).rejects.toBeInstanceOf(ArchiveError);
    await refused.close();
    expect(await database.client.agent.count()).toBe(1);
    expect(await database.client.channelFile.count()).toBe(1);

    // The storage limits apply.
    await database.client.swarmSettings.upsert({
      where: { id: 1 },
      create: { id: 1, uploadMaxMb: 1 },
      update: { uploadMaxMb: 1 },
    });
    const big = Buffer.alloc(2 * 1024 * 1024, 1);
    const bigBlob = (await new BlobStore(join(folder, 'source')).put(big, 1e8)).id;
    const tooBig = await agentFile({}, [
      jsonPart(
        'files.jsonl',
        [{ id: '00000000-0000-4000-8000-000000000302', channelKey: 'chat:x', blobId: bigBlob }],
        true,
      ),
      { name: `files/${bigBlob}`, size: big.byteLength, body: big },
    ]);
    await expect(importAgent(database, stores, tooBig, 'personal')).rejects.toThrow('at most 1 MB');
    await tooBig.close();
  } finally {
    await database.close();
  }
});
