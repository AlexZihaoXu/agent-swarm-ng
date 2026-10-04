import { viewerOf } from '../users/reach';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { PermissionFlagsBits } from 'discord-api-types/v10';
import type { PlatformStore } from '../platform-store';
import { messageText } from '../message-text';
import { FileSchema } from '../files/routes';
import type { FileStore } from '../files/store';
import { ADMISSIONS, authorRole, DiscordSettingsError, placeOf, type DiscordStore } from './store';
import type { DiscordTokenStore } from './token-store';

/** What a person in a server can do, and nothing a moderator could: the tools' needs, no more. */
export const BOT_PERMISSIONS =
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.SendMessagesInThreads |
  PermissionFlagsBits.CreatePublicThreads |
  PermissionFlagsBits.ReadMessageHistory |
  PermissionFlagsBits.AttachFiles |
  PermissionFlagsBits.EmbedLinks |
  PermissionFlagsBits.AddReactions |
  PermissionFlagsBits.UseExternalEmojis |
  PermissionFlagsBits.SendPolls |
  PermissionFlagsBits.PinMessages;

export type ConnectionStatus = { state: 'off' | 'connecting' | 'online' | 'error'; message?: string };
/** The live connections (a stub until connections exist; see ./connections). */
export interface DiscordConnectionControl {
  status(agentId: string): ConnectionStatus;
  restart(agentId: string): Promise<void>;
  stop(agentId: string): Promise<void>;
  /** What Discord shows for the bot now (its status), if set. */
  presence?(agentId: string): { status: string } | null;
}

