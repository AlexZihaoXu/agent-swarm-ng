import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { PermissionFlagsBits } from 'discord-api-types/v10';
import type { PlatformStore } from '../platform-store';
import { ADMISSIONS, DiscordSettingsError, type DiscordStore } from './store';
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
}

const Admission = Type.Union(ADMISSIONS.map(value => Type.Literal(value)));
const Snowflake = Type.String({ pattern: '^\\d{15,21}$' });
const ErrorResponse = Type.Object({ message: Type.String() });
const Channel = Type.Object({
  id: Type.String(),
  guildId: Type.Union([Type.String(), Type.Null()]),
  guildName: Type.Union([Type.String(), Type.Null()]),
  name: Type.String(),
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
  strangerDms: Type.Boolean(),
  catchUp: Type.Boolean(),
  channels: Type.Array(Channel),
});
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
) {
  const view = async (agentId: string) => {
    const [bot, channels, token] = await Promise.all([
      store.bot(agentId),
      store.channels(agentId),
      tokens.get(agentId),
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
      strangerDms: bot.strangerDms,
      catchUp: bot.catchUp,
      channels: channels.map(channel => ({
        id: channel.channelId,
        guildId: channel.guildId,
        guildName: channel.guildName,
        name: channel.name,
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
      strangerDms?: boolean;
      catchUp?: boolean;
      channels?: { id: string; allowed: boolean; admission?: (typeof ADMISSIONS)[number] | null }[];
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
            strangerDms: Type.Optional(Type.Boolean()),
            catchUp: Type.Optional(Type.Boolean()),
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

  app.get(
    '/api/discord/owner',
    { schema: { operationId: 'getDiscordOwner', response: { 200: Owner } } },
    async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return { accounts: (await store.ownerAccounts()).map(row => ({ id: row.discordUserId, name: row.name })) };
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
        const accounts = await store.setOwnerAccounts(request.body.accounts);
        return { accounts: accounts.map(row => ({ id: row.discordUserId, name: row.name })) };
      } catch (error) {
        return fail(reply, error);
      }
    },
  );
}
