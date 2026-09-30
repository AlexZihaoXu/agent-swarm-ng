import { REST, DiscordAPIError } from '@discordjs/rest';
import { WebSocketManager, WebSocketShardEvents } from '@discordjs/ws';
import { API } from '@discordjs/core/http-only';
import {
  ChannelType,
  GatewayCloseCodes,
  GatewayDispatchEvents,
  GatewayIntentBits,
  type GatewayDispatchPayload,
  type APIChannel,
} from 'discord-api-types/v10';
import type { ConnectionStatus, DiscordConnectionControl } from './routes';
import type { DiscordStore, DiscoveredChannel } from './store';
import type { DiscordTokenStore } from './token-store';

/** Messages, DMs, their text, reactions and polls: what a member sees. No presence or member lists. */
export const INTENTS =
  GatewayIntentBits.Guilds |
  GatewayIntentBits.GuildMessages |
  GatewayIntentBits.DirectMessages |
  GatewayIntentBits.MessageContent |
  GatewayIntentBits.GuildMessageReactions |
  GatewayIntentBits.DirectMessageReactions |
  GatewayIntentBits.GuildMessagePolls |
  GatewayIntentBits.DirectMessagePolls;

const RETRY_MS = [30_000, 60_000, 5 * 60_000, 15 * 60_000];

/** What the rest of the backend receives from a bot: Discord's own dispatch, tagged with the agent it belongs to. */
export type DiscordEvent = { agentId: string; botUserId: string; payload: GatewayDispatchPayload };

type Connection = {
  status: ConnectionStatus;
  api?: API;
  rest?: REST;
  gateway?: WebSocketManager;
  botUserId?: string;
  retry?: ReturnType<typeof setTimeout>;
  attempts: number;
  generation: number;
  /** Set by a failure retrying cannot fix (a refused token, a missing intent). */
  fatal?: boolean;
};

export function channelKind(type: ChannelType) {
  switch (type) {
    case ChannelType.DM:
      return 'dm';
    case ChannelType.GuildAnnouncement:
      return 'announcement';
    case ChannelType.PublicThread:
    case ChannelType.PrivateThread:
    case ChannelType.AnnouncementThread:
      return 'thread';
    case ChannelType.GuildForum:
    case ChannelType.GuildMedia:
      return 'forum';
    case ChannelType.GuildVoice:
    case ChannelType.GuildStageVoice:
      return 'voice';
    case ChannelType.GuildCategory:
      return 'category';
    default:
      return 'text';
  }
}

/**
 * One live Discord bot per configured agent, owned by the backend (never by a browser). A token Discord refuses
 * (401, or Gateway close 4004) stops that bot and says so, with no retries: failed requests count toward Discord's
 * IP block. Other failures back off and retry; the Gateway library resumes short drops by itself.
 */
export class DiscordConnections implements DiscordConnectionControl {
  private live = new Map<string, Connection>();
  private closing = false;
  /** Receives every dispatch from every bot (the intake decides what reaches an agent). */
  onEvent?: (event: DiscordEvent) => void;

  constructor(
    private tokens: DiscordTokenStore,
    private store: DiscordStore,
    private options: { api?: string } = {},
  ) {}

  status(agentId: string): ConnectionStatus {
    return this.live.get(agentId)?.status ?? { state: 'off' };
  }
  /** The bot's REST client, for tools. Throws when the bot is not online. */
  api(agentId: string) {
    const connection = this.live.get(agentId);
    if (!connection?.api || connection.status.state !== 'online')
      throw new Error('This agent’s Discord bot is not connected.');
    return { api: connection.api, rest: connection.rest!, botUserId: connection.botUserId! };
  }
  botUserId(agentId: string) {
    return this.live.get(agentId)?.botUserId;
  }

  /** Connects every agent that has a saved token. */
  async start() {
    for (const agentId of Object.keys(await this.tokens.read())) void this.restart(agentId);
  }
  async restart(agentId: string) {
    await this.stop(agentId);
    if (this.closing) return;
    const connection: Connection = { status: { state: 'connecting' }, attempts: 0, generation: 0 };
    this.live.set(agentId, connection);
    // Connecting runs in the background: the status says how it is going.
    void this.connect(agentId, connection).catch(error => {
      if (this.live.get(agentId) === connection)
        this.scheduleRetry(
          agentId,
          connection,
          error instanceof Error ? error.message : 'Discord could not be reached.',
        );
    });
  }
  async stop(agentId: string) {
    const connection = this.live.get(agentId);
    if (!connection) return;
    this.live.delete(agentId);
    connection.generation++;
    clearTimeout(connection.retry);
    await Promise.resolve(connection.gateway?.destroy()).catch(() => {});
  }
  async close() {
    this.closing = true;
    await Promise.all([...this.live.keys()].map(agentId => this.stop(agentId)));
  }

