import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { prepareDatabase } from '../test-database';
import { EndpointStore } from '../endpoint-store';
import { buildApp } from '../app';
import { MockDiscord } from './testing/mock-discord';

const TOKEN = 'MTAwMDAwMDAwMDAwMDAwMDAx.GxYzAb.abcdefghijklmnopqrstuvwxyz0123';
const BOT = '1000000000000000001';
const OWNER = '4000000000000000001';
const DM = '5000000000000000001';
const GUILD = '2000000000000000001';
const CHANNEL = '3000000000000000002';

/** A model that answers a Discord input once with discord_send_message in its reply channel. */
let model: Server;
let modelUrl = '';
const prompts: string[] = [];
const checks: { text: string; tools: string[] }[] = [];
beforeAll(async () => {
  model = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const text = JSON.stringify(body.messages);
    prompts.push(text);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta: object, finish: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({ id: 't', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
      );
    chunk({ role: 'assistant', content: '' });
    const answered = body.messages.some((message: { role: string }) => message.role === 'tool');
    // The relevance check branch: it looks deeper once (a read-only tool), then decides.
    if (body.tools?.some((tool: { function: { name: string } }) => tool.function.name === 'admission_decision')) {
      checks.push({ text, tools: body.tools.map((tool: { function: { name: string } }) => tool.function.name) });
      const looked = body.messages.some((message: { role: string }) => message.role === 'tool');
      chunk({
        tool_calls: [
          looked
            ? {
                index: 0,
                id: 'call-check',
                type: 'function',
                function: {
                  name: 'admission_decision',
                  arguments: JSON.stringify({ action: 'admit', reason: 'They are asking about the deploy.' }),
                },
              }
            : {
                index: 0,
                id: 'call-look',
                type: 'function',
                function: {
                  name: 'discord_read_messages',
                  arguments: JSON.stringify({ channelId: `discord:${CHANNEL}`, limit: 5 }),
                },
              },
        ],
      });
      chunk({}, 'tool_calls');
      response.end('data: [DONE]\n\n');
      return;
    }
    const channel = /reply channel: (discord:\d+)/.exec(text)?.[1];
    if (
      !answered &&
      channel &&
      body.tools?.some((tool: { function: { name: string } }) => tool.function.name === 'discord_send_message')
    ) {
      chunk({
        tool_calls: [
          {
            index: 0,
            id: 'call-1',
            type: 'function',
            function: {
              name: 'discord_send_message',
              arguments: JSON.stringify({ channelId: channel, text: `Hi <@${OWNER}>, on it.` }),
            },
          },
        ],
      });
      chunk({}, 'tool_calls');
    } else chunk({}, 'stop');
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve));
  modelUrl = `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`;
});
afterAll(async () => {
  await new Promise(resolve => model.close(resolve));
});

let discord: MockDiscord;
beforeEach(async () => {
  discord = await new MockDiscord().start();
  discord.tokens.set(TOKEN, { id: BOT, username: 'aether-bot' });
  discord.on(request => {
    // Reading a channel (the relevance check may look deeper): nothing older than what it saw.
    if (request.method === 'GET' && /^\/channels\/\d+\/messages$/.test(request.path)) return { json: [] };
    const post = /^\/channels\/(\d+)\/messages$/.exec(request.path);
    if (request.method === 'POST' && post)
      return {
        json: {
          id: '1400000000000000001',
          channel_id: post[1],
          author: { id: BOT, username: 'aether-bot', bot: true },
          content: request.body?.content ?? '',
          timestamp: new Date().toISOString(),
          attachments: [],
        },
      };
    if (request.method === 'POST' && request.path.endsWith('/typing')) return { status: 204, json: null };
    return undefined;
  });
});
afterEach(async () => {
  await discord.stop();
});

