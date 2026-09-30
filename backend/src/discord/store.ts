import type { PlatformStore } from '../platform-store';

export const ADMISSIONS = ['mention', 'check', 'all'] as const;
export type Admission = (typeof ADMISSIONS)[number];
export const SNOWFLAKE = /^\d{15,21}$/;

export class DiscordSettingsError extends Error {}

export type DiscoveredChannel = {
  channelId: string;
  guildId: string | null;
  guildName: string | null;
  parentId?: string | null;
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
    return this.database.client.discordBot.upsert({ where: { agentId }, create: { agentId }, update: {} });
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

  /** Changes the owner's policies for one agent's bot. Unknown channels are refused. */
  async update(
    agentId: string,
    input: {
      admission?: Admission;
      strangerDms?: boolean;
      catchUp?: boolean;
      channels?: { channelId: string; allowed: boolean; admission?: Admission | null }[];
    },
  ) {
    if (input.admission && !ADMISSIONS.includes(input.admission)) throw new DiscordSettingsError('Unknown admission.');
    await this.bot(agentId);
    await this.database.client.$transaction(async tx => {
      await tx.discordBot.update({
        where: { agentId },
        data: {
          ...(input.admission ? { admission: input.admission } : {}),
          ...(input.strangerDms !== undefined ? { strangerDms: input.strangerDms } : {}),
          ...(input.catchUp !== undefined ? { catchUp: input.catchUp } : {}),
        },
      });
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
    });
  }

  /** Records the channels the bot can see now (keeps the owner's choices; a DM channel is always allowed). */
  async discovered(agentId: string, channels: DiscoveredChannel[]) {
    await this.database.initialize();
    for (const channel of channels)
      await this.database.client.discordChannel.upsert({
        where: { agentId_channelId: { agentId, channelId: channel.channelId } },
        create: { agentId, ...channel, allowed: channel.kind === 'dm' },
        update: {
          guildId: channel.guildId,
          ...(channel.guildName ? { guildName: channel.guildName } : {}),
          ...(channel.parentId ? { parentId: channel.parentId } : {}),
          name: channel.name,
          kind: channel.kind,
        },
      });
  }

  /** The bot's own Discord identity, learned at login; it is one of our agents from then on. */
  async identify(agentId: string, botUserId: string, botName: string) {
    await this.bot(agentId);
    await this.database.client.$transaction([
      this.database.client.discordBot.update({ where: { agentId }, data: { botUserId, botName } }),
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
  async setOwnerAccounts(accounts: { id: string; name: string }[]) {
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
  /** Who a Discord account is: the owner, one of our agents, or null (anyone else). */
  async who(discordUserId: string) {
    await this.database.initialize();
    const account = await this.database.client.discordAccount.findUnique({ where: { discordUserId } });
    return account ? { role: account.role as 'owner' | 'agent', agentId: account.agentId, name: account.name } : null;
  }
}
