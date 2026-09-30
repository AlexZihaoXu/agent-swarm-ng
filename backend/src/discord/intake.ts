import {
  GatewayDispatchEvents,
  MessageType,
  type APIMessage,
  type GatewayMessageCreateDispatchData,
} from 'discord-api-types/v10';
import type { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import type { PlatformStore } from '../platform-store';
import type { ChannelMessage } from '../chat-runtime';
import { messageText } from '../message-text';
import { triageGate } from '../triage-gate';
import type { DiscordEvent } from './connections';
import { authorRole as roleOf, placeOf, type Admission, type AuthorRole, type DiscordStore } from './store';

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
type Role = AuthorRole;
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
  /** Shown beside the message: "edited", "sent while you were offline". */
  note?: string;
};
/** The owner's messages batch apart from everyone else's, so no one else's text ever shares their authority. */
type Lane = 'owner' | 'others';
type Batch = { agentId: string; channelId: string; lane: Lane; messages: Seen[]; closedAt: number };
type Window = { messages: Seen[]; quiet: ReturnType<typeof setTimeout>; cap: ReturnType<typeof setTimeout> };

export type IntakeDeps = {
  /** Hands an admitted trigger to the agent (its inbox; interruption triage applies there). */
  deliver: (agentId: string, input: ChannelMessage, addressed: boolean) => void;
  /** The "check" admission policy: a decision-only model branch; failures mean ignore. */
  evaluate?: (agentId: string, channelId: string, notice: string) => Promise<'admit' | 'ignore'>;
  /** Reaction triage for reactions on the agent's own messages; failures mean ignore. */
  reaction?: (agentId: string, channelId: string, notice: string) => Promise<'engage' | 'ignore'>;
  /** The bot's REST client (catch-up after an outage reads recent history). */
  rest?: (agentId: string) => REST;
};
/** An edit to a message the agent already answered wakes it again only within this time. */
const EDIT_WINDOW_MS = 5 * 60_000;
/** One person's reaction (one emoji) to one message goes to reaction triage at most once in this time. */
const REACTION_WINDOW_MS = 10 * 60_000;
const LANES: Lane[] = ['owner', 'others'];
const laneOf = (message: Seen): Lane => (message.role === 'owner' ? 'owner' : 'others');
const newestOf = (messages: Seen[]) => messages.reduce((a, b) => (BigInt(b.id) > BigInt(a.id) ? b : a));

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
  private reactions = new Map<string, number>();
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
    const { agentId, botUserId, payload } = event;
    const received = new Date();
    switch (payload.t) {
      case GatewayDispatchEvents.MessageCreate:
        return this.message(agentId, botUserId, payload.d);
      case GatewayDispatchEvents.MessageUpdate:
        return this.edited(agentId, botUserId, payload.d);
      case GatewayDispatchEvents.MessageDelete:
        return this.deleted(agentId, payload.d.channel_id, [payload.d.id]);
      case GatewayDispatchEvents.MessageDeleteBulk:
        return this.deleted(agentId, payload.d.channel_id, payload.d.ids);
      case GatewayDispatchEvents.MessageReactionAdd:
        return this.reacted(agentId, botUserId, payload.d);
      case GatewayDispatchEvents.GuildDelete:
        // Removed from a server (not a Discord outage): its channels are no longer the agent's to use.
        if (!payload.d.unavailable) await this.store.forgetServer(agentId, payload.d.id);
        return;
      case GatewayDispatchEvents.Ready:
        // A new session (a restart or a long outage): Discord will not resend what was missed.
        if ((await this.store.bot(agentId)).catchUp) await this.catchUp(agentId, botUserId, received);
        return;
    }
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
  private windowsOf(agentId: string, channelId: string) {
    return LANES.flatMap(lane => this.windows.get(`${agentId}:${channelId}:${lane}`) ?? []);
  }

  /** Where a message may be seen by this agent, and how it is admitted; null means the agent never sees it. */
  private async place(agentId: string, data: GatewayMessageCreateDispatchData, role: Role) {
    if (!data.guild_id) {
      // A DM with the bot: always the owner and our agents; other people only if the owner allows it.
      if ((role === 'person' || role === 'bot') && !(await this.store.bot(agentId)).strangerDms) return null;
      await this.store.discovered(agentId, [
        {
          channelId: data.channel_id,
          guildId: null,
          guildName: null,
          recipientId: data.author.id,
          name: data.author.username,
          kind: 'dm',
        },
      ]);
      return { dm: true };
    }
    return (await this.store.usable(agentId, data.channel_id)) ? { dm: false } : null;
  }

  private async message(
    agentId: string,
    botUserId: string,
    data: GatewayMessageCreateDispatchData,
    options: { catchUp?: boolean } = {},
  ) {
    // Its own messages are recorded when it sends them; system notices are not conversation, except the end of
    // a poll it started.
    if (data.author.id === botUserId) return;
    if (data.type === MessageType.PollResult) return this.pollEnded(agentId, data);
    if (data.type !== MessageType.Default && data.type !== MessageType.Reply) return;
    const account = await this.store.who(data.author.id);
    const role = roleOf(account, Boolean(data.author.bot));
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
      ...(options.catchUp ? { note: 'sent while you were offline' } : {}),
    };
    // Recorded once: a message both caught up on and delivered live wakes the agent once.
    const created = await this.database.client.discordMessage
      .create({
        data: {
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
      })
      .then(
        () => true,
        (error: unknown) => {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') return false;
          throw error;
        },
      );
    if (!created) return;
    // Catching up only wakes the agent for what was addressed to it; the rest reads as unread.
    if (options.catchUp && !seen.addressed) return;
    this.collect(agentId, seen);
  }

  /** The poll the agent started has ended: that wakes it (its results are for it to read). */
  private async pollEnded(agentId: string, data: GatewayMessageCreateDispatchData) {
    const pollId = data.message_reference?.message_id;
    const own = pollId
      ? await this.database.client.discordMessage.findUnique({ where: { agentId_id: { agentId, id: pollId } } })
      : null;
    if (!own?.authorBot || own.authorId === undefined) return;
    const bot = await this.store.bot(agentId);
    if (own.authorId !== bot.botUserId) return;
    this.collect(agentId, {
      id: data.id,
      channelId: data.channel_id,
      authorId: data.author.id,
      authorName: 'Discord',
      authorBot: false, // an event for the agent, not bot chatter
      role: 'bot',
      content: `Your poll ended. See the results with discord_read_poll(${JSON.stringify({ channelId: `discord:${data.channel_id}`, messageId: pollId })}).`,
      createdAt: new Date(data.timestamp),
      addressed: true,
      attachments: [],
    });
  }

  /**
   * An edit: a message still waiting in a batch is updated in place; an addressed one the agent already had
   * (from the owner, a DM, or mentioning it) wakes it again for a few minutes; any other only updates the record.
   */
  private async edited(
    agentId: string,
    botUserId: string,
    data: { id: string; channel_id: string; content?: string; author?: { id: string } },
  ) {
    if (data.content === undefined || data.author?.id === botUserId) return;
    const waiting = [
      ...this.windowsOf(agentId, data.channel_id).flatMap(window => window.messages),
      ...(this.queues.get(agentId) ?? []).flatMap(batch => batch.messages),
    ].filter(message => message.id === data.id);
    for (const message of waiting) message.content = data.content;
    const row = await this.database.client.discordMessage.findUnique({
      where: { agentId_id: { agentId, id: data.id } },
    });
    if (!row || row.deletedAt) return;
    await this.database.client.discordMessage.update({
      where: { agentId_id: { agentId, id: data.id } },
      data: { content: data.content, editedAt: new Date() },
    });
    if (waiting.length || Date.now() - row.createdAt.getTime() > EDIT_WINDOW_MS) return;
    const channel = await this.store.usable(agentId, data.channel_id);
    const account = await this.store.who(row.authorId);
    const addressed = channel?.kind === 'dm' || row.mentionsBot || account?.role === 'owner';
    if (!channel || !addressed) return;
    this.collect(agentId, {
      id: row.id,
      channelId: row.channelId,
      authorId: row.authorId,
      authorName: row.authorName,
      authorBot: row.authorBot,
      role: roleOf(account, row.authorBot),
      ...(account?.role === 'agent' && account.agentId ? { authorAgentId: account.agentId } : {}),
      content: data.content,
      createdAt: row.createdAt,
      addressed: true,
      attachments: [],
      note: 'edited',
    });
  }

  /** Deleted messages leave batches that have not reached the agent yet, and read as gone. */
  private async deleted(agentId: string, channelId: string, ids: string[]) {
    const gone = new Set(ids);
    for (const window of this.windowsOf(agentId, channelId))
      window.messages = window.messages.filter(message => !gone.has(message.id));
    const queue = this.queues.get(agentId);
    if (queue) for (const batch of queue) batch.messages = batch.messages.filter(message => !gone.has(message.id));
    this.queues.set(
      agentId,
      (queue ?? []).filter(batch => batch.messages.length),
    );
    await this.database.client.discordMessage.updateMany({
      where: { agentId, channelId, id: { in: ids } },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Someone reacted to one of the agent's own messages: reaction triage (the platform's own) decides whether it
   * deserves a turn. Reactions elsewhere are only feedback for others.
   */
  private async reacted(
    agentId: string,
    botUserId: string,
    data: {
      user_id: string;
      channel_id: string;
      message_id: string;
      message_author_id?: string;
      emoji: { id: string | null; name: string | null };
    },
  ) {
    if (data.user_id === botUserId || data.message_author_id !== botUserId || !this.deps.reaction) return;
    const channel = await this.store.usable(agentId, data.channel_id);
    if (!channel) return;
    // Toggling a reaction does not buy more model calls.
    const once = `${agentId}:${data.message_id}:${data.user_id}:${data.emoji.id ?? data.emoji.name}`;
    const now = Date.now();
    for (const [key, at] of this.reactions) if (now - at > REACTION_WINDOW_MS) this.reactions.delete(key);
    if (this.reactions.has(once)) return;
    this.reactions.set(once, now);
    const account = await this.store.who(data.user_id);
    const own = await this.database.client.discordMessage.findUnique({
      where: { agentId_id: { agentId, id: data.message_id } },
    });
    const emoji = data.emoji.id ? `<:${data.emoji.name}:${data.emoji.id}>` : (data.emoji.name ?? '?');
    const who =
      account?.role === 'owner'
        ? `${account.name} (your owner)`
        : account
          ? `agent ${account.name}`
          : `someone (${data.user_id})`;
    const notice = `${who} reacted ${emoji} to your message ${data.message_id}${own ? `: ${JSON.stringify(messageText(own.content, 0, 300).text)}` : ''}. This is feedback, not an instruction.`;
    const reaction = this.deps.reaction;
    const decision = await triageGate(agentId, () => reaction(agentId, data.channel_id, notice));
    if (decision !== 'engage') return;
    this.deps.deliver(
      agentId,
      {
        role: 'user',
        id: crypto.randomUUID(),
        text: notice,
        timestamp: Date.now(),
        source: {
          agentId: account?.agentId ?? `discord:${data.user_id}`,
          name: account?.name ?? 'Discord user',
          channelId: `discord:${data.channel_id}`,
          // A reaction continues the conversation its message belongs to (chain budgets apply).
          chainId: account?.role === 'owner' ? '' : (own?.chainId ?? ''),
          messageId: data.message_id,
          ...(account?.role === 'owner' ? { human: true } : {}),
          discord: { place: placeOf(channel) },
        },
      },
      false,
    );
  }

  /**
   * After a new session, messages that were addressed to the agent while it was offline (DMs, mentions, the
   * owner) arrive once, marked as such. Everything else stays readable as unread.
   */
  private async catchUp(agentId: string, botUserId: string, readyAt: Date) {
    let rest: REST | undefined;
    try {
      rest = this.deps.rest?.(agentId);
    } catch {
      return; // offline again already
    }
    if (!rest) return;
    // Where each channel stood before this session: messages arriving live meanwhile must not hide the gap.
    const since = [];
    for (const { channelId } of await this.store.channels(agentId)) {
      const channel = await this.store.usable(agentId, channelId);
      const last = channel
        ? await this.database.client.discordMessage.findFirst({
            where: { agentId, channelId, createdAt: { lt: readyAt } },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
          })
        : null;
      // Nothing seen here yet: there is nothing to catch up on.
      if (channel && last) since.push({ channel, last });
    }
    for (const { channel, last } of since) {
      let missed: APIMessage[];
      try {
        missed = (await rest.get(Routes.channelMessages(channel.channelId), {
          query: new URLSearchParams({ after: last.id, limit: '50' }),
        })) as APIMessage[];
      } catch {
        continue;
      }
      for (const message of missed.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)))
        await this.message(
          agentId,
          botUserId,
          { ...message, ...(channel.guildId ? { guild_id: channel.guildId } : {}) } as GatewayMessageCreateDispatchData,
          { catchUp: true },
        );
    }
  }

  private collect(agentId: string, seen: Seen) {
    const lane = laneOf(seen);
    const key = `${agentId}:${seen.channelId}:${lane}`;
    const existing = this.windows.get(key);
    if (existing) {
      existing.messages.push(seen);
      clearTimeout(existing.quiet);
      existing.quiet = setTimeout(() => this.closeWindow(agentId, seen.channelId, lane), this.quietMs);
      return;
    }
    const window: Window = {
      messages: [seen],
      quiet: setTimeout(() => this.closeWindow(agentId, seen.channelId, lane), this.quietMs),
      cap: setTimeout(() => this.closeWindow(agentId, seen.channelId, lane), this.capMs),
    };
    this.windows.set(key, window);
  }
  private closeWindow(agentId: string, channelId: string, lane: Lane) {
    const key = `${agentId}:${channelId}:${lane}`;
    const window = this.windows.get(key);
    if (!window) return;
    this.windows.delete(key);
    clearTimeout(window.quiet);
    clearTimeout(window.cap);
    const queue = this.queues.get(agentId) ?? [];
    // A channel still waiting its turn gets one batch, not one per window: the queue stays bounded by channels.
    const waiting = queue.find(batch => batch.channelId === channelId && batch.lane === lane);
    if (waiting) waiting.messages.push(...window.messages);
    else queue.push({ agentId, channelId, lane, messages: window.messages, closedAt: Date.now() });
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
    // The owner may have revoked the channel (or stranger DMs) while the batch waited.
    const channel = await this.store.usable(agentId, channelId);
    if (!channel || !batch.messages.length) return;
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
    const parent =
      channel.kind === 'thread' && !channel.admission && channel.parentId
        ? await this.store.channel(agentId, channel.parentId)
        : null;
    const admission =
      channel.kind === 'dm' ? 'all' : ((channel.admission ?? parent?.admission ?? bot.admission) as Admission);
    let admitted = addressed || admission === 'all';
    if (!admitted && admission === 'check' && this.deps.evaluate) {
      const evaluate = this.deps.evaluate;
      admitted = (await triageGate(agentId, () => evaluate(agentId, channelId, notice.text))) === 'admit';
    }
    if (!admitted) return; // saved; it reads as unread until the agent looks
    const newest = newestOf(batch.messages);
    const botsOnly = !people;
    const turns = botsOnly ? channel.botOnlyTurns + 1 : 0;
    await this.store.announce(
      agentId,
      channelId,
      newest.id,
      botsOnly ? { botOnlyTurns: turns, ...(turns >= this.botTurnLimit ? { pausedAt: new Date() } : {}) } : {},
    );
    const pause =
      botsOnly && turns >= this.botTurnLimit
        ? `\n[Only bots have spoken here for ${turns} turns in a row: you will not be woken by bots in this channel again until a person speaks.]`
        : '';
    const owner = batch.lane === 'owner';
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
    this.deps.deliver(
      agentId,
      {
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
      },
      addressed,
    );
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
    const authors = await this.database.client.discordMessage.groupBy({
      by: ['authorName'],
      where: await this.store.unreadWhere(agentId, channelId, channel.announcedUpTo),
      _count: { _all: true },
    });
    const unread = authors.reduce((total, author) => total + author._count._all, 0);
    const addressed = batch.messages.filter(message => message.addressed).slice(-this.fullMessages);
    const others = batch.messages
      .filter(message => !message.addressed)
      .slice(-Math.max(0, this.fullMessages - addressed.length));
    const shown = [...addressed, ...others].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const lines = shown.map(message => {
      const body = messageText(message.content, 0, 1500);
      return [
        `${clock(message.createdAt)} · ${message.authorName} (${roleLabel(message)}) · message ${message.id}${message.note ? ` (${message.note})` : ''}:${
          message.replyTo
            ? ` [replying to ${message.replyTo.author}'s message ${message.replyTo.id}: ${JSON.stringify(message.replyTo.text)}]`
            : ''
        } ${body.text || '(no text)'}${body.truncated ? ' […]' : ''}`,
        ...(message.attachments.length
          ? [`  [attachments: ${message.attachments.map(file => `${file.name} (${size(file.size)})`).join(', ')}]`]
          : []),
      ].join('\n');
    });
    const more = Math.max(0, unread - shown.length);
    if (more) {
      const top = authors.reduce((a, b) => (b._count._all > a._count._all ? b : a));
      lines.push(
        `+${more} more message${more === 1 ? '' : 's'} in this channel${previous ? ` since ${clock(previous.createdAt)}` : ''} (${authors.length} author${authors.length === 1 ? '' : 's'}, most from ${top.authorName}). Read them with discord_read_messages(${JSON.stringify({ channelId: `discord:${channelId}`, ...(channel.announcedUpTo ? { after: channel.announcedUpTo } : {}) })}).`,
      );
    }
    return { text: lines.join('\n'), place: placeOf(channel) };
  }
}
