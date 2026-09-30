import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { prepareDatabase } from '../test-database';
import { buildApp } from '../app';
import { MockDiscord } from './testing/mock-discord';
import { INTENTS } from './connections';
import { BOT_PERMISSIONS } from './routes';
import { DiscordStore } from './store';

const TOKEN = 'MTAwMDAwMDAwMDAwMDAwMDAx.GxYzAb.abcdefghijklmnopqrstuvwxyz0123';
const BAD = 'MTAwMDAwMDAwMDAwMDAwMDAy.GxYzAb.zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
let discord: MockDiscord;
beforeEach(async () => {
  discord = await new MockDiscord().start();
  discord.tokens.set(TOKEN, { id: '1000000000000000001', username: 'aether-bot' });
  discord.guilds = [
    {
      id: '2000000000000000001',
      name: 'Swarm Lab',
      unavailable: false,
      channels: [
        { id: '3000000000000000001', type: 4, name: 'Design' },
        { id: '3000000000000000002', type: 0, name: 'design', parent_id: '3000000000000000001' },
        { id: '3000000000000000003', type: 2, name: 'Voice' },
        { id: '3000000000000000004', type: 15, name: 'ideas' },
      ],
      threads: [{ id: '3000000000000000005', type: 11, name: 'Logo v2', parent_id: '3000000000000000002' }],
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
  const app = await buildApp({ database, computerController: null, discordApi: discord.api });
  const agent = await database.createAgent({ name: 'Aether', endpointId: 'mock', model: 'm', thinkingLevel: 'off' });
  const url = `/api/agents/${agent.id}/discord`;
  return { root, database, app, agent, url };
}

it('connects an agent’s bot with a saved token, learns its identity and channels, and never returns the token', async () => {
  const { root, database, app, agent, url } = await setup();
  try {
    expect((await app.inject(url)).json()).toMatchObject({ configured: false, status: { state: 'off' }, bot: null });
    expect(
      (await app.inject({ method: 'PUT', url: `${url}/token`, payload: { token: 'not-a-token' } })).statusCode,
    ).toBe(400);
    const saved = await app.inject({ method: 'PUT', url: `${url}/token`, payload: { token: TOKEN } });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain(TOKEN);
    await vi.waitFor(async () => expect((await app.inject(url)).json().status.state).toBe('online'), { timeout: 5000 });
    expect(discord.identifies[0].intents).toBe(INTENTS);
    const config = (await app.inject(url)).json();
    expect(config).toMatchObject({ configured: true, bot: { id: '1000000000000000001', name: 'aether-bot' } });
    expect(config.inviteUrl).toBe(
      `https://discord.com/oauth2/authorize?client_id=1000000000000000001&scope=bot&permissions=${BOT_PERMISSIONS}`,
    );
    // Text channels, threads and forums; no categories or voice. Nothing is allowed until the owner chooses.
    await vi.waitFor(async () => expect((await app.inject(url)).json().channels).toHaveLength(3));
    const listed = (await app.inject(url))
      .json()
      .channels.map((c: { name: string; kind: string; allowed: boolean }) => [c.name, c.kind, c.allowed]);
    expect(listed).toHaveLength(3);
    expect(listed).toEqual(
      expect.arrayContaining([
        ['design', 'text', false],
        ['ideas', 'forum', false],
        ['Logo v2', 'thread', false],
      ]),
    );
    const changed = await app.inject({
      method: 'PATCH',
      url,
      payload: {
        admission: 'check',
        strangerDms: true,
        channels: [{ id: '3000000000000000002', allowed: true, admission: 'all' }],
      },
    });
    expect(changed.json()).toMatchObject({ admission: 'check', strangerDms: true });
    expect(changed.json().channels.find((c: { id: string }) => c.id === '3000000000000000002')).toMatchObject({
      allowed: true,
      admission: 'all',
    });
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url,
          payload: { channels: [{ id: '3999999999999999999', allowed: true }] },
        })
      ).statusCode,
    ).toBe(400);
    // A dropped connection resumes (RESUMED, not READY) and is online again.
    discord.drop();
    await vi.waitFor(() => expect(discord.resumes).toBe(1), { timeout: 5000 });
    await vi.waitFor(async () => expect((await app.inject(url)).json().status.state).toBe('online'));
    expect(discord.identifies).toHaveLength(1);
    // The token is on disk only, private to the backend.
    const file = join(root, 'discord-bots.json');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ [agent.id]: TOKEN });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    // Deleting the agent signs its bot out and deletes its token.
    const doomed = await database.createAgent({ name: 'Doomed', endpointId: 'mock', model: 'm', thinkingLevel: 'off' });
    discord.tokens.set('MTAwMDAwMDAwMDAwMDAwMDA5.GxYzAb.abcdefghijklmnopqrstuvwxyz0199', {
      id: '1000000000000000009',
      username: 'doomed-bot',
    });
    await app.inject({
      method: 'PUT',
      url: `/api/agents/${doomed.id}/discord/token`,
      payload: { token: 'MTAwMDAwMDAwMDAwMDAwMDA5.GxYzAb.abcdefghijklmnopqrstuvwxyz0199' },
    });
    await vi.waitFor(() => expect(discord.connected).toBe(2), { timeout: 5000 });
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/agents/${doomed.id}`, payload: { confirmation: 'Doomed' } }))
        .statusCode,
    ).toBe(200);
    await vi.waitFor(() => expect(discord.connected).toBe(1));
    expect(Object.keys(JSON.parse(await readFile(file, 'utf8')))).toEqual([agent.id]);
    expect(await database.client.discordAccount.count({ where: { agentId: doomed.id } })).toBe(0);
    const removed = await app.inject({ method: 'DELETE', url: `${url}/token` });
    expect(removed.json()).toMatchObject({ configured: false, status: { state: 'off' } });
    await vi.waitFor(() => expect(discord.connected).toBe(0));
  } finally {
    await app.close();
    await database.close();
  }
});

it('stops without retrying when Discord refuses the token, and explains a missing Message Content intent', async () => {
  const { database, app, url } = await setup();
  try {
    await app.inject({ method: 'PUT', url: `${url}/token`, payload: { token: BAD } });
    await vi.waitFor(async () => expect((await app.inject(url)).json().status.state).toBe('error'));
    expect((await app.inject(url)).json().status.message).toContain('refused this token');
    const before = discord.requests.length;
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(discord.requests.length).toBe(before); // no retries against a refused token
    discord.closeAfterIdentify = 4014;
    await app.inject({ method: 'PUT', url: `${url}/token`, payload: { token: TOKEN } });
    await vi.waitFor(
      async () => expect((await app.inject(url)).json().status.message ?? '').toContain('Message Content Intent'),
      {
        timeout: 5000,
      },
    );
  } finally {
    await app.close();
    await database.close();
  }
});

it('keeps the owner’s Discord accounts, which can never be one of our agents’ bots', async () => {
  const { database, app, url } = await setup();
  try {
    await app.inject({ method: 'PUT', url: `${url}/token`, payload: { token: TOKEN } });
    await vi.waitFor(async () => expect((await app.inject(url)).json().bot).not.toBeNull(), { timeout: 5000 });
    const owner = '/api/discord/owner';
    expect((await app.inject(owner)).json()).toEqual({ accounts: [] });
    const set = await app.inject({
      method: 'PUT',
      url: owner,
      payload: { accounts: [{ id: '4000000000000000001', name: 'Alex' }] },
    });
    expect(set.json()).toEqual({ accounts: [{ id: '4000000000000000001', name: 'Alex' }] });
    const twice = { id: '4000000000000000001', name: 'Alex' };
    expect((await app.inject({ method: 'PUT', url: owner, payload: { accounts: [twice, twice] } })).json()).toEqual(
      set.json(),
    );
    expect(
      (await app.inject({ method: 'PUT', url: owner, payload: { accounts: [{ id: 'alex', name: 'Alex' }] } }))
        .statusCode,
    ).toBe(400);
    const bot = await app.inject({
      method: 'PUT',
      url: owner,
      payload: { accounts: [{ id: '1000000000000000001', name: 'x' }] },
    });
    expect(bot.statusCode).toBe(400);
    expect(bot.json().message).toContain('aether-bot');
  } finally {
    await app.close();
    await database.close();
  }
});

it('shows the dashboard what an agent’s bot saw in a channel, newest page first, with who is who', async () => {
  const { database, app, agent, url } = await setup();
  try {
    const store = new DiscordStore(database);
    await store.identify(agent.id, '1000000000000000001', 'aether-bot');
    await store.setOwnerAccounts([{ id: '4000000000000000001', name: 'Alex' }]);
    await store.discovered(agent.id, [
      {
        channelId: '3000000000000000002',
        guildId: '2000000000000000001',
        guildName: 'Swarm Lab',
        name: 'design',
        kind: 'text',
      },
    ]);
    const base = Date.parse('2026-09-30T10:00:00Z');
    const save = (index: number, authorId: string, authorName: string, extra: object = {}) =>
      database.client.discordMessage.create({
        data: {
          agentId: agent.id,
          id: String(1300000000000000000n + BigInt(index)),
          channelId: '3000000000000000002',
          authorId,
          authorName,
          authorBot: authorId.startsWith('1'),
          content: `message ${index}`,
          createdAt: new Date(base + index * 1000),
          ...extra,
        },
      });
    for (let index = 1; index <= 55; index++) await save(index, '4000000000000000002', 'sam');
    await save(56, '4000000000000000001', 'alex');
    await save(57, '1000000000000000001', 'aether-bot', {
      replyToId: '1300000000000000056',
      editedAt: new Date(),
      attachments: JSON.stringify([{ name: 'plan.md', size: 2048 }]),
    });
    await save(58, '1000000000000000009', 'other-bot', { deletedAt: new Date() });
    const channel = `${url}/channels/3000000000000000002/messages`;
    const page = (await app.inject(channel)).json();
    expect(page.channel).toEqual({ id: '3000000000000000002', place: 'Swarm Lab › #design', kind: 'text' });
    expect(page.messages).toHaveLength(50);
    expect(page.messages[0].text).toBe('message 9');
    expect(page.messages.slice(-4)).toMatchObject([
      { text: 'message 55', role: 'person', authorName: 'sam' },
      { text: 'message 56', role: 'owner', authorName: 'alex' },
      {
        text: 'message 57',
        role: 'you',
        edited: true,
        replyTo: { id: '1300000000000000056', authorName: 'alex', owner: true, text: 'message 56' },
        attachments: [{ name: 'plan.md', size: 2048 }],
      },
      { text: 'message 58', role: 'bot', deleted: true },
    ]);
    expect(page.nextCursor).toBe(page.messages[0].id);
    const older = (await app.inject(`${channel}?before=${page.nextCursor}`)).json();
    expect(older.messages.map((message: { text: string }) => message.text)).toEqual(
      Array.from({ length: 8 }, (_, index) => `message ${index + 1}`),
    );
    expect(older.nextCursor).toBeNull();
    expect((await app.inject(`${url}/channels/3000000000000000999/messages`)).statusCode).toBe(404);
  } finally {
    await app.close();
    await database.close();
  }
});
