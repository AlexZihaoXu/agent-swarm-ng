import { expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { GatewayDispatchEvents, type GatewayDispatchPayload } from 'discord-api-types/v10';
import { prepareDatabase } from '../test-database';
import type { ChannelMessage } from '../chat-runtime';
import { DiscordStore } from './store';
import { DiscordIntake, type IntakeOptions } from './intake';

const BOT = '1000000000000000001';
const OWNER = '4000000000000000001';
const STRANGER = '4000000000000000002';
const OTHER_BOT = '1000000000000000002';
const GUILD = '2000000000000000001';
const DESIGN = '3000000000000000002';
const GENERAL = '3000000000000000006';
const THREAD = '3000000000000000005';
const DM = '5000000000000000001';
let sequence = 0;
const id = () => String(1300000000000000000n + BigInt(++sequence));

async function setup(options: IntakeOptions = {}, evaluate?: (notice: string) => Promise<'admit' | 'ignore'>) {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const agent = await database.createAgent({ name: 'Aether', endpointId: 'mock', model: 'm', thinkingLevel: 'off' });
  const other = await database.createAgent({ name: 'Morgan', endpointId: 'mock', model: 'm', thinkingLevel: 'off' });
  const store = new DiscordStore(database);
  await store.identify(agent.id, BOT, 'aether-bot');
  await store.identify(other.id, OTHER_BOT, 'morgan-bot');
  await store.setOwnerAccounts([{ id: OWNER, name: 'Alex' }]);
  await store.discovered(agent.id, [
    { channelId: DESIGN, guildId: GUILD, guildName: 'Swarm Lab', name: 'design', kind: 'text' },
    { channelId: GENERAL, guildId: GUILD, guildName: 'Swarm Lab', name: 'general', kind: 'text' },
    { channelId: THREAD, guildId: GUILD, guildName: 'Swarm Lab', parentId: DESIGN, name: 'Logo v2', kind: 'thread' },
  ]);
  await store.update(agent.id, { channels: [{ channelId: DESIGN, allowed: true }] });
  const delivered: ChannelMessage[] = [];
  const intake = new DiscordIntake(
    database,
    store,
    {
      deliver: (_agentId, input) => delivered.push(input),
      ...(evaluate ? { evaluate: (_agentId, _channelId, notice) => evaluate(notice) } : {}),
    },
    { quietMs: 40, capMs: 150, ...options },
  );
  const send = (
    channelId: string,
    author: { id: string; username: string; bot?: boolean },
    content: string,
    extra: Record<string, unknown> = {},
  ) => {
    const messageId = id();
    return intake
      .handle({
        agentId: agent.id,
        botUserId: BOT,
        payload: {
          op: 0,
          s: sequence,
          t: GatewayDispatchEvents.MessageCreate,
          d: {
            id: messageId,
            channel_id: channelId,
            ...(channelId === DM ? {} : { guild_id: GUILD }),
            author: { global_name: null, discriminator: '0', avatar: null, ...author },
            content,
            timestamp: new Date().toISOString(),
            edited_timestamp: null,
            tts: false,
            mention_everyone: false,
            mentions: [],
            mention_roles: [],
            attachments: [],
            embeds: [],
            pinned: false,
            type: 0,
            ...extra,
          },
        } as unknown as GatewayDispatchPayload,
      })
      .then(() => messageId);
  };
  return { database, agent, other, store, intake, delivered, send };
}
const owner = { id: OWNER, username: 'alex' };
const stranger = { id: STRANGER, username: 'sam' };
const morganBot = { id: OTHER_BOT, username: 'morgan-bot', bot: true };

it('delivers the owner’s DM with human authority, and strangers’ DMs only when the owner allows them', async () => {
  const { database, agent, store, intake, delivered, send } = await setup();
  try {
    await send(DM, owner, 'can you draft the plan?');
    await vi.waitFor(() => expect(delivered).toHaveLength(1));
    expect(delivered[0].source).toMatchObject({
      human: true,
      channelId: `discord:${DM}`,
      discord: { place: 'DM with alex' },
    });
    expect(delivered[0].text).toContain('alex (your owner)');
    expect(delivered[0].text).toContain('can you draft the plan?');
    await send(DM, stranger, 'hi, buy my course');
    await new Promise(resolve => setTimeout(resolve, 120));
    expect(delivered).toHaveLength(1);
    expect(await database.client.discordMessage.count({ where: { authorId: STRANGER } })).toBe(0);
    await store.update(agent.id, { strangerDms: true });
    await send(DM, stranger, 'hello again');
    await vi.waitFor(() => expect(delivered).toHaveLength(2));
    expect(delivered[1].source?.human).toBeUndefined();
    expect(delivered[1].text).toContain('sam (person)');
  } finally {
    intake.close();
    await database.close();
  }
});

it('ignores channels outside the allow-list, stays silent on undirected messages, and points at unread ones', async () => {
  const { database, intake, delivered, send } = await setup();
  try {
    await send(GENERAL, stranger, 'not allowed here');
    await send(DESIGN, stranger, 'first idea');
    await send(DESIGN, stranger, 'second idea');
    await new Promise(resolve => setTimeout(resolve, 120));
    expect(delivered).toHaveLength(0); // mention-only by default
    expect(await database.client.discordMessage.count()).toBe(2); // saved, readable later
    await send(DESIGN, stranger, 'hey <@1000000000000000001> thoughts?', {
      mentions: [{ id: BOT, username: 'aether-bot' }],
    });
    await vi.waitFor(() => expect(delivered).toHaveLength(1));
    const text = delivered[0].text;
    expect(delivered[0].source?.discord?.place).toBe('Swarm Lab › #design');
    expect(text).toContain('thoughts?');
    expect(text).toContain('+2 more messages in this channel');
    expect(text).toContain(`discord_read_messages({"channelId":"discord:${DESIGN}"})`);
    // A thread follows its parent's allow-list.
    await send(THREAD, owner, 'in the thread');
    await vi.waitFor(() => expect(delivered).toHaveLength(2));
    expect(delivered[1].source?.discord?.place).toBe('Swarm Lab › Logo v2');
  } finally {
    intake.close();
    await database.close();
  }
});

it('batches a burst: 3 s quiet (reset by each message), at most 10 s, and a bounded trigger', async () => {
  const { database, agent, store, intake, delivered, send } = await setup({ quietMs: 60, capMs: 200, fullMessages: 3 });
  try {
    await store.update(agent.id, { channels: [{ channelId: DESIGN, allowed: true, admission: 'all' }] });
    const started = Date.now();
    // A steady stream every 25 ms keeps resetting the quiet timer; the cap still closes the batch.
    for (let index = 0; index < 12; index++) {
      await send(DESIGN, stranger, `spam ${index}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await vi.waitFor(() => expect(delivered.length).toBeGreaterThanOrEqual(1));
    const first = delivered[0];
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
    expect(first.text.match(/· message /g)).toHaveLength(3); // only the newest three in full
    expect(first.text).toMatch(/\+\d+ more messages in this channel/);
    await vi.waitFor(() => expect(delivered).toHaveLength(2)); // the rest of the stream: a second batch
  } finally {
    intake.close();
    await database.close();
  }
});

it('handles one batch at a time per agent, addressed first, and never runs two triages at once', async () => {
  let running = 0,
    most = 0;
  const { database, agent, store, intake, delivered, send } = await setup({}, async () => {
    running++;
    most = Math.max(most, running);
    await new Promise(resolve => setTimeout(resolve, 60));
    running--;
    return 'admit';
  });
  try {
    await store.update(agent.id, {
      channels: [
        { channelId: DESIGN, allowed: true, admission: 'check' },
        { channelId: GENERAL, allowed: true, admission: 'check' },
      ],
    });
    await send(DESIGN, stranger, 'chatter one');
    await send(GENERAL, stranger, 'chatter two');
    await send(DM, owner, 'urgent: stop the deploy');
    await vi.waitFor(() => expect(delivered).toHaveLength(3), { timeout: 3000 });
    // The first chatter batch was already being triaged; among the waiting ones, the addressed DM goes next.
    expect(delivered[0].text).toContain('chatter one');
    expect(delivered[1].text).toContain('urgent');
    expect(delivered[2].text).toContain('chatter two');
    expect(most).toBe(1);
  } finally {
    intake.close();
    await database.close();
  }
});

it('pauses an agent in a channel after a run of bot-only turns until a person speaks, and inherits our agents’ chains', async () => {
  const { database, agent, other, store, intake, delivered, send } = await setup({ botTurnLimit: 2 });
  try {
    await store.update(agent.id, { channels: [{ channelId: DESIGN, allowed: true, admission: 'all' }] });
    const first = await send(DESIGN, morganBot, 'ping');
    await database.client.discordMessage.create({
      data: {
        agentId: other.id,
        id: first,
        channelId: DESIGN,
        authorId: OTHER_BOT,
        authorName: 'morgan-bot',
        authorBot: true,
        content: 'ping',
        chainId: 'chain-7',
        createdAt: new Date(),
      },
    });
    await vi.waitFor(() => expect(delivered).toHaveLength(1));
    expect(delivered[0].source).toMatchObject({ agentId: other.id, chainId: 'chain-7' });
    expect(delivered[0].text).toContain('morgan-bot (agent morgan-bot)');
    await send(DESIGN, { id: '1000000000000000009', username: 'weatherbot', bot: true }, 'sunny');
    await vi.waitFor(() => expect(delivered).toHaveLength(2));
    expect(delivered[1].text).toContain('until a person speaks');
    await send(DESIGN, morganBot, 'pong');
    await new Promise(resolve => setTimeout(resolve, 120));
    expect(delivered).toHaveLength(2); // paused for bots
    await send(DESIGN, stranger, 'hello humans');
    await vi.waitFor(() => expect(delivered).toHaveLength(3));
    expect((await store.channel(agent.id, DESIGN))!.pausedAt).toBeNull();
    // Its own messages are never inputs.
    await send(DESIGN, { id: BOT, username: 'aether-bot', bot: true }, 'my own echo');
    await new Promise(resolve => setTimeout(resolve, 120));
    expect(delivered).toHaveLength(3);
  } finally {
    intake.close();
    await database.close();
  }
});
