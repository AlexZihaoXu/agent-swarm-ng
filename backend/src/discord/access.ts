import type { REST } from '@discordjs/rest';
import { DiscordAPIError, HTTPError, RateLimitError } from '@discordjs/rest';
import { MessageType, type APIMessage } from 'discord-api-types/v10';
import { messageText } from '../message-text';
import type { DiscordConnections } from './connections';
import type { DiscordStore } from './store';

/** What one agent's Discord tools share: its bot, the owner's policies, and the channel check. */
export type DiscordToolContext = {
  agentId: string;
  store: DiscordStore;
  connections: DiscordConnections;
};

export const channelArg = (value: string) => value.replace(/^discord:/, '');

/**
 * A channel this agent may use (see DiscordStore.usable). Checked on every call, so revoking a channel takes effect at once.
 */
export async function allowedChannel(context: DiscordToolContext, raw: string) {
  const channel = await context.store.usable(context.agentId, channelArg(raw));
  if (channel) return channel;
  throw new Error('That Discord channel is not one you may use (your owner allows channels in your settings).');
}
/** The DMs this agent may use now, among its channels. */
export async function usableDms(context: DiscordToolContext, channels: { channelId: string; kind: string }[]) {
  const dms = [];
  for (const channel of channels.filter(item => item.kind === 'dm')) {
    const usable = await context.store.usable(context.agentId, channel.channelId);
    if (usable) dms.push(usable);
  }
  return dms;
}
/** Servers where the owner allowed at least one channel for this agent. */
export async function allowedServer(context: DiscordToolContext, serverId: string) {
  const channels = await context.store.channels(context.agentId);
  const allowed = channels.filter(channel => channel.guildId === serverId && channel.allowed);
  if (!allowed.length) throw new Error('That server has no channel you may use.');
  return allowed;
}
export function bot(context: DiscordToolContext) {
  return context.connections.api(context.agentId);
}

/** Discord's errors, said plainly (never raw request details). */
export function discordError(error: unknown): never {
  // Discord down or slow (5xx after the client's retries, or a timeout).
  if (error instanceof HTTPError || (error instanceof Error && error.name === 'AbortError'))
    throw new Error('Discord could not be reached; try again later.');
  if (error instanceof RateLimitError)
    throw new Error(`Discord is rate limiting; try again in ${Math.ceil(error.retryAfter / 1000)} s.`);
  if (error instanceof DiscordAPIError) {
    if (error.status === 401)
      throw new Error('Discord no longer accepts this bot’s token; your owner needs to paste a new one.');
    if (error.status === 403) throw new Error('Discord says you lack permission for that (server settings).');
    if (error.status === 404) throw new Error('Discord could not find that (it may have been deleted).');
    if (error.status === 429) throw new Error('Discord is rate limiting; wait a little and try again.');
    throw new Error(`Discord refused that request (${error.status}): ${error.message.slice(0, 200)}`);
  }
  throw error;
}
export async function call<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    discordError(error);
  }
}

export type Who = (userId: string) => Promise<string>;
/** How a Discord author appears to agents: the platform decides, not the message. */
export function whoIs(context: DiscordToolContext, botUserId: string): Who {
  const cache = new Map<string, string>();
  return async userId => {
    if (userId === botUserId) return 'you';
    if (!cache.has(userId)) {
      const account = await context.store.who(userId, context.agentId);
      cache.set(userId, account?.role === 'owner' ? 'your owner' : account?.role === 'agent' ? 'agent' : '');
    }
    return cache.get(userId)!;
  };
}

const SYSTEM: Partial<Record<MessageType, string>> = {
  [MessageType.ChannelPinnedMessage]: 'pinned a message',
  [MessageType.ThreadCreated]: 'started a thread',
  [MessageType.UserJoin]: 'joined the server',
  [MessageType.PollResult]: 'poll ended',
  [MessageType.ThreadStarterMessage]: 'thread starter',
};

/** A message as a person sees it in the app, bounded like the platform's own history tools. */
export async function messageView(message: APIMessage, who: Who, offset = 0, length = 1000) {
  const role = await who(message.author.id);
  const text = messageText(message.content ?? '', offset, length);
  const snapshot = message.message_snapshots?.[0]?.message;
  return {
    id: message.id,
    time: message.timestamp,
    author: {
      id: message.author.id,
      name: message.author.global_name ?? message.author.username,
      ...(message.author.bot ? { bot: true } : {}),
      ...(role ? { is: role } : {}),
    },
    ...(SYSTEM[message.type] ? { system: SYSTEM[message.type] } : {}),
    ...text,
    ...(message.edited_timestamp ? { edited: true } : {}),
    ...(message.pinned ? { pinned: true } : {}),
    ...(message.referenced_message && message.type === MessageType.Reply
      ? {
          replyTo: {
            id: message.referenced_message.id,
            author: message.referenced_message.author.global_name ?? message.referenced_message.author.username,
            text: messageText(message.referenced_message.content ?? '', 0, 200).text,
          },
        }
      : {}),
    ...(snapshot
      ? { forwarded: { text: messageText(snapshot.content ?? '', 0, 500).text, time: snapshot.timestamp } }
      : {}),
    ...(message.attachments.length
      ? {
          attachments: message.attachments.map(file => ({
            id: file.id,
            name: file.filename,
            size: file.size,
            ...(file.content_type ? { type: file.content_type } : {}),
          })),
        }
      : {}),
    ...(message.reactions?.length
      ? {
          reactions: message.reactions.map(reaction => ({
            emoji: reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name,
            count: reaction.count,
            ...(reaction.me ? { mine: true } : {}),
          })),
        }
      : {}),
    ...(message.poll
      ? {
          poll: {
            question: message.poll.question.text,
            answers: message.poll.answers.map(answer => ({
              id: answer.answer_id,
              text: answer.poll_media.text,
              votes: message.poll!.results?.answer_counts.find(count => count.id === answer.answer_id)?.count ?? 0,
            })),
            ...(message.poll.results?.is_finalized ? { ended: true } : { endsAt: message.poll.expiry }),
          },
        }
      : {}),
    ...(message.thread ? { thread: { id: message.thread.id, name: message.thread.name } } : {}),
  };
}
export type RestClient = REST;
