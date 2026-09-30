import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { prepareDatabase } from '../test-database';
import { MockDiscord } from './testing/mock-discord';
import { DiscordStore } from './store';
import { DiscordTokenStore } from './token-store';
import { DiscordConnections } from './connections';
import { createDiscordReadTools } from './tools-read';

const TOKEN = 'MTAwMDAwMDAwMDAwMDAwMDAx.GxYzAb.abcdefghijklmnopqrstuvwxyz0123';
const BOT = '1000000000000000001';
const OWNER = '4000000000000000001';
const GUILD = '2000000000000000001';
const DESIGN = '3000000000000000002';
const SECRET = '3000000000000000007';
const DM = '5000000000000000001';
const author = (id: string, username: string, bot = false) => ({ id, username, global_name: null, bot });
const message = (id: string, content: string, extra: object = {}) => ({
  id,
  channel_id: DESIGN,
  author: author(OWNER, 'alex'),
  content,
  timestamp: new Date(Number((BigInt(id) >> 22n) + 1420070400000n)).toISOString(),
  edited_timestamp: null,
  attachments: [],
  embeds: [],
  mentions: [],
  pinned: false,
  type: 0,
  ...extra,
});

let discord: MockDiscord;
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
        { id: SECRET, type: 0, name: 'secret' },
      ],
      threads: [],
    },
  ];
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
  await vi.waitFor(async () => expect((await store.channels(agent.id)).length).toBe(2));
  await store.update(agent.id, { channels: [{ channelId: DESIGN, allowed: true }] });
  await store.setOwnerAccounts([{ id: OWNER, name: 'Alex' }]);
  const tools = Object.fromEntries(
    createDiscordReadTools({ agentId: agent.id, store, connections }).map(tool => [tool.name, tool]),
  );
  const call = async (name: string, params: object) =>
    JSON.parse(
      (
        (await tools[name].execute('call', params as never, undefined, undefined, undefined as never)).content[0] as {
          text: string;
        }
      ).text,
    );
  return { database, agent, store, connections, call };
}

it('reads a channel oldest first like the app, labels authors, and refuses channels the owner did not allow', async () => {
  const { database, connections, call } = await setup();
  try {
    discord.on(request =>
      request.path === `/channels/${DESIGN}/messages`
        ? {
            json: [
              message('1300000000000000003', 'the new logo', {
                type: 19,
                author: author('1000000000000000002', 'morgan-bot', true),
                referenced_message: message('1300000000000000002', 'can someone review?'),
                attachments: [{ id: '9', filename: 'logo.png', size: 2048, content_type: 'image/png' }],
                reactions: [{ emoji: { id: null, name: '👍' }, count: 2, me: true }],
                edited_timestamp: '2026-09-30T00:00:00Z',
              }),
              message('1300000000000000002', 'can someone review?'),
            ],
          }
        : undefined,
    );
    const page = await call('discord_read_messages', { channelId: `discord:${DESIGN}`, limit: 10 });
    expect(page.messages.map((m: { id: string }) => m.id)).toEqual(['1300000000000000002', '1300000000000000003']);
    expect(page.messages[0].author).toMatchObject({ name: 'alex', is: 'your owner' });
    expect(page.messages[1]).toMatchObject({
      author: { name: 'morgan-bot', bot: true },
      replyTo: { id: '1300000000000000002', author: 'alex' },
      attachments: [{ name: 'logo.png', size: 2048 }],
      reactions: [{ emoji: '👍', count: 2, mine: true }],
      edited: true,
    });
    expect(page.newer).toEqual({ after: '1300000000000000003' });
    expect(discord.requests.at(-1)!.query.get('limit')).toBe('10');
    await call('discord_read_messages', { channelId: DESIGN, at: '2026-09-30T00:00:00Z' });
    expect(discord.requests.at(-1)!.query.get('around')).toMatch(/^\d+$/);
    await expect(call('discord_read_messages', { channelId: SECRET })).rejects.toThrow('not one you may use');
    await expect(call('discord_read_messages', { channelId: DESIGN, before: '1', after: '2' })).rejects.toThrow();
  } finally {
    await connections.close();
    await database.close();
  }
});

it('searches only allowed channels, searches DMs from what it has seen, and says when Discord is still indexing', async () => {
  const { database, agent, store, connections, call } = await setup();
  try {
    let indexing = true;
    discord.on(request =>
      request.path === `/guilds/${GUILD}/messages/search`
        ? indexing
          ? { status: 202, json: { code: 110000, retry_after: 2, message: 'Index not yet available.' } }
          : { json: { total_results: 1, messages: [[message('1300000000000000009', 'logo final v3')]] } }
        : undefined,
    );
    expect(await call('discord_search_messages', { serverId: GUILD, query: 'logo' })).toMatchObject({ indexing: true });
    indexing = false;
    const found = await call('discord_search_messages', {
      serverId: GUILD,
      query: 'logo',
      has: ['image'],
      after: '2026-09-01T00:00:00Z',
    });
    expect(found.matches[0]).toMatchObject({ channelId: `discord:${DESIGN}`, text: 'logo final v3' });
    const query = discord.requests.at(-1)!.query;
    expect(query.getAll('channel_id')).toEqual([DESIGN]); // never the channel the owner did not allow
    expect(query.get('content')).toBe('logo');
    expect(query.getAll('has')).toEqual(['image']);
    expect(query.get('min_id')).toMatch(/^\d+$/);
    // DMs: Discord offers bots no search, so it searches the messages this bot has seen.
    await store.discovered(agent.id, [
      { channelId: DM, guildId: null, guildName: null, recipientId: OWNER, name: 'alex', kind: 'dm' },
    ]);
    await database.client.discordMessage.create({
      data: {
        agentId: agent.id,
        id: '1300000000000000010',
        channelId: DM,
        authorId: OWNER,
        authorName: 'alex',
        content: 'the invoice is attached',
        createdAt: new Date(),
      },
    });
    const dm = await call('discord_search_messages', { channelId: `discord:${DM}`, query: 'invoice' });
    expect(dm).toMatchObject({
      searched: 'messages seen in this DM',
      matches: [{ author: 'alex', text: 'the invoice is attached' }],
    });
  } finally {
    await connections.close();
    await database.close();
  }
});

