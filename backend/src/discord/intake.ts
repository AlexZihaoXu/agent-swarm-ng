import {
  GatewayDispatchEvents,
  MessageType,
  type APIMessage,
  type GatewayMessageCreateDispatchData,
} from 'discord-api-types/v10';
import type { PlatformStore } from '../platform-store';
import type { ChannelMessage } from '../chat-runtime';
import { messageText } from '../message-text';
import { triageGate } from '../triage-gate';
import type { DiscordEvent } from './connections';
import type { Admission, DiscordStore } from './store';

export type IntakeOptions = {
  /** Each message restarts this quiet period. */
  quietMs?: number;
  /** A batch never waits longer than this from its first message. */
  capMs?: number;
  /** Messages a trigger shows in full; the rest become "+N more". */
  fullMessages?: number;
  /** Consecutive bot-only turns in a channel before the agent pauses there until a person speaks. */
  botTurnLimit?: number;
};
type Role = 'owner' | 'agent' | 'bot' | 'person';
export type Seen = {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  authorBot: boolean;
  role: Role;
  /** Which of our agents wrote it, when the author is one of our bots. */
  authorAgentId?: string;
  content: string;
  createdAt: Date;
  addressed: boolean;
  replyTo?: { id: string; author: string; text: string };
  attachments: { name: string; size: number }[];
};
type Batch = { agentId: string; channelId: string; messages: Seen[]; closedAt: number };
type Window = { messages: Seen[]; quiet: ReturnType<typeof setTimeout>; cap: ReturnType<typeof setTimeout> };

export type IntakeDeps = {
  /** Hands an admitted trigger to the agent (its inbox; interruption triage applies there). */
  deliver: (agentId: string, input: ChannelMessage) => void;
  /** The "check" admission policy: a decision-only model branch; failures mean ignore. */
  evaluate?: (agentId: string, channelId: string, notice: string) => Promise<'admit' | 'ignore'>;
};

const size = (bytes: number) =>
  bytes < 1024 ** 2 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
const clock = (date: Date) => date.toISOString().slice(11, 19);
const roleLabel = (message: Seen) =>
  message.role === 'owner'
    ? 'your owner'
    : message.role === 'agent'
      ? `agent ${message.authorName}`
      : message.role === 'bot'
        ? 'bot'
        : 'person';

/**
 * Turns Discord messages into agent inputs. Per channel, a batch collects messages until 3 s pass without a new
 * one, or 10 s after its first message. Each agent handles one batch at a time (addressed batches first), and its
 * triage never runs in parallel. A trigger shows a bounded number of messages; the rest become "+N more" with a
 * read hint: the agent reads the chat itself.
 */
export class DiscordIntake {
  private windows = new Map<string, Window>();
  private queues = new Map<string, Batch[]>();
  private pumping = new Set<string>();
  private closed = false;
  private readonly quietMs: number;
  private readonly capMs: number;
  private readonly fullMessages: number;
  private readonly botTurnLimit: number;

  constructor(
    private database: PlatformStore,
    private store: DiscordStore,
    private deps: IntakeDeps,
    options: IntakeOptions = {},
  ) {
    this.quietMs = options.quietMs ?? 3000;
    this.capMs = options.capMs ?? 10_000;
    this.fullMessages = options.fullMessages ?? 10;
    this.botTurnLimit = options.botTurnLimit ?? 8;
  }

  async handle(event: DiscordEvent) {
    if (this.closed) return;
    if (event.payload.t === GatewayDispatchEvents.MessageCreate)
      await this.message(event.agentId, event.botUserId, event.payload.d);
  }
  /** Waits for nothing: pending windows are dropped (their messages stay saved and read as unread). */
  close() {
    this.closed = true;
    for (const window of this.windows.values()) {
      clearTimeout(window.quiet);
      clearTimeout(window.cap);
    }
    this.windows.clear();
  }

  /** Where a message may be seen by this agent, and how it is admitted; null means the agent never sees it. */
  private async place(agentId: string, data: GatewayMessageCreateDispatchData, role: Role) {
    const bot = await this.store.bot(agentId);
    if (!data.guild_id) {
      // A DM with the bot: always the owner and our agents; other people only if the owner allows it.
      if ((role === 'person' || role === 'bot') && !bot.strangerDms) return null;
      await this.store.discovered(agentId, [
        { channelId: data.channel_id, guildId: null, guildName: null, name: data.author.username, kind: 'dm' },
      ]);
      return { admission: 'all' as Admission, dm: true };
    }
    const channel = await this.store.channel(agentId, data.channel_id);
    if (!channel) return null;
    const parent =
      !channel.allowed && channel.kind === 'thread' && channel.parentId
        ? await this.store.channel(agentId, channel.parentId)
        : null;
    if (!channel.allowed && !parent?.allowed) return null;
    return {
      admission: (channel.admission ?? parent?.admission ?? bot.admission) as Admission,
      dm: false,
    };
  }

