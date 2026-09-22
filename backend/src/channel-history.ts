import { Prisma } from './generated/prisma/client';
import type { PlatformStore } from './platform-store';

type Row = Awaited<ReturnType<PlatformStore['appendMessage']>>;
export type ReadSection = { before?: number; after?: number; at?: Date; messageId?: string; limit: number };

/** All lookups, anchors, and search candidates stay within the granted channel. */
export class ChannelHistory {
  constructor(private store: PlatformStore, private channelId: string) {}
  async message(id: string) {
    await this.store.initialize();
    const message = await this.store.client.message.findFirst({ where: { id, channelId: this.channelId } });
    if (!message) throw new Error('Message not found in this channel.');
    return message;
  }
  async section(options: ReadSection) {
    await this.store.initialize();
    const { limit } = options;
    let anchor: Row | null = null;
    if (options.messageId) anchor = await this.message(options.messageId);
    else if (options.at) anchor = await this.store.client.message.findFirst({ where: { channelId: this.channelId, createdAt: { gte: options.at } }, orderBy: [{ createdAt: 'asc' }, { sequence: 'asc' }] });
    let messages: Row[];
    if (anchor) {
      let older = await this.store.client.message.findMany({ where: { channelId: this.channelId, sequence: { lt: anchor.sequence } }, orderBy: { sequence: 'desc' }, take: Math.floor((limit - 1) / 2) });
      const newer = await this.store.client.message.findMany({ where: { channelId: this.channelId, sequence: { gte: anchor.sequence } }, orderBy: { sequence: 'asc' }, take: limit - older.length });
      if (older.length + newer.length < limit) older = await this.store.client.message.findMany({ where: { channelId: this.channelId, sequence: { lt: anchor.sequence } }, orderBy: { sequence: 'desc' }, take: limit - newer.length });
      messages = [...older.reverse(), ...newer];
    } else {
      const forwards = options.after !== undefined;
      messages = await this.store.client.message.findMany({
        where: { channelId: this.channelId, ...(forwards ? { sequence: { gt: options.after } } : options.before !== undefined ? { sequence: { lt: options.before } } : {}) },
        orderBy: { sequence: forwards ? 'asc' : 'desc' }, take: limit,
      });
      if (!forwards) messages.reverse();
    }
    return { messages, cursors: await this.cursors(messages) };
  }
  async cursors(messages: Row[]) {
    if (!messages.length) return { before: null, after: null };
    const first = messages[0].sequence, last = messages.at(-1)!.sequence;
    const [older, newer] = await Promise.all([
      this.store.client.message.findFirst({ where: { channelId: this.channelId, sequence: { lt: first } }, select: { sequence: true } }),
      this.store.client.message.findFirst({ where: { channelId: this.channelId, sequence: { gt: last } }, select: { sequence: true } }),
    ]);
    return { before: older ? first : null, after: newer ? last : null };
  }
  async search(query: string, options: { before?: number; limit: number; author?: 'user' | 'assistant'; since?: Date; until?: Date }) {
    await this.store.initialize();
    // Parameterized literal substring search: %, _, quotes, and SQL syntax are not operators.
    // SQLite lower() is ASCII case-insensitive; non-ASCII text is matched literally.
    const ids = await this.store.client.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM Message WHERE channelId = ${this.channelId}
      AND instr(lower(text), lower(${query})) > 0
      ${options.before !== undefined ? Prisma.sql`AND sequence < ${options.before}` : Prisma.empty}
      ${options.author ? Prisma.sql`AND role = ${options.author}` : Prisma.empty}
      ${options.since ? Prisma.sql`AND createdAt >= ${options.since}` : Prisma.empty}
      ${options.until ? Prisma.sql`AND createdAt <= ${options.until}` : Prisma.empty}
      ORDER BY sequence DESC LIMIT ${options.limit + 1}
    `);
    const messages = ids.length ? await this.store.client.message.findMany({ where: { channelId: this.channelId, id: { in: ids.slice(0, options.limit).map(row => row.id) } }, orderBy: { sequence: 'desc' }, take: options.limit }) : [];
    return { messages, nextCursor: ids.length > options.limit ? messages.at(-1)!.sequence : null };
  }
}
