import type { PlatformStore } from '../platform-store';

export const ADMISSIONS = ['mention', 'check', 'all'] as const;
export type Admission = (typeof ADMISSIONS)[number];
export const SNOWFLAKE = /^\d{15,21}$/;

export class DiscordSettingsError extends Error {}

/** Who wrote a Discord message, as the platform labels it: never decided by the message itself. */
export type AuthorRole = 'owner' | 'agent' | 'bot' | 'person';
export const authorRole = (account: { role: string } | null | undefined, bot: boolean): AuthorRole =>
  account?.role === 'owner' ? 'owner' : account?.role === 'agent' ? 'agent' : bot ? 'bot' : 'person';

/** Where a channel is, as agents read it: "DM with sam", "Swarm Lab › #design", "Swarm Lab › Logo v2" (a thread). */
export const placeOf = (channel: { kind: string; name: string; guildName: string | null }) =>
  channel.kind === 'dm'
    ? `DM with ${channel.name}`
    : `${channel.guildName ?? 'Server'} › ${channel.kind === 'thread' ? channel.name : `#${channel.name}`}`;

export type DiscoveredChannel = {
  channelId: string;
  guildId: string | null;
  guildName: string | null;
  parentId?: string | null;
  recipientId?: string;
  name: string;
  kind: string;
};

/**
 * The owner's Discord policies and who is who on Discord. Policies are per agent (its bot): which channels it may
 * use, how undirected server messages are admitted, whether strangers may DM it. Accounts say which Discord users
 * are the owner (human authority) and which are our agents' bots.
 */
export class DiscordStore {
  constructor(private database: PlatformStore) {}

  async bot(agentId: string) {
    await this.database.initialize();
    // Reading never writes: an agent without Discord settings has the defaults.
    return (
      (await this.database.client.discordBot.findUnique({ where: { agentId } })) ?? {
        agentId,
        botUserId: null,
        botName: null,
        admission: 'check',
        catchUp: true,
        presenceMode: 'auto',
        statusText: '',
        createdAt: new Date(0),
        updatedAt: new Date(0),
      }
    );
  }
  async channels(agentId: string) {
    await this.database.initialize();
    return this.database.client.discordChannel.findMany({
      where: { agentId },
      orderBy: [{ guildName: 'asc' }, { name: 'asc' }],
      take: 1000,
    });
  }
  async channel(agentId: string, channelId: string) {
    await this.database.initialize();
    return this.database.client.discordChannel.findUnique({ where: { agentId_channelId: { agentId, channelId } } });
  }
  /**
   * A channel this agent may use now, or null: a DM with someone who may DM its bot (canDm), or a server channel
   * the owner allowed (a thread follows its parent).
   */
  async usable(agentId: string, channelId: string) {
    const channel = await this.channel(agentId, channelId);
    if (!channel) return null;
    if (channel.kind === 'dm')
      return channel.recipientId && (await this.canDm(agentId, channel.recipientId)) ? channel : null;
    if (channel.allowed) return channel;
    const parent = channel.kind === 'thread' && channel.parentId ? await this.channel(agentId, channel.parentId) : null;
    return parent?.allowed ? channel : null;
  }