  private async message(agentId: string, botUserId: string, data: GatewayMessageCreateDispatchData) {
    // Its own messages are recorded when it sends them; system notices are not conversation.
    if (data.author.id === botUserId) return;
    if (data.type !== MessageType.Default && data.type !== MessageType.Reply) return;
    const account = await this.store.who(data.author.id);
    const role: Role =
      account?.role === 'owner' ? 'owner' : account?.role === 'agent' ? 'agent' : data.author.bot ? 'bot' : 'person';
    const place = await this.place(agentId, data, role);
    if (!place) return;
    const reference = data.referenced_message as APIMessage | null | undefined;
    const seen: Seen = {
      id: data.id,
      channelId: data.channel_id,
      authorId: data.author.id,
      authorName: data.member?.nick ?? data.author.global_name ?? data.author.username,
      authorBot: Boolean(data.author.bot),
      role,
      ...(account?.role === 'agent' && account.agentId ? { authorAgentId: account.agentId } : {}),
      content: data.content,
      createdAt: new Date(data.timestamp),
      addressed:
        role === 'owner' ||
        place.dm ||
        data.mentions.some(user => user.id === botUserId) ||
        reference?.author?.id === botUserId,
      ...(reference
        ? {
            replyTo: {
              id: reference.id,
              author: reference.author?.global_name ?? reference.author?.username ?? 'someone',
              text: messageText(reference.content ?? '', 0, 200).text,
            },
          }
        : {}),
      attachments: data.attachments.map(file => ({ name: file.filename, size: file.size })),
    };
    await this.database.client.discordMessage.upsert({
      where: { agentId_id: { agentId, id: seen.id } },
      create: {
        agentId,
        id: seen.id,
        channelId: seen.channelId,
        guildId: data.guild_id ?? null,
        authorId: seen.authorId,
        authorName: seen.authorName,
        authorBot: seen.authorBot,
        content: seen.content,
        replyToId: reference?.id ?? null,
        mentionsBot: seen.addressed && !place.dm && role !== 'owner',
        attachments: seen.attachments.length ? JSON.stringify(seen.attachments) : null,
        createdAt: seen.createdAt,
      },
      update: {},
    });
    this.collect(agentId, seen);
  }

  private collect(agentId: string, seen: Seen) {
    const key = `${agentId}:${seen.channelId}`;
    const existing = this.windows.get(key);
    if (existing) {
      existing.messages.push(seen);
      clearTimeout(existing.quiet);
      existing.quiet = setTimeout(() => this.closeWindow(agentId, seen.channelId), this.quietMs);
      return;
    }
    const window: Window = {
      messages: [seen],
      quiet: setTimeout(() => this.closeWindow(agentId, seen.channelId), this.quietMs),
      cap: setTimeout(() => this.closeWindow(agentId, seen.channelId), this.capMs),
    };
    this.windows.set(key, window);
  }
  private closeWindow(agentId: string, channelId: string) {
    const key = `${agentId}:${channelId}`;
    const window = this.windows.get(key);
    if (!window) return;
    this.windows.delete(key);
    clearTimeout(window.quiet);
    clearTimeout(window.cap);
    const queue = this.queues.get(agentId) ?? [];
    queue.push({ agentId, channelId, messages: window.messages, closedAt: Date.now() });
    this.queues.set(agentId, queue);
    void this.pump(agentId);
  }

  /** One batch at a time per agent: batches addressed to it first, then the oldest. */
  private async pump(agentId: string) {
    if (this.pumping.has(agentId)) return;
    this.pumping.add(agentId);
    try {
      while (!this.closed) {
        const queue = this.queues.get(agentId) ?? [];
        if (!queue.length) break;
        const index = Math.max(
          0,
          queue.findIndex(batch => batch.messages.some(message => message.addressed)),
        );
        const [batch] = queue.splice(index, 1);
        await this.process(batch).catch(() => {});
      }
    } finally {
      this.pumping.delete(agentId);
      if (!this.queues.get(agentId)?.length) this.queues.delete(agentId);
    }
  }