it('your Discord DM reaches the agent as you, and its reply comes back through its bot', async () => {
  const root = join(process.env.SQLITE_TEST_ROOT!, crypto.randomUUID());
  await mkdir(root, { recursive: true });
  const database = await prepareDatabase(join(root, 'platform.db'));
  const endpoints = new EndpointStore(join(root, 'endpoints.json'));
  await endpoints.save({ id: 'endpoint', name: 'Mock', baseUrl: modelUrl, apiKey: 'key' });
  const app = await buildApp({
    requireLogin: false,
    database,
    endpointStore: endpoints,
    discordApi: discord.api,
    computerController: null,
  });
  try {
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/api/agents',
        payload: { name: 'Aether', endpointId: 'endpoint', model: 'test-model', thinkingLevel: 'off' },
      })
    ).json();
    await app.inject({
      method: 'PUT',
      url: '/api/discord/owner',
      payload: { accounts: [{ id: OWNER, name: 'Alex' }] },
    });
    await app.inject({ method: 'PUT', url: `/api/agents/${agent.id}/discord/token`, payload: { token: TOKEN } });
    await vi.waitFor(
      async () => expect((await app.inject(`/api/agents/${agent.id}/discord`)).json().status.state).toBe('online'),
      { timeout: 5000 },
    );
    discord.dispatch('MESSAGE_CREATE', {
      id: '1300000000000000001',
      channel_id: DM,
      author: { id: OWNER, username: 'alex', global_name: 'Alex' },
      content: 'Can you look at the deploy?',
      timestamp: new Date().toISOString(),
      edited_timestamp: null,
      mentions: [],
      attachments: [],
      embeds: [],
      type: 0,
    });
    await vi.waitFor(
      () =>
        expect(
          discord.requests.some(request => request.method === 'POST' && request.path === `/channels/${DM}/messages`),
        ).toBe(true),
      { timeout: 15_000 },
    );
    const reply = discord.requests.find(request => request.path === `/channels/${DM}/messages`)!;
    expect(reply.body).toMatchObject({
      content: `Hi <@${OWNER}>, on it.`,
      allowed_mentions: { parse: [], users: [OWNER] },
    });
    // The agent saw a Discord input labelled as its owner, with the reply channel and the Discord tools.
    const prompt = prompts.find(text => text.includes('Can you look at the deploy?'))!;
    expect(prompt).toContain(`reply channel: discord:${DM}`);
    expect(prompt).toContain(String.raw`[your owner] \"Alex\"`);
    // It wrote a reply there: Discord showed it typing (only while writing, not while reading).
    expect(discord.requests.some(request => request.path === `/channels/${DM}/typing`)).toBe(true);
  } finally {
    await app.close();
    await database.close();
  }
}, 30_000);

it('checks untargeted server messages in a visible, cheap branch before giving them a turn', async () => {
  const root = join(process.env.SQLITE_TEST_ROOT!, crypto.randomUUID());
  await mkdir(root, { recursive: true });
  const database = await prepareDatabase(join(root, 'platform.db'));
  const endpoints = new EndpointStore(join(root, 'endpoints.json'));
  await endpoints.save({ id: 'endpoint', name: 'Mock', baseUrl: modelUrl, apiKey: 'key' });
  discord.guilds = [
    {
      id: GUILD,
      name: 'Swarm Lab',
      unavailable: false,
      channels: [{ id: CHANNEL, type: 0, name: 'design' }],
      threads: [],
    },
  ];
  const app = await buildApp({
    requireLogin: false,
    database,
    endpointStore: endpoints,
    discordApi: discord.api,
    computerController: null,
  });
  try {
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/api/agents',
        payload: { name: 'Aether', endpointId: 'endpoint', model: 'test-model', thinkingLevel: 'off' },
      })
    ).json();
    await app.inject({ method: 'PUT', url: `/api/agents/${agent.id}/discord/token`, payload: { token: TOKEN } });
    await vi.waitFor(
      async () => expect((await app.inject(`/api/agents/${agent.id}/discord`)).json().channels).toHaveLength(1),
      { timeout: 5000 },
    );
    // "When it seems relevant" is the default; allow the channel.
    await app.inject({
      method: 'PATCH',
      url: `/api/agents/${agent.id}/discord`,
      payload: { channels: [{ id: CHANNEL, allowed: true }] },
    });
    discord.dispatch('MESSAGE_CREATE', {
      id: '1300000000000000002',
      channel_id: CHANNEL,
      guild_id: GUILD,
      author: { id: '4000000000000000002', username: 'sam', global_name: 'Sam' },
      content: 'has anyone checked the deploy?',
      timestamp: new Date().toISOString(),
      edited_timestamp: null,
      mentions: [],
      attachments: [],
      embeds: [],
      type: 0,
    });
    await vi.waitFor(
      () =>
        expect(
          discord.requests.some(
            request => request.method === 'POST' && request.path === `/channels/${CHANNEL}/messages`,
          ),
        ).toBe(true),
      { timeout: 15_000 },
    );
    const activity = (await app.inject(`/api/agents/${agent.id}/activity`)).body;
    expect(activity).toContain('Discord relevance check');
    expect(activity).toContain('They are asking about the deploy.');
    // The check read the new message in the flow of the conversation, and could look deeper (read-only only).
    expect(checks[0].text).toContain('Recent conversation in this channel');
    expect(checks[0].text).toContain(String.raw`(Recently active here: [person] \"Sam\".)`);
    expect(checks[0].tools.sort()).toEqual(
      [
        'admission_decision',
        'discord_find_member',
        'discord_read_messages',
        'discord_search_messages',
        'discord_view_profile',
      ].sort(),
    );
    expect(checks.length).toBe(2); // looked once, then decided
    expect(
      discord.requests.some(request => request.method === 'GET' && request.path === `/channels/${CHANNEL}/messages`),
    ).toBe(true);
  } finally {
    await app.close();
    await database.close();
  }
}, 30_000);