  /**
   * Who may DM this agent's bot: the owner's accounts, our agents' bots, and the people on its DM whitelist; nobody
   * else (their DMs are dropped unread).
   */
  async canDm(agentId: string, discordUserId: string) {
    if (await this.who(discordUserId)) return true;
    return Boolean(
      await this.database.client.discordDmAllow.findUnique({
        where: { agentId_discordUserId: { agentId, discordUserId } },
      }),
    );
  }
  async dmAllowed(agentId: string) {
    await this.database.initialize();
    return this.database.client.discordDmAllow.findMany({
      where: { agentId },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
  }
  /** People this bot has seen in its servers (for choosing whom to allow DMs from). */
  async people(agentId: string, search = '') {
    await this.database.initialize();
    const bot = await this.bot(agentId);
    const rows = await this.database.client.discordMessage.findMany({
      where: {
        agentId,
        ...(bot.botUserId ? { authorId: { not: bot.botUserId } } : {}),
        ...(search.trim() ? { authorName: { contains: search.trim() } } : {}),
      },
      distinct: ['authorId'],
      orderBy: { createdAt: 'desc' },
      select: { authorId: true, authorName: true, authorBot: true },
      take: 50,
    });
    return rows.map(row => ({ id: row.authorId, name: row.authorName, bot: row.authorBot }));
  }

  /** Changes the owner's policies for one agent's bot. Unknown channels are refused. */
  async update(
    agentId: string,
    input: {
      admission?: Admission;
      catchUp?: boolean;
      channels?: { channelId: string; allowed: boolean; admission?: Admission | null }[];
      /** Replaces the DM whitelist. */
      dmAllowed?: { id: string; name: string }[];
    },
  ) {
    if (input.admission && !ADMISSIONS.includes(input.admission)) throw new DiscordSettingsError('Unknown admission.');
    await this.database.initialize();
    await this.database.client.$transaction(async tx => {
      const policy = {
        ...(input.admission ? { admission: input.admission } : {}),
        ...(input.catchUp !== undefined ? { catchUp: input.catchUp } : {}),
      };
      await tx.discordBot.upsert({ where: { agentId }, create: { agentId, ...policy }, update: policy });
      for (const channel of input.channels ?? []) {
        if (channel.admission && !ADMISSIONS.includes(channel.admission))
          throw new DiscordSettingsError('Unknown admission.');
        const { count } = await tx.discordChannel.updateMany({
          where: { agentId, channelId: channel.channelId },
          data: {
            allowed: channel.allowed,
            ...(channel.admission !== undefined ? { admission: channel.admission } : {}),
          },
        });
        if (!count) throw new DiscordSettingsError('That channel is not one this bot can see.');
      }
      if (input.dmAllowed) {
        if (input.dmAllowed.length > 500) throw new DiscordSettingsError('At most 500 people.');
        const people = [...new Map(input.dmAllowed.map(person => [person.id, person])).values()];
        for (const person of people)
          if (!SNOWFLAKE.test(person.id)) throw new DiscordSettingsError('A Discord user ID is a long number.');
        await tx.discordDmAllow.deleteMany({ where: { agentId } });
        if (people.length)
          await tx.discordDmAllow.createMany({
            data: people.map(person => ({
              agentId,
              discordUserId: person.id,
              name: person.name.trim().slice(0, 80) || person.id,
            })),
          });
      }
    });
  }

  /** Records the channels the bot can see now (keeps the owner's choices; a DM channel is always allowed). */
  async discovered(agentId: string, channels: DiscoveredChannel[]) {
    await this.database.initialize();
    const named = new Map<string, string | null>();
    for (const channel of channels) {
      // A channel created later arrives without its server's name: it takes the name its server already has here.
      let guildName = channel.guildName;
      if (channel.guildId && !guildName) {
        if (!named.has(channel.guildId))
          named.set(
            channel.guildId,
            (
              await this.database.client.discordChannel.findFirst({
                where: { agentId, guildId: channel.guildId, guildName: { not: null } },
                select: { guildName: true },
              })
            )?.guildName ?? null,
          );
        guildName = named.get(channel.guildId) ?? null;
      }
      await this.database.client.discordChannel.upsert({
        where: { agentId_channelId: { agentId, channelId: channel.channelId } },
        create: { agentId, ...channel, guildName, allowed: channel.kind === 'dm' },
        update: {
          guildId: channel.guildId,
          ...(guildName ? { guildName } : {}),
          ...(channel.parentId ? { parentId: channel.parentId } : {}),
          ...(channel.recipientId ? { recipientId: channel.recipientId } : {}),
          name: channel.name,
          kind: channel.kind,
        },
      });
    }
    // A server seen with its name names all its channels (earlier ones may have been saved without it).
    const servers = new Map(
      channels.flatMap(channel => (channel.guildId && channel.guildName ? [[channel.guildId, channel.guildName]] : [])),
    );
    for (const [guildId, name] of servers) await this.nameServer(agentId, guildId, name);
  }
  /** A server's name, for all its channels (discovery, or a rename). */
  async nameServer(agentId: string, guildId: string, name: string) {
    await this.database.initialize();
    await this.database.client.discordChannel.updateMany({
      where: { agentId, guildId, OR: [{ guildName: null }, { guildName: { not: name } }] },
      data: { guildName: name },
    });
  }

  /** The bot left or was removed from a server: its channels (and the owner's choices for them) go. */
  async forgetServer(agentId: string, guildId: string) {
    await this.database.initialize();
    await this.database.client.discordChannel.deleteMany({ where: { agentId, guildId } });
  }
  /** The bot's own Discord identity, learned at login; it is one of our agents from then on. */
  /** The status the agent chose for its bot and its custom status text. */
  async setPresence(agentId: string, change: { presenceMode?: string; statusText?: string }) {
    await this.database.initialize();
    return this.database.client.discordBot.upsert({
      where: { agentId },
      create: { agentId, ...change },
      update: change,
    });
  }
  async identify(agentId: string, botUserId: string, botName: string) {
    await this.database.initialize();
    await this.database.client.$transaction([
      this.database.client.discordBot.upsert({
        where: { agentId },
        create: { agentId, botUserId, botName },
        update: { botUserId, botName },
      }),
      this.database.client.discordAccount.upsert({
        where: { discordUserId: botUserId },
        create: { discordUserId: botUserId, role: 'agent', agentId, name: botName },
        update: { role: 'agent', agentId, name: botName },
      }),
    ]);
  }

  async ownerAccounts() {
    await this.database.initialize();
    return this.database.client.discordAccount.findMany({ where: { role: 'owner' }, orderBy: { createdAt: 'asc' } });
  }
  /** Replaces the owner's Discord accounts (only these carry human authority on Discord). */
  async setOwnerAccounts(input: { id: string; name: string }[]) {
    const accounts = [...new Map(input.map(account => [account.id, account])).values()];
    if (accounts.length > 20) throw new DiscordSettingsError('At most 20 accounts.');
    for (const account of accounts)
      if (!SNOWFLAKE.test(account.id)) throw new DiscordSettingsError('A Discord user ID is a long number.');
    await this.database.initialize();
    const agentBots = await this.database.client.discordAccount.findMany({
      where: { role: 'agent', discordUserId: { in: accounts.map(account => account.id) } },
    });
    if (agentBots.length) throw new DiscordSettingsError(`${agentBots[0].name} is one of your agents’ bots.`);
    await this.database.client.$transaction([
      this.database.client.discordAccount.deleteMany({ where: { role: 'owner' } }),
      this.database.client.discordAccount.createMany({
        data: accounts.map(account => ({
          discordUserId: account.id,
          role: 'owner',
          name: account.name.trim() || 'You',
        })),
      }),
    ]);
    return this.ownerAccounts();
  }
  async messageTime(agentId: string, id: string) {
    await this.database.initialize();
    return (
      (
        await this.database.client.discordMessage.findUnique({
          where: { agentId_id: { agentId, id } },
          select: { createdAt: true },
        })
      )?.createdAt ?? null
    );
  }
  /**
   * Seen messages after a given one (the last announced to the agent): later in time, or in the same millisecond
   * with a later id (ids of one channel have the same length, so they compare as text).
   */
  async unreadWhere(agentId: string, channelId: string, afterId: string | null) {
    const base = { agentId, channelId, deletedAt: null };
    if (!afterId) return base;
    const time = await this.messageTime(agentId, afterId);
    if (!time) return base;
    return { ...base, OR: [{ createdAt: { gt: time } }, { createdAt: time, id: { gt: afterId } }] };
  }
  async unread(agentId: string, channelId: string, afterId: string | null) {
    await this.database.initialize();
    const where = await this.unreadWhere(agentId, channelId, afterId);
    const [count, mentions, latest] = await Promise.all([
      this.database.client.discordMessage.count({ where }),
      this.database.client.discordMessage.count({ where: { ...where, mentionsBot: true } }),
      this.database.client.discordMessage.findFirst({
        where,
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);
    return { count, mentions, latest: latest?.createdAt ?? null };
  }
  /** A literal search over messages this bot has seen in one channel (Discord offers bots no DM search). */
  async searchSeen(
    agentId: string,
    channelId: string,
    filter: { query?: string; from?: string; after?: Date; before?: Date; offset: number },
  ) {
    await this.database.initialize();
    return this.database.client.discordMessage.findMany({
      where: {
        agentId,
        channelId,
        deletedAt: null,
        ...(filter.query ? { content: { contains: filter.query } } : {}),
        ...(filter.from ? { authorId: filter.from } : {}),
        ...(filter.after || filter.before
          ? {
              createdAt: {
                ...(filter.after ? { gt: filter.after } : {}),
                ...(filter.before ? { lt: filter.before } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      skip: filter.offset,
      take: 25,
    });
  }
  /** The bot's own post: recorded like the others, and the channel counts as read up to it (as in the app). */
  async recordOwn(
    agentId: string,
    message: {
      id: string;
      channelId: string;
      authorId: string;
      authorName: string;
      content: string;
      chainId: string | null;
      createdAt: Date;
    },
  ) {
    await this.database.initialize();
    await this.database.client.discordMessage.upsert({
      where: { agentId_id: { agentId, id: message.id } },
      create: { agentId, ...message, authorBot: true },
      update: {},
    });
    await this.announce(agentId, message.channelId, message.id);
  }
  /** Moves the channel's "announced up to" marker forward to a message (never back). */
  async announce(agentId: string, channelId: string, id: string, data: object = {}) {
    await this.database.initialize();
    const channel = await this.channel(agentId, channelId);
    if (!channel) return;
    const later = !channel.announcedUpTo || BigInt(id) > BigInt(channel.announcedUpTo);
    await this.database.client.discordChannel.update({
      where: { agentId_channelId: { agentId, channelId } },
      data: { ...data, ...(later ? { announcedUpTo: id } : {}) },
    });
  }
  /** Deletes saved messages older than the retention period (Settings → Swarm); returns how many. */
  async prune(days: number, batch = 500) {
    await this.database.initialize();
    const before = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    let total = 0;
    // Short transactions: a large backlog goes in batches so intake and publications keep writing meanwhile.
    for (;;) {
      const rows = await this.database.client.discordMessage.findMany({
        where: { createdAt: { lt: before } },
        select: { id: true },
        take: batch,
      });
      if (!rows.length) return total;
      const { count } = await this.database.client.discordMessage.deleteMany({
        where: { createdAt: { lt: before }, id: { in: rows.map(row => row.id) } },
      });
      total += count;
      if (rows.length < batch) return total;
    }
  }
  /** Who a Discord account is: the owner, one of our agents, or null (anyone else). */
  async who(discordUserId: string) {
    await this.database.initialize();
    const account = await this.database.client.discordAccount.findUnique({ where: { discordUserId } });
    return account ? { role: account.role as 'owner' | 'agent', agentId: account.agentId, name: account.name } : null;
  }
}