it('shows unread per channel since the last notification, and reads pins, threads, reactions, polls and people', async () => {
  const { database, agent, store, connections, call } = await setup();
  try {
    for (const [id, mentionsBot] of [
      ['1300000000000000001', false],
      ['1300000000000000002', true],
      ['1300000000000000003', false],
    ] as const)
      await database.client.discordMessage.create({
        data: {
          agentId: agent.id,
          id,
          channelId: DESIGN,
          authorId: OWNER,
          authorName: 'alex',
          content: 'x',
          mentionsBot,
          createdAt: new Date(Number((BigInt(id) >> 22n) + 1420070400000n)),
        },
      });
    await database.client.discordChannel.update({
      where: { agentId_channelId: { agentId: agent.id, channelId: DESIGN } },
      data: { announcedUpTo: '1300000000000000001' },
    });
    expect((await call('discord_read_inbox', {})).channels).toEqual([
      expect.objectContaining({ channelId: `discord:${DESIGN}`, unread: 2, mentions: 1, after: '1300000000000000001' }),
    ]);
    discord.on(request => {
      if (request.path === `/channels/${DESIGN}/messages/pins`)
        return {
          json: {
            items: [{ pinned_at: '2026-09-29T10:00:00Z', message: message('1300000000000000004', 'rules') }],
            has_more: false,
          },
        };
      if (request.path === `/guilds/${GUILD}/threads/active`)
        return {
          json: {
            threads: [{ id: '3000000000000000009', type: 11, parent_id: DESIGN, name: 'Logo v2', message_count: 4 }],
            members: [],
          },
        };
      if (request.path.startsWith(`/channels/${DESIGN}/messages/1300000000000000004/reactions/`))
        return { json: [author(OWNER, 'alex')] };
      if (request.path === `/channels/${DESIGN}/messages/1300000000000000005`)
        return {
          json: message('1300000000000000005', '', {
            poll: {
              question: { text: 'Friday?' },
              answers: [{ answer_id: 1, poll_media: { text: 'Yes' } }],
              expiry: '2026-10-01T00:00:00Z',
              results: { is_finalized: false, answer_counts: [{ id: 1, count: 1, me_voted: false }] },
            },
          }),
        };
      if (request.path === `/channels/${DESIGN}/polls/1300000000000000005/answers/1`)
        return { json: { users: [author(OWNER, 'alex')] } };
      if (request.path === `/users/${OWNER}`) return { json: author(OWNER, 'alex') };
      if (request.path === `/guilds/${GUILD}/members/${OWNER}`)
        return { json: { user: author(OWNER, 'alex'), nick: 'Al', roles: ['7'], joined_at: '2026-09-01T00:00:00Z' } };
      if (request.path === `/guilds/${GUILD}/roles`) return { json: [{ id: '7', name: 'Designer' }] };
      if (request.path === `/guilds/${GUILD}/emojis`)
        return { json: [{ id: '8', name: 'partyblob', animated: false }] };
      return undefined;
    });
    expect((await call('discord_read_pins', { channelId: DESIGN })).pins[0]).toMatchObject({
      pinnedAt: '2026-09-29T10:00:00Z',
      text: 'rules',
    });
    expect((await call('discord_list_threads', { channelId: DESIGN })).threads).toEqual([
      { channelId: 'discord:3000000000000000009', name: 'Logo v2', messages: 4 },
    ]);
    // A listed thread becomes readable (it follows its parent's allow-list).
    expect((await store.channel(agent.id, '3000000000000000009'))?.parentId).toBe(DESIGN);
    expect(
      (await call('discord_read_reactions', { channelId: DESIGN, messageId: '1300000000000000004', emoji: '👍' }))
        .users,
    ).toEqual([{ id: OWNER, name: 'alex', is: 'your owner' }]);
    expect(await call('discord_read_poll', { channelId: DESIGN, messageId: '1300000000000000005' })).toMatchObject({
      question: 'Friday?',
      answers: [{ text: 'Yes', votes: 1, voters: ['alex'] }],
    });
    expect(await call('discord_view_profile', { userId: OWNER, serverId: GUILD })).toMatchObject({
      nickname: 'Al',
      is: 'your owner',
      roles: ['Designer'],
    });
    expect((await call('discord_list_emojis', { serverId: GUILD, query: 'party' })).emojis).toEqual([
      { name: 'partyblob', use: '<:partyblob:8>' },
    ]);
  } finally {
    await connections.close();
    await database.close();
  }
});
