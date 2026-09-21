import { PrismaClient, type Prisma } from './generated/prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { databaseUrl } from './database-location';

const agentSelection = { channels: { where: { kind: 'platform-chat' }, take: 1 } };
type StoredAgent = Prisma.AgentGetPayload<{ include: typeof agentSelection }>;
type AgentInput = Pick<Prisma.AgentCreateInput, 'name' | 'endpointId' | 'model' | 'thinkingLevel'>;

export class PlatformStore {
  readonly client: PrismaClient;
  private initialized?: Promise<void>;
  constructor(url = databaseUrl()) { this.client = new PrismaClient({ adapter: new PrismaLibSql({ url }) }); }

  initialize() {
    return this.initialized ??= (async () => {
      await this.client.$queryRawUnsafe('PRAGMA journal_mode=WAL');
      await this.client.$executeRawUnsafe('PRAGMA foreign_keys=ON');
      await this.client.$executeRawUnsafe('PRAGMA busy_timeout=5000');
    })();
  }
  async close() { await this.client.$disconnect(); }

  async createAgent(input: AgentInput) {
    await this.initialize();
    return this.withLatestMessage(await this.client.agent.create({ data: { ...input, channels: { create: { kind: 'platform-chat' } } }, include: agentSelection }));
  }
  async listAgents(after?: number, limit = 100) {
    await this.initialize();
    const rows = await this.client.agent.findMany({ where: after ? { sequence: { gt: after } } : {}, orderBy: { sequence: 'asc' }, take: limit + 1, include: agentSelection });
    const more = rows.length > limit;
    const agents = rows.slice(0, limit);
    return { agents: await Promise.all(agents.map(agent => this.withLatestMessage(agent))), nextCursor: more ? agents.at(-1)!.sequence : null };
  }
  async findAgent(id: string) {
    await this.initialize();
    const agent = await this.client.agent.findUnique({ where: { id }, include: agentSelection });
    return agent ? this.withLatestMessage(agent) : null;
  }
  private async withLatestMessage(agent: StoredAgent) {
    // Prisma nested take across multiple parents reads all matching SQLite rows, then trims in memory.
    // Use bounded indexed lookups instead, so listing cards never loads entire conversations.
    const channels = await Promise.all(agent.channels.map(async channel => ({ ...channel,
      messages: await this.client.message.findMany({ where: { channelId: channel.id }, orderBy: { sequence: 'desc' }, take: 1 }),
    })));
    return { ...agent, channels };
  }
  async hasChannel(id: string) {
    await this.initialize();
    return Boolean(await this.client.channel.findUnique({ where: { id }, select: { id: true } }));
  }
  async messages(channelId: string, before?: number, limit = 50) {
    await this.initialize();
    const rows = await this.client.message.findMany({ where: { channelId, ...(before ? { sequence: { lt: before } } : {}) }, orderBy: { sequence: 'desc' }, take: limit + 1 });
    const more = rows.length > limit;
    const messages = rows.slice(0, limit).reverse();
    return { messages, nextCursor: more ? messages[0].sequence : null };
  }
  async appendMessage(channelId: string, role: 'user' | 'assistant', text: string, id: string = crypto.randomUUID()) {
    await this.initialize();
    return this.client.message.create({ data: { id, channelId, role, text } });
  }
  async findMessage(id: string) {
    await this.initialize();
    return this.client.message.findUnique({ where: { id } });
  }
  async context(channelId: string, currentMessageLength: number) {
    const { messages } = await this.messages(channelId, undefined, 100);
    let remaining = 80000 - currentMessageLength;
    const selected = [];
    for (const message of [...messages].reverse()) {
      if (message.text.length > remaining) break;
      selected.unshift({ role: message.role, text: message.text });
      remaining -= message.text.length;
    }
    return selected;
  }
}