const Admission = Type.Union(ADMISSIONS.map(value => Type.Literal(value)));
const Snowflake = Type.String({ pattern: '^\\d{15,21}$' });
const ErrorResponse = Type.Object({ message: Type.String() });
const Channel = Type.Object({
  id: Type.String(),
  guildId: Type.Union([Type.String(), Type.Null()]),
  guildName: Type.Union([Type.String(), Type.Null()]),
  /** A thread's channel. */
  parentId: Type.Union([Type.String(), Type.Null()]),
  name: Type.String(),
  /** How agents and Chat name it: "Swarm Lab › #design", "DM with sam". */
  place: Type.String(),
  kind: Type.String(),
  allowed: Type.Boolean(),
  admission: Type.Union([Admission, Type.Null()]),
  paused: Type.Boolean(),
});
const Config = Type.Object({
  configured: Type.Boolean(),
  status: Type.Object({
    state: Type.Union([Type.Literal('off'), Type.Literal('connecting'), Type.Literal('online'), Type.Literal('error')]),
    message: Type.Optional(Type.String()),
  }),
  bot: Type.Union([Type.Object({ id: Type.String(), name: Type.String() }), Type.Null()]),
  inviteUrl: Type.Union([Type.String(), Type.Null()]),
  admission: Admission,
  catchUp: Type.Boolean(),
  channels: Type.Array(Channel),
  /** Who besides the owner and our agents may DM this bot (a whitelist). */
  dmAllowed: Type.Array(Type.Object({ id: Type.String(), name: Type.String() })),
  /** The status the agent chose (discord_set_status), what Discord shows now, and its custom status text. */
  presence: Type.Object({
    mode: Type.String(),
    showing: Type.Union([Type.String(), Type.Null()]),
    text: Type.String(),
  }),
});
const Person = Type.Object({ id: Snowflake, name: Type.String({ maxLength: 80 }) }, { additionalProperties: false });
const Transcript = Type.Object({
  channel: Type.Object({ id: Type.String(), place: Type.String(), kind: Type.String() }),
  messages: Type.Array(
    Type.Object({
      id: Type.String(),
      authorId: Type.String(),
      authorName: Type.String(),
      /** "you" is the agent's own bot; "agent" another of our agents' bots. */
      role: Type.Union(['you', 'owner', 'agent', 'bot', 'person'].map(value => Type.Literal(value))),
      agentId: Type.Optional(Type.String()),
      text: Type.String(),
      timestamp: Type.Number(),
      edited: Type.Boolean(),
      deleted: Type.Boolean(),
      replyTo: Type.Union([
        Type.Object({ id: Type.String(), authorName: Type.String(), owner: Type.Boolean(), text: Type.String() }),
        Type.Null(),
      ]),
      attachments: Type.Array(Type.Object({ name: Type.String(), size: Type.Number() })),
      files: Type.Optional(Type.Array(FileSchema)),
    }),
  ),
  /** Pass as `before` for the previous page; null at the start of what was saved. */
  nextCursor: Type.Union([Type.String(), Type.Null()]),
});
const TRANSCRIPT_PAGE = 50;
const attachmentsOf = (saved: string | null): { name: string; size: number }[] => {
  try {
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};
const Owner = Type.Object({
  accounts: Type.Array(Type.Object({ id: Snowflake, name: Type.String({ maxLength: 80 }) })),
});

/** The owner's Discord settings: per-agent bots (token in, status out) and which Discord accounts are the owner. */
export function registerDiscordRoutes(
  app: FastifyInstance,
  database: PlatformStore,
  store: DiscordStore,
  tokens: DiscordTokenStore,
  connections: DiscordConnectionControl,
  files: FileStore,
) {
  const view = async (agentId: string) => {
    const [bot, channels, token, dmAllowed] = await Promise.all([
      store.bot(agentId),
      store.channels(agentId),
      tokens.get(agentId),
      store.dmAllowed(agentId),
    ]);
    return {
      configured: Boolean(token),
      status: token ? connections.status(agentId) : { state: 'off' as const },
      bot: bot.botUserId ? { id: bot.botUserId, name: bot.botName ?? 'Bot' } : null,
      // A bot's user ID is its application's client ID.
      inviteUrl: bot.botUserId
        ? `https://discord.com/oauth2/authorize?client_id=${bot.botUserId}&scope=bot&permissions=${BOT_PERMISSIONS}`
        : null,
      admission: bot.admission as (typeof ADMISSIONS)[number],
      catchUp: bot.catchUp,
      presence: {
        mode: bot.presenceMode,
        showing: connections.presence?.(agentId)?.status ?? null,
        text: bot.statusText,
      },
      dmAllowed: dmAllowed.map(person => ({ id: person.discordUserId, name: person.name })),
      channels: channels.map(channel => ({
        id: channel.channelId,
        guildId: channel.guildId,
        guildName: channel.guildName,
        parentId: channel.parentId,
        name: channel.name,
        place: placeOf(channel),
        kind: channel.kind,
        allowed: channel.allowed,
        admission: (channel.admission as (typeof ADMISSIONS)[number] | null) ?? null,
        paused: Boolean(channel.pausedAt),
      })),
    };
  };
  const agent = async (reply: FastifyReply, id: string) => {
    reply.header('Cache-Control', 'no-store');
    if (await database.findAgent(id)) return true;
    reply.code(404).send({ message: 'Agent not found.' });
    return false;
  };
  const fail = (reply: FastifyReply, error: unknown) => {
    if (error instanceof DiscordSettingsError || (error instanceof Error && /Discord bot token/.test(error.message)))
      return reply.code(400).send({ message: error.message });
    throw error;
  };
  const Params = Type.Object({ id: Type.String({ minLength: 1, maxLength: 100 }) });

  app.get<{ Params: { id: string } }>(
    '/api/agents/:id/discord',
    { schema: { operationId: 'getAgentDiscord', params: Params, response: { 200: Config, 404: ErrorResponse } } },
    async (request, reply) => ((await agent(reply, request.params.id)) ? view(request.params.id) : reply),
  );
  app.put<{ Params: { id: string }; Body: { token: string } }>(
    '/api/agents/:id/discord/token',
    {
      schema: {
        operationId: 'setAgentDiscordToken',
        params: Params,
        body: Type.Object({ token: Type.String({ minLength: 1, maxLength: 200 }) }, { additionalProperties: false }),
        response: { 200: Config, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request, reply) => {
      if (!(await agent(reply, request.params.id))) return reply;
      try {
        await tokens.set(request.params.id, request.body.token.trim());
      } catch (error) {
        return fail(reply, error);
      }
      await connections.restart(request.params.id);
      return view(request.params.id);
    },
  );
  app.delete<{ Params: { id: string } }>(
    '/api/agents/:id/discord/token',
    {
      schema: { operationId: 'removeAgentDiscordToken', params: Params, response: { 200: Config, 404: ErrorResponse } },
    },
    async (request, reply) => {
      if (!(await agent(reply, request.params.id))) return reply;
      await connections.stop(request.params.id);
      await tokens.remove(request.params.id);
      return view(request.params.id);
    },
  );
  app.patch<{
    Params: { id: string };
    Body: {
      admission?: (typeof ADMISSIONS)[number];
      catchUp?: boolean;
      channels?: { id: string; allowed: boolean; admission?: (typeof ADMISSIONS)[number] | null }[];
      dmAllowed?: { id: string; name: string }[];
    };
  }>(
    '/api/agents/:id/discord',
    {
      schema: {
        operationId: 'updateAgentDiscord',
        params: Params,
        body: Type.Object(
          {
            admission: Type.Optional(Admission),
            catchUp: Type.Optional(Type.Boolean()),
            dmAllowed: Type.Optional(Type.Array(Person, { maxItems: 500 })),
            channels: Type.Optional(
              Type.Array(
                Type.Object(
                  {
                    id: Snowflake,
                    allowed: Type.Boolean(),
                    admission: Type.Optional(Type.Union([Admission, Type.Null()])),
                  },
                  { additionalProperties: false },
                ),
                { maxItems: 500 },
              ),
            ),
          },
          { additionalProperties: false, minProperties: 1 },
        ),
        response: { 200: Config, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request, reply) => {
      if (!(await agent(reply, request.params.id))) return reply;
      try {
        await store.update(request.params.id, {
          ...request.body,
          channels: request.body.channels?.map(({ id, ...channel }) => ({ channelId: id, ...channel })),
        });
      } catch (error) {
        return fail(reply, error);
      }
      return view(request.params.id);
    },
  );

  // The dashboard's read-only view of what the agent's bot saw in one channel (humans post through agents).
  app.get<{ Params: { id: string; channelId: string }; Querystring: { before?: string } }>(
    '/api/agents/:id/discord/channels/:channelId/messages',
    {
      schema: {
        operationId: 'getAgentDiscordMessages',
        params: Type.Object({ id: Type.String({ minLength: 1, maxLength: 100 }), channelId: Snowflake }),
        querystring: Type.Object({ before: Type.Optional(Snowflake) }, { additionalProperties: false }),
        response: { 200: Transcript, 404: ErrorResponse },
      },
    },
    async (request, reply) => {
      const { id, channelId } = request.params;
      if (!(await agent(reply, id))) return;
      const channel = await store.channel(id, channelId);
      if (!channel) return reply.code(404).send({ message: 'This bot has not seen that channel.' });
      const header = { id: channelId, place: placeOf(channel), kind: channel.kind };
      const before = request.query.before ? await store.messageTime(id, request.query.before) : null;
      // The oldest loaded message is the first one pruning deletes: past it, there is nothing older left.
      if (request.query.before && !before) return { channel: header, messages: [], nextCursor: null };
      const rows = await database.client.discordMessage.findMany({
        where: {
          agentId: id,
          channelId,
          ...(before
            ? { OR: [{ createdAt: { lt: before } }, { createdAt: before, id: { lt: request.query.before } }] }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: TRANSCRIPT_PAGE + 1,
      });
      const page = rows.slice(0, TRANSCRIPT_PAGE).reverse();
      const bot = await store.bot(id);
      const replies = new Map(
        (
          await database.client.discordMessage.findMany({
            where: { agentId: id, id: { in: page.flatMap(row => (row.replyToId ? [row.replyToId] : [])) } },
            select: { id: true, authorId: true, authorName: true, content: true },
          })
        ).map(row => [row.id, row]),
      );
      // As this agent knows them: another person's accounts and bots are people here (docs/users.md).
      const people = new Map(
        (
          await store.accountsFor(
            id,
            [...page, ...replies.values()].map(row => row.authorId),
          )
        ).map(account => [account.discordUserId, account]),
      );
      const opened = await files.forMessages(
        'discord',
        page.map(row => row.id),
      );
      return {
        channel: header,
        messages: page.map(row => {
          const account = people.get(row.authorId);
          const reply = row.replyToId ? replies.get(row.replyToId) : undefined;
          const shown = opened.get(row.id);
          return {
            id: row.id,
            authorId: row.authorId,
            authorName: row.authorName,
            role: row.authorId === bot.botUserId ? ('you' as const) : authorRole(account, row.authorBot),
            ...(account?.role === 'agent' && account.agentId ? { agentId: account.agentId } : {}),
            text: row.content,
            timestamp: row.createdAt.getTime(),
            edited: Boolean(row.editedAt),
            deleted: Boolean(row.deletedAt),
            replyTo: row.replyToId
              ? {
                  id: row.replyToId,
                  authorName: reply?.authorName ?? 'someone',
                  owner: people.get(reply?.authorId ?? '')?.role === 'owner',
                  text: reply ? messageText(reply.content, 0, 200).text : '',
                }
              : null,
            attachments: attachmentsOf(row.attachments),
            ...(shown?.length ? { files: shown } : {}),
          };
        }),
        nextCursor: rows.length > TRANSCRIPT_PAGE ? page[0].id : null,
      };
    },
  );
  // People this agent's bot has seen, for choosing whom to allow DMs from.
  app.get<{ Params: { id: string }; Querystring: { search?: string } }>(
    '/api/agents/:id/discord/people',
    {
      schema: {
        operationId: 'getAgentDiscordPeople',
        params: Params,
        querystring: Type.Object(
          { search: Type.Optional(Type.String({ maxLength: 80 })) },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            people: Type.Array(Type.Object({ id: Type.String(), name: Type.String(), bot: Type.Boolean() })),
          }),
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      if (!(await agent(reply, request.params.id))) return reply;
      return { people: await store.people(request.params.id, request.query.search) };
    },
  );
  app.get(
    '/api/discord/owner',
    { schema: { operationId: 'getDiscordOwner', response: { 200: Owner } } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const accounts = await store.ownerAccounts(viewerOf(request).userId);
      return { accounts: accounts.map(row => ({ id: row.discordUserId, name: row.name })) };
    },
  );
  app.put<{ Body: { accounts: { id: string; name: string }[] } }>(
    '/api/discord/owner',
    {
      schema: {
        operationId: 'setDiscordOwner',
        body: Type.Object(
          {
            accounts: Type.Array(Type.Object({ id: Snowflake, name: Type.String({ maxLength: 80 }) }), {
              maxItems: 20,
            }),
          },
          { additionalProperties: false },
        ),
        response: { 200: Owner, 400: ErrorResponse },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        const accounts = await store.setOwnerAccounts(request.body.accounts, viewerOf(request).userId);
        return { accounts: accounts.map(row => ({ id: row.discordUserId, name: row.name })) };
      } catch (error) {
        return fail(reply, error);
      }
    },
  );
}