  private async process(batch: Batch) {
    const { agentId, channelId } = batch;
    const channel = await this.store.channel(agentId, channelId);
    if (!channel) return;
    const bot = await this.store.bot(agentId);
    const addressed = batch.messages.some(message => message.addressed);
    const people = batch.messages.some(message => !message.authorBot);
    // A person speaking ends a bot loop; a paused channel ignores bots until then.
    if (people && (channel.botOnlyTurns || channel.pausedAt))
      await this.database.client.discordChannel.update({
        where: { agentId_channelId: { agentId, channelId } },
        data: { botOnlyTurns: 0, pausedAt: null },
      });
    else if (channel.pausedAt) return;
    const notice = await this.trigger(batch, channel);
    const admission = channel.kind === 'dm' ? 'all' : ((channel.admission ?? bot.admission) as Admission);
    let admitted = addressed || admission === 'all';
    if (!admitted && admission === 'check' && this.deps.evaluate) {
      const evaluate = this.deps.evaluate;
      admitted = (await triageGate(agentId, () => evaluate(agentId, channelId, notice.text))) === 'admit';
    }
    if (!admitted) return; // saved; it reads as unread until the agent looks
    const newest = batch.messages.at(-1)!;
    const botsOnly = !people;
    const turns = botsOnly ? channel.botOnlyTurns + 1 : 0;
    await this.database.client.discordChannel.update({
      where: { agentId_channelId: { agentId, channelId } },
      data: {
        announcedUpTo: newest.id,
        ...(botsOnly ? { botOnlyTurns: turns, ...(turns >= this.botTurnLimit ? { pausedAt: new Date() } : {}) } : {}),
      },
    });
    const pause =
      botsOnly && turns >= this.botTurnLimit
        ? `\n[Only bots have spoken here for ${turns} turns in a row: you will not be woken by bots in this channel again until a person speaks.]`
        : '';
    const owner = batch.messages.some(message => message.role === 'owner');
    const agentAuthor = [...batch.messages].reverse().find(message => message.authorAgentId);
    const chainId =
      owner || !agentAuthor
        ? ''
        : ((
            await this.database.client.discordMessage.findUnique({
              where: { agentId_id: { agentId: agentAuthor.authorAgentId!, id: agentAuthor.id } },
              select: { chainId: true },
            })
          )?.chainId ?? '');
    this.deps.deliver(agentId, {
      role: 'user',
      id: crypto.randomUUID(),
      text: notice.text + pause,
      timestamp: Date.now(),
      source: {
        agentId: agentAuthor?.authorAgentId ?? `discord:${newest.authorId}`,
        name: owner ? 'Human' : newest.authorName,
        channelId: `discord:${channelId}`,
        chainId,
        messageId: newest.id,
        ...(owner ? { human: true } : {}),
        discord: { place: notice.place },
      },
    });
  }

  /** The bounded text of a trigger: some messages in full (addressed first), then "+N more" with a read hint. */
  private async trigger(batch: Batch, channel: NonNullable<Awaited<ReturnType<DiscordStore['channel']>>>) {
    const { agentId, channelId } = batch;
    const previous = channel.announcedUpTo
      ? await this.database.client.discordMessage.findUnique({
          where: { agentId_id: { agentId, id: channel.announcedUpTo } },
          select: { createdAt: true },
        })
      : null;
    const unread = await this.database.client.discordMessage.findMany({
      where: await this.store.unreadWhere(agentId, channelId, channel.announcedUpTo),
      select: { authorName: true },
      take: 10_000,
    });
    const addressed = batch.messages.filter(message => message.addressed).slice(-this.fullMessages);
    const others = batch.messages
      .filter(message => !message.addressed)
      .slice(-Math.max(0, this.fullMessages - addressed.length));
    const shown = [...addressed, ...others].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const lines = shown.map(message => {
      const body = messageText(message.content, 0, 1500);
      return [
        `${clock(message.createdAt)} · ${message.authorName} (${roleLabel(message)}) · message ${message.id}:${
          message.replyTo
            ? ` [replying to ${message.replyTo.author}'s message ${message.replyTo.id}: ${JSON.stringify(message.replyTo.text)}]`
            : ''
        } ${body.text || '(no text)'}${body.truncated ? ' […]' : ''}`,
        ...(message.attachments.length
          ? [`  [attachments: ${message.attachments.map(file => `${file.name} (${size(file.size)})`).join(', ')}]`]
          : []),
      ].join('\n');
    });
    const more = Math.max(0, unread.length - shown.length);
    if (more) {
      const counts = new Map<string, number>();
      for (const row of unread) counts.set(row.authorName, (counts.get(row.authorName) ?? 0) + 1);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      lines.push(
        `+${more} more message${more === 1 ? '' : 's'} in this channel${previous ? ` since ${clock(previous.createdAt)}` : ''} (${counts.size} author${counts.size === 1 ? '' : 's'}, most from ${top[0]}). Read them with discord_read_messages(${JSON.stringify({ channelId: `discord:${channelId}`, ...(channel.announcedUpTo ? { after: channel.announcedUpTo } : {}) })}).`,
      );
    }
    const place =
      channel.kind === 'dm'
        ? `DM with ${channel.name}`
        : `${channel.guildName ?? 'Server'} › ${channel.kind === 'thread' ? channel.name : `#${channel.name}`}`;
    return { text: lines.join('\n'), place };
  }
}
