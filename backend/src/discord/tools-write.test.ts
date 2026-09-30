import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { prepareDatabase } from '../test-database';
import { SwarmSettingsStore } from '../swarm-settings';
import { BlobStore } from '../files/blob-store';
import { FileStore } from '../files/store';
import { MockDiscord } from './testing/mock-discord';
import { DiscordStore } from './store';
import { DiscordTokenStore } from './token-store';
import { DiscordConnections } from './connections';
import { createDiscordWriteTools } from './tools-write';

// These connect to a mock Discord Gateway, which is slower when the whole suite runs at once.
vi.setConfig({ testTimeout: 15_000 });

const TOKEN = 'MTAwMDAwMDAwMDAwMDAwMDAx.GxYzAb.abcdefghijklmnopqrstuvwxyz0123';
const BOT = '1000000000000000001';
const OWNER = '4000000000000000001';
const STRANGER = '4000000000000000002';
const GUILD = '2000000000000000001';
const DESIGN = '3000000000000000002';
const IDEAS = '3000000000000000004';
const OTHER = '3000000000000000006';

let discord: MockDiscord;
let next = 0n;
const sentId = () => String(1400000000000000000n + ++next);
beforeEach(async () => {
  discord = await new MockDiscord().start();
  discord.tokens.set(TOKEN, { id: BOT, username: 'aether-bot' });
  discord.guilds = [
    {
      id: GUILD,
      name: 'Swarm Lab',
      unavailable: false,
      channels: [
        { id: DESIGN, type: 0, name: 'design' },
        { id: IDEAS, type: 15, name: 'ideas' },
        { id: OTHER, type: 0, name: 'other' },
      ],
      threads: [],
    },
  ];
  // Posting echoes a message by the bot, like Discord.
  discord.on(request => {
    const post = /^\/channels\/(\d+)\/messages$/.exec(request.path);
    if (request.method === 'POST' && post)
      return {
        json: {
          id: sentId(),
          channel_id: post[1],
          author: { id: BOT, username: 'aether-bot', bot: true },
          content: request.body?.content ?? '',
          timestamp: new Date().toISOString(),
          attachments: [],
        },
      };
    return undefined;
  });
});
afterEach(async () => {
  await discord.stop();
});

async function setup() {
  const root = join(process.env.SQLITE_TEST_ROOT!, crypto.randomUUID());
  await mkdir(root, { recursive: true });
  const database = await prepareDatabase(join(root, 'platform.db'));
  const agent = await database.createAgent({ name: 'Aether', endpointId: 'mock', model: 'm', thinkingLevel: 'off' });
  const tokens = new DiscordTokenStore(join(root, 'discord-bots.json'));
  await tokens.set(agent.id, TOKEN);
  const store = new DiscordStore(database);
  const connections = new DiscordConnections(tokens, store, { api: discord.api });
  await connections.restart(agent.id);
  await vi.waitFor(() => expect(connections.status(agent.id).state).toBe('online'), { timeout: 5000 });
  await vi.waitFor(async () => expect((await store.channels(agent.id)).length).toBe(3));
  await store.update(agent.id, {
    channels: [
      { channelId: DESIGN, allowed: true },
      { channelId: IDEAS, allowed: true },
    ],
  });
  await store.setOwnerAccounts([{ id: OWNER, name: 'Alex' }]);
  const files = new FileStore(database, new BlobStore(join(root, 'files')), new SwarmSettingsStore(database));
  const chains: string[] = [];
  const tools = Object.fromEntries(
    createDiscordWriteTools({
      agentId: agent.id,
      agentName: 'Aether',
      store,
      connections,
      files,
      chain: async channelId => {
        chains.push(channelId);
        return 'chain-1';
      },
      // This turn answers a Discord input in DESIGN; IDEAS came up in passing.
      answersTurn: channelId => channelId === DESIGN,
    }).map(tool => [tool.name, tool]),
  );
  const call = async (name: string, params: object) => {
    const output = await tools[name].execute('call', params as never, undefined, undefined, undefined as never);
    return {
      ...JSON.parse((output.content[0] as { text: string }).text),
      terminate: (output as { terminate?: boolean }).terminate,
    };
  };
  return { database, agent, store, files, connections, call, chains };
}
const posts = () => discord.requests.filter(request => request.method === 'POST' && /\/messages$/.test(request.path));