  private fail(connection: Connection, message: string) {
    connection.fatal = true;
    connection.status = { state: 'error', message };
    connection.api = undefined;
  }
  private scheduleRetry(agentId: string, connection: Connection, message: string) {
    connection.status = { state: 'error', message: `${message} Retrying…` };
    const delay = RETRY_MS[Math.min(connection.attempts, RETRY_MS.length - 1)];
    connection.attempts++;
    const generation = connection.generation;
    connection.retry = setTimeout(() => {
      if (this.live.get(agentId) === connection && connection.generation === generation)
        void this.connect(agentId, connection);
    }, delay);
    connection.retry.unref?.();
  }

  private async connect(agentId: string, connection: Connection) {
    const generation = connection.generation;
    const current = () => this.live.get(agentId) === connection && connection.generation === generation;
    const token = await this.tokens.get(agentId);
    if (!token) return void this.live.delete(agentId);
    connection.status = { state: 'connecting' };
    const rest = new REST({ version: '10', ...(this.options.api ? { api: this.options.api } : {}) }).setToken(token);
    const api = new API(rest);
    let me;
    try {
      me = await api.users.getCurrent();
    } catch (error) {
      if (!current()) return;
      if (error instanceof DiscordAPIError && error.status === 401)
        return this.fail(
          connection,
          'Discord refused this token. Paste the bot token again from the Developer Portal.',
        );
      return this.scheduleRetry(agentId, connection, 'Discord could not be reached.');
    }
    if (!current()) return;
    connection.rest = rest;
    connection.botUserId = me.id;
    await this.store.identify(agentId, me.id, me.global_name ?? me.username);
    const gateway = new WebSocketManager({ token, intents: INTENTS, rest });
    connection.gateway = gateway;
    gateway.on(WebSocketShardEvents.Dispatch, payload => {
      if (!current()) return;
      if (payload.t === GatewayDispatchEvents.Ready) {
        connection.status = { state: 'online' };
        connection.api = api;
        connection.attempts = 0;
      }
      if (payload.t === GatewayDispatchEvents.GuildCreate)
        void this.store
          .discovered(
            agentId,
            guildChannels(payload.d.id, payload.d.name ?? 'Server', [
              ...(payload.d.channels ?? []),
              ...(payload.d.threads ?? []),
            ]),
          )
          .catch(() => {});
      if (payload.t === GatewayDispatchEvents.ChannelCreate || payload.t === GatewayDispatchEvents.ThreadCreate)
        void this.store
          .discovered(agentId, guildChannels(payload.d.guild_id ?? null, null, [payload.d]))
          .catch(() => {});
      this.onEvent?.({ agentId, botUserId: me.id, payload });
    });
    // The library reports fatal close codes as errors (and recovers from the rest by itself).
    const fatal: Record<string, string> = {
      'Authentication failed': 'Discord refused this token. Paste the bot token again from the Developer Portal.',
      'Used disallowed intents':
        'Discord refused the Message Content intent. Turn on “Message Content Intent” for this bot in the Developer Portal (Bot → Privileged Gateway Intents), then save the token again.',
    };
    gateway.on(WebSocketShardEvents.Error, error => {
      if (!current()) return;
      const message = fatal[error.message];
      if (message) {
        this.fail(connection, message);
        void Promise.resolve(gateway.destroy()).catch(() => {});
      }
    });
    gateway.on(WebSocketShardEvents.Closed, code => {
      if (!current()) return;
      if (code === GatewayCloseCodes.AuthenticationFailed)
        return this.fail(
          connection,
          'Discord refused this token. Paste the bot token again from the Developer Portal.',
        );
      if (code === GatewayCloseCodes.DisallowedIntents)
        return this.fail(
          connection,
          'Discord refused the Message Content intent. Turn on “Message Content Intent” for this bot in the Developer Portal (Bot → Privileged Gateway Intents), then save the token again.',
        );
      if (
        code === GatewayCloseCodes.InvalidIntents ||
        code === GatewayCloseCodes.InvalidShard ||
        code === GatewayCloseCodes.ShardingRequired
      )
        return this.fail(connection, `Discord closed the connection (${code}).`);
      connection.status = { state: 'connecting' };
    });
    try {
      await gateway.connect();
    } catch {
      if (current() && !connection.fatal)
        this.scheduleRetry(agentId, connection, 'The Discord Gateway could not be reached.');
    }
  }
}

/** Channels a bot can see in a server (categories are only grouping, not places to talk). */
function guildChannels(
  guildId: string | null,
  guildName: string | null,
  channels: Partial<APIChannel>[],
): DiscoveredChannel[] {
  return channels.flatMap(channel => {
    if (!channel.id || channel.type === undefined) return [];
    const kind = channelKind(channel.type);
    if (kind === 'category' || kind === 'voice') return [];
    return [
      {
        channelId: channel.id,
        guildId,
        guildName,
        parentId: ('parent_id' in channel && channel.parent_id) || null,
        name: ('name' in channel && channel.name) || 'channel',
        kind,
      },
    ];
  });
}
