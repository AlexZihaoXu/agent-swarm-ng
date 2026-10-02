import { PrismaClient, type Prisma } from './generated/prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { databaseUrl, databaseFile } from './database-location';
import { dirname } from 'node:path';
import { messageText } from './message-text';
import { encodeAvatar, type AgentAvatar } from './agent-avatar';
import { channelReplyContext } from './reply-preview';

export const channelReplyInclude = { replyTo: { select: { id: true, role: true, text: true } } } as const;
const agentSelection = { channels: { where: { kind: 'platform-chat' }, take: 1 } };
type StoredAgent = Prisma.AgentGetPayload<{ include: typeof agentSelection }>;
type AgentInput = Pick<Prisma.AgentCreateInput, 'name' | 'endpointId' | 'model' | 'thinkingLevel'> & {
  avatar?: AgentAvatar;
  /** Its organization (default: the "personal" one every installation starts with). */
  organizationId?: string;
};

export class PlatformStore {
  readonly client: PrismaClient;
  private initialized?: Promise<void>;
  readonly dataDirectory: string;
  constructor(url = databaseUrl()) {
    this.dataDirectory = dirname(databaseFile(url));
    // `timeout` (busy timeout) applies at every connection creation. A PRAGMA would be lost when libSQL swaps its connection after a transaction.
    this.client = new PrismaClient({ adapter: new PrismaLibSql({ url, timeout: 5000 }) });
  }

  initialize() {
    return (this.initialized ??= (async () => {
      await this.client.$queryRawUnsafe('PRAGMA journal_mode=WAL');
      // Every commit reaches the disk before it is acknowledged (agents' timers must survive power loss).
      await this.client.$queryRawUnsafe('PRAGMA synchronous=FULL');
      await this.client.$executeRawUnsafe('PRAGMA foreign_keys=ON');
    })());
  }
  async close() {
    await this.client.$disconnect();
  }

  async createAgent({ organizationId, avatar, ...fields }: AgentInput) {
    await this.initialize();
    return this.withLatestMessage(
      await this.client.agent.create({
        data: {
          ...fields,
          ...(organizationId ? { organization: { connect: { id: organizationId } } } : {}),
          avatar: avatar ? encodeAvatar(avatar) : undefined,
          channels: { create: { kind: 'platform-chat' } },
        },
        include: agentSelection,
      }),
    );
  }
  async updateAvatar(id: string, avatar: AgentAvatar) {
    await this.initialize();
    return (await this.client.agent.updateMany({ where: { id }, data: { avatar: encodeAvatar(avatar) } })).count > 0;
  }
  async updateAgent(
    id: string,
    data: {
      name: string;
      endpointId: string;
      model: string;
      thinkingLevel: AgentInput['thinkingLevel'];
      compactAtPercent?: number;
      idleCompactMinutes?: number;
      idleCompactPercent?: number;
      instructions?: string;
      heartbeatEnabled?: boolean;
      heartbeatMinutes?: number;
      heartbeatFrom?: string;
      heartbeatTo?: string;
      heartbeatChecklist?: string;
    },
  ) {
    await this.initialize();
    return this.withLatestMessage(await this.client.agent.update({ where: { id }, data, include: agentSelection }));
  }
  async deleteAgent(id: string, name: string) {
    await this.initialize();
    // Foreign keys cascade to the agent's channels and messages in the same statement.
    return (await this.client.agent.deleteMany({ where: { id, name } })).count > 0;
  }
  async listAgents(after?: number, limit = 100, search?: string, organizationId?: string) {
    await this.initialize();
    const rows = await this.client.agent.findMany({
      where: {
        ...(after ? { sequence: { gt: after } } : {}),
        ...(organizationId ? { organizationId } : {}),
        ...(search?.trim() ? { name: { contains: search.trim() } } : {}),
      },
      orderBy: { sequence: 'asc' },
      take: limit + 1,
      include: agentSelection,
    });
    const more = rows.length > limit;
    const agents = rows.slice(0, limit);
    return {
      agents: await Promise.all(agents.map(agent => this.withLatestMessage(agent))),
      nextCursor: more ? agents.at(-1)!.sequence : null,
    };
  }
  async findAgent(id: string) {
    await this.initialize();
    const agent = await this.client.agent.findUnique({ where: { id }, include: agentSelection });
    return agent ? this.withLatestMessage(agent) : null;
  }
  async hasAgent(id: string) {
    await this.initialize();
    return Boolean(await this.client.agent.findUnique({ where: { id }, select: { id: true } }));
  }
  private async withLatestMessage(agent: StoredAgent) {
    // Prisma nested take across multiple parents reads all matching SQLite rows, then trims in memory.
    // Use bounded indexed lookups instead, so listing cards never loads entire conversations.
    const channels = await Promise.all(
      agent.channels.map(async channel => ({
        ...channel,
        messages: await this.client.message.findMany({
          where: { channelId: channel.id },
          orderBy: { sequence: 'desc' },
          take: 1,
          include: channelReplyInclude,
        }),
      })),
    );
    return { ...agent, channels };
  }
  async hasChannel(id: string) {
    await this.initialize();
    return Boolean(await this.client.channel.findUnique({ where: { id }, select: { id: true } }));
  }
  async messages(channelId: string, before?: number, limit = 50) {
    await this.initialize();
    const rows = await this.client.message.findMany({
      where: { channelId, ...(before ? { sequence: { lt: before } } : {}) },
      orderBy: { sequence: 'desc' },
      take: limit + 1,
      include: channelReplyInclude,
    });
    const more = rows.length > limit;
    const messages = rows.slice(0, limit).reverse();
    return { messages, nextCursor: more ? messages[0].sequence : null };
  }
  async appendMessage(
    channelId: string,
    role: 'user' | 'assistant',
    text: string,
    id: string = crypto.randomUUID(),
    replyToId?: string,
  ) {
    await this.initialize();
    return this.client.$transaction(async tx => {
      if (replyToId && !(await tx.message.findFirst({ where: { id: replyToId, channelId }, select: { id: true } })))
        throw new Error('Reply target not found in this channel.');
      return tx.message.create({ data: { id, channelId, role, text, replyToId }, include: channelReplyInclude });
    });
  }
  async findMessage(id: string) {
    await this.initialize();
    return this.client.message.findUnique({ where: { id } });
  }
  async context(channelId: string, excludeMessageId?: string, pendingAfterSequence?: number) {
    await this.initialize();
    const messages =
      pendingAfterSequence === undefined
        ? (await this.messages(channelId, undefined, excludeMessageId ? 9 : 8)).messages
        : (
            await this.client.message.findMany({
              where: { channelId, OR: [{ role: 'assistant' }, { sequence: { lt: pendingAfterSequence } }] },
              orderBy: { sequence: 'desc' },
              take: 8,
              include: channelReplyInclude,
            })
          ).reverse();
    const agent = messages.some(message => message.replyTo)
      ? await this.client.channel.findUnique({
          where: { id: channelId },
          select: { agent: { select: { name: true } } },
        })
      : null;
    return messages
      .filter(message => message.id !== excludeMessageId)
      .slice(-8)
      .map(message => ({
        id: message.id,
        sequence: message.sequence,
        role: message.role,
        timestamp: message.createdAt.getTime(),
        replyTo: channelReplyContext(message, agent?.agent.name ?? 'Agent'),
        ...messageText(message.text),
      }));
  }
}