it('posts like a member: split, replies, only named people pinged, files attached, recorded with its chain', async () => {
  const { database, agent, store, files, connections, call, chains } = await setup();
  try {
    const upload = await files.add({
      channelKey: `discord:${DESIGN}`,
      uploader: { kind: 'agent', id: agent.id, name: 'Aether' },
      name: 'plan.md',
      source: new TextEncoder().encode('# Plan\n'),
    });
    const text = `Thanks <@${OWNER}>! @everyone please look.\n\n${'long paragraph '.repeat(200)}`;
    const receipt = await call('discord_send_message', {
      channelId: `discord:${DESIGN}`,
      text,
      replyToMessageId: '1300000000000000002',
      fileIds: [upload.id],
    });
    expect(receipt.terminate).toBe(true);
    expect(receipt.posted).toHaveLength(2);
    const [first, second] = posts();
    expect(first.body).toMatchObject({
      // A reply quotes, but pings its author only when asked (ping:true).
      allowed_mentions: { parse: [], users: [OWNER], replied_user: false },
      message_reference: { message_id: '1300000000000000002' },
    });
    expect(first.files).toEqual(['plan.md:7']);
    expect(second.body.message_reference).toBeUndefined();
    expect(second.files).toEqual([]);
    expect(first.body.content.length + second.body.content.length).toBeGreaterThan(2000);
    expect(chains).toEqual([DESIGN]);
    const recorded = await database.client.discordMessage.findMany({ where: { agentId: agent.id } });
    expect(recorded.map(row => [row.chainId, row.authorBot])).toEqual([
      ['chain-1', true],
      ['chain-1', true],
    ]);
    // Its own post counts as read up to there; the file now belongs to the Discord message.
    expect((await store.channel(agent.id, DESIGN))!.announcedUpTo).toBe(receipt.posted[1]);
    expect((await files.get(upload.id))!.view).toMatchObject({ messageKind: 'discord', messageId: receipt.posted[0] });
    expect(
      (await call('discord_send_message', { channelId: DESIGN, text: 'ack', final: false })).terminate,
    ).toBeUndefined();
    // A final post elsewhere (say, one your owner asked for from your private chat) does not end the turn.
    const elsewhere = await call('discord_send_message', { channelId: IDEAS, text: 'hi there' });
    expect(elsewhere.terminate).toBeUndefined();
    expect(elsewhere.note).toContain('finish it there');
    // A long post that fails partway says (and records) what was already posted.
    let posted = 0;
    discord.before(request =>
      request.method === 'POST' && request.path === `/channels/${DESIGN}/messages` && ++posted === 2
        ? { status: 403, json: { message: 'Missing Permissions', code: 50013 } }
        : undefined,
    );
    await expect(call('discord_send_message', { channelId: DESIGN, text: 'word '.repeat(600) })).rejects.toThrow(
      /^Posted 1 of 2 parts \(\d+\), then: Discord says you lack permission/,
    );
    expect(await database.client.discordMessage.count({ where: { agentId: agent.id } })).toBe(5);
    await expect(call('discord_send_message', { channelId: OTHER, text: 'hi' })).rejects.toThrow('not one you may use');
    await expect(call('discord_send_message', { channelId: DESIGN, text: ' ' })).rejects.toThrow('empty');
  } finally {
    await connections.close();
    await database.close();
  }
});

it('changes only its own messages, DMs only people the owner allows, reacts, starts forum posts, pins and forwards', async () => {
  const { database, agent, store, connections, call } = await setup();
  try {
    discord.on(request => {
      if (request.method === 'GET' && request.path === `/channels/${DESIGN}/messages/1300000000000000002`)
        return {
          json: {
            id: '1300000000000000002',
            channel_id: DESIGN,
            author: { id: OWNER, username: 'alex' },
            attachments: [],
          },
        };
      if (request.method === 'GET' && request.path === `/channels/${DESIGN}/messages/1400000000000000099`)
        return {
          json: {
            id: '1400000000000000099',
            channel_id: DESIGN,
            author: { id: BOT, username: 'aether-bot' },
            attachments: [],
          },
        };
      if (request.path === `/channels/${DESIGN}/messages/1400000000000000099`)
        return { json: { id: '1400000000000000099', channel_id: DESIGN } };
      if (request.path === '/users/@me/channels')
        return {
          json: {
            id: '5000000000000000009',
            type: 1,
            recipients: [{ id: request.body.recipient_id, username: 'someone' }],
          },
        };
      if (request.path.includes('/reactions/') || request.path.includes('/messages/pins/'))
        return { status: 204, json: null };
      if (request.method === 'GET' && request.path === `/channels/${IDEAS}`)
        return { json: { id: IDEAS, type: 15, available_tags: [{ id: '77', name: 'Bug' }] } };
      if (request.method === 'POST' && request.path === `/channels/${IDEAS}/threads`)
        return { json: { id: '3000000000000000099', type: 11, name: request.body.name, parent_id: IDEAS } };
      return undefined;
    });
    await expect(
      call('discord_edit_message', { channelId: DESIGN, messageId: '1300000000000000002', text: 'x' }),
    ).rejects.toThrow('only change your own');
    expect(
      await call('discord_edit_message', { channelId: DESIGN, messageId: '1400000000000000099', text: 'fixed' }),
    ).toMatchObject({
      edited: '1400000000000000099',
    });
    await expect(
      call('discord_delete_message', { channelId: DESIGN, messageId: '1300000000000000002' }),
    ).rejects.toThrow();
    await expect(call('discord_open_dm', { userId: STRANGER })).rejects.toThrow('DM list');
    expect(await call('discord_open_dm', { userId: OWNER })).toMatchObject({
      channelId: 'discord:5000000000000000009',
      with: 'Alex',
    });
    expect((await store.channel(agent.id, '5000000000000000009'))?.kind).toBe('dm');
    await call('discord_react', {
      channelId: DESIGN,
      messageId: '1300000000000000002',
      emoji: '<:partyblob:8>',
      active: true,
    });
    expect(discord.requests.at(-1)).toMatchObject({
      method: 'PUT',
      path: `/channels/${DESIGN}/messages/1300000000000000002/reactions/partyblob:8/@me`,
    });
    await expect(
      call('discord_start_thread', { channelId: IDEAS, name: 'Login bug', text: 'Steps…', tags: ['nope'] }),
    ).rejects.toThrow('no tag "nope"');
    expect(
      await call('discord_start_thread', { channelId: IDEAS, name: 'Login bug', text: 'Steps…', tags: ['bug'] }),
    ).toMatchObject({
      thread: 'discord:3000000000000000099',
    });
    expect(discord.requests.at(-1)!.body).toMatchObject({
      name: 'Login bug',
      applied_tags: ['77'],
      message: { content: 'Steps…' },
    });
    expect((await store.channel(agent.id, '3000000000000000099'))?.parentId).toBe(IDEAS);
    await call('discord_pin_message', { channelId: DESIGN, messageId: '1300000000000000002', pinned: true });
    expect(discord.requests.at(-1)).toMatchObject({
      method: 'PUT',
      path: `/channels/${DESIGN}/messages/pins/1300000000000000002`,
    });
    const forwarded = await call('discord_forward_message', {
      channelId: DESIGN,
      messageId: '1300000000000000002',
      toChannelId: 'discord:5000000000000000009',
    });
    expect(forwarded.channelId).toBe('discord:5000000000000000009');
    expect(posts().at(-1)!.body.message_reference).toEqual({
      type: 1,
      message_id: '1300000000000000002',
      channel_id: DESIGN,
    });
    expect(
      await call('discord_create_poll', { channelId: DESIGN, question: 'Friday?', answers: ['Yes', 'No'] }),
    ).toMatchObject({
      channelId: `discord:${DESIGN}`,
    });
    expect(posts().at(-1)!.body.poll).toMatchObject({ question: { text: 'Friday?' }, duration: 24 });
    // A DM with someone else lasts only while they are on the agent's DM whitelist.
    await store.update(agent.id, { dmAllowed: [{ id: STRANGER, name: 'Sam' }] });
    const { channelId: dm } = await call('discord_open_dm', { userId: STRANGER });
    expect(await call('discord_send_message', { channelId: dm, text: 'hi' })).toHaveProperty('posted');
    await store.update(agent.id, { dmAllowed: [] });
    await expect(call('discord_send_message', { channelId: dm, text: 'still there?' })).rejects.toThrow(
      'not one you may use',
    );
  } finally {
    await connections.close();
    await database.close();
  }
});

it('opens an attachment into the agent’s files once, for read_file', async () => {
  const { database, files, connections, call } = await setup();
  try {
    discord.on(request =>
      request.path === `/channels/${DESIGN}/messages/1300000000000000005`
        ? {
            json: {
              id: '1300000000000000005',
              channel_id: DESIGN,
              author: { id: OWNER, username: 'alex', global_name: 'Alex' },
              attachments: [
                { id: '9', filename: 'notes.txt', size: 5, url: `http://127.0.0.1:${discord.port}/cdn/notes.txt` },
              ],
            },
          }
        : undefined,
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/cdn/notes.txt') ? new Response('hello') : originalFetch(input, init)) as typeof fetch;
    try {
      const opened = await call('discord_open_attachment', {
        channelId: DESIGN,
        messageId: '1300000000000000005',
        attachmentId: '9',
      });
      expect(opened).toMatchObject({ name: 'notes.txt', kind: 'text', size: 5 });
      expect((await files.get(opened.fileId))!.view).toMatchObject({
        uploader: { kind: 'discord', name: 'Alex' },
        messageKind: 'discord',
        channelKey: `discord:${DESIGN}`,
      });
      const again = await call('discord_open_attachment', {
        channelId: DESIGN,
        messageId: '1300000000000000005',
        attachmentId: '9',
      });
      expect(again.fileId).toBe(opened.fileId);
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    await connections.close();
    await database.close();
  }
});
