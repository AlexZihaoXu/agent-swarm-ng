import type { Prisma } from './generated/prisma/client';
import type { PlatformStore } from './platform-store';
import { SwarmError } from './swarm-store';
import { liveChainWhere } from './communication-policy';

export const GROUP_MEMBER_LIMIT = 16;
export const GROUP_CHAIN_LIMIT = 32;
const pending = ['queued', 'running'];
const memberView = {
  include: {
    agent: {
      select: {
        id: true,
        name: true,
        avatar: true,
        channels: { where: { kind: 'platform-chat' }, select: { id: true }, take: 1 },
      },
    },
  },
  orderBy: { agentId: 'asc' as const },
};
export const groupReplyInclude = {
  replyTo: { select: { id: true, role: true, authorId: true, authorName: true, text: true } },
} as const;

function validate(name: string, ids: string[]) {
  if (!name.trim() || name.trim().length > 80)
    throw new SwarmError('invalid', 'Choose a group name up to 80 characters.');
  if (!ids.length || ids.length > GROUP_MEMBER_LIMIT || new Set(ids).size !== ids.length)
    throw new SwarmError('invalid', `Choose 1–${GROUP_MEMBER_LIMIT} different agents.`);
}
function window(before: number | undefined, limit: number) {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 40 ||
    (before !== undefined && (!Number.isSafeInteger(before) || before < 1))
  )
    throw new SwarmError('invalid', 'Invalid history window.');
}

/** Group membership is its own publication/read grant, never an implicit DM connection. */
export class GroupStore {
  constructor(private store: PlatformStore) {}
  private async authorize(tx: Prisma.TransactionClient, groupId: string, agentId?: string) {
    if (agentId !== undefined) {
      if (!(await tx.groupMember.findUnique({ where: { groupId_agentId: { groupId, agentId } } })))
        throw new SwarmError('denied', 'This agent is not a member of that group.');
    } else if (!(await tx.groupChat.findUnique({ where: { id: groupId }, select: { id: true } })))
      throw new SwarmError('missing', 'Group not found.');
  }
  private async validateMembers(tx: Prisma.TransactionClient, ids: string[]) {
    if ((await tx.agent.count({ where: { id: { in: ids } } })) !== ids.length)
      throw new SwarmError('invalid', 'One or more selected agents no longer exist.');
  }
  async create(name: string, agentIds: string[]) {
    validate(name, agentIds);
    await this.store.initialize();
    return this.store.client.$transaction(async tx => {
      await this.validateMembers(tx, agentIds);
      return tx.groupChat.create({
        data: { name: name.trim(), members: { create: agentIds.map(agentId => ({ agentId })) } },
        include: { members: memberView },
      });
    });
  }
  async update(groupId: string, name: string, agentIds: string[]) {
    validate(name, agentIds);
    await this.store.initialize();
    return this.store.client.$transaction(async tx => {
      await this.authorize(tx, groupId);
      await this.validateMembers(tx, agentIds);
      const existing = await tx.groupMember.findMany({ where: { groupId }, select: { agentId: true } });
      await tx.groupMember.deleteMany({ where: { groupId, agentId: { notIn: agentIds } } });
      const added = agentIds.filter(id => !existing.some(member => member.agentId === id));
      if (added.length) await tx.groupMember.createMany({ data: added.map(agentId => ({ groupId, agentId })) });
      return tx.groupChat.update({
        where: { id: groupId },
        data: { name: name.trim() },
        include: { members: memberView },
      });
    });
  }
  /** Keep an active group turn intact; once settled, cascade its transcript without deleting shared DM history. */
  async remove(groupId: string, confirmation: string) {
    await this.store.initialize();
    return this.store.client.$transaction(async tx => {
      const group = await tx.groupChat.findUnique({ where: { id: groupId }, select: { name: true } });
      if (!group) throw new SwarmError('missing', 'Group not found.');
      if (confirmation !== group.name)
        throw new SwarmError('invalid', 'Type the exact group name to confirm deletion.');
      if (await tx.groupDelivery.count({ where: { groupId, status: { in: pending } } }))
        throw new SwarmError('limit', 'Group agents are responding. Stop or wait for their turns before deleting.');
      await tx.groupChat.delete({ where: { id: groupId } });
    });
  }
  async get(groupId: string, agentId?: string) {
    await this.store.initialize();
    return this.store.client.$transaction(async tx => {
      await this.authorize(tx, groupId, agentId);
      return tx.groupChat.findUniqueOrThrow({ where: { id: groupId }, include: { members: memberView } });
    });
  }
  async list(agentId?: string, after?: number, limit = 40, search?: string) {
    window(after, limit);
    await this.store.initialize();
    const rows = await this.store.client.groupChat.findMany({
      where: {
        ...(search?.trim() ? { name: { contains: search.trim() } } : {}),
        ...(agentId === undefined ? {} : { members: { some: { agentId } } }),
        ...(after === undefined ? {} : { sequence: { gt: after } }),
      },
      orderBy: { sequence: 'asc' },
      take: limit + 1,
      include: { members: memberView },
    });
    const groups = await Promise.all(
      rows.slice(0, limit).map(async group => ({
        ...group,
        lastMessage: await this.store.client.groupMessage.findFirst({
          where: {
            groupId: group.id,
            ...(agentId === undefined ? {} : { group: { members: { some: { agentId } } } }),
          },
          orderBy: { sequence: 'desc' },
          include: groupReplyInclude,
        }),
      })),
    );
    return { groups, nextCursor: rows.length > limit ? groups.at(-1)!.sequence : null };
  }
  /** A message may be empty only when it carries files. */
  publishHuman(groupId: string, text: string, clientMessageId: string, replyToId?: string, hasFiles = false) {
    return this.publish(groupId, text, `human:${clientMessageId}`, replyToId, undefined, undefined, hasFiles);
  }
  publishAgent(
    groupId: string,
    agentId: string,
    text: string,
    chainId: string,
    deliveryKey: string,
    replyToId?: string,
    hasFiles = false,
  ) {
    return this.publish(groupId, text, `agent:${agentId}:${deliveryKey}`, replyToId, agentId, chainId, hasFiles);
  }
  private async publish(
    groupId: string,
    text: string,
    submissionKey: string,
    replyToId?: string,
    actorId?: string,
    inheritedChain?: string,
    hasFiles = false,
  ) {
    if ((!text.trim() && !hasFiles) || text.length > (actorId ? 8000 : 20000) || submissionKey.length > 400)
      throw new SwarmError('invalid', 'Invalid group message.');
    await this.store.initialize();
    return this.store.client.$transaction(async tx => {
      await this.authorize(tx, groupId, actorId);
      const previous = await tx.groupMessage.findUnique({
        where: { submissionKey },
        include: { deliveries: true, ...groupReplyInclude },
      });
      if (previous) {
        if (
          previous.groupId !== groupId ||
          previous.text !== text ||
          previous.replyToId !== (replyToId ?? null) ||
          previous.authorId !== (actorId ?? null) ||
          (actorId && previous.chainId !== inheritedChain)
        )
          throw new SwarmError('invalid', 'Submission key was used for a different message.');
        return { message: previous, deliveries: previous.deliveries, duplicate: true };
      }
      if (replyToId && !(await tx.groupMessage.findFirst({ where: { id: replyToId, groupId }, select: { id: true } })))
        throw new SwarmError('invalid', 'Reply target not found in this group.');
      const members = await tx.groupMember.findMany({
        where: { groupId, ...(actorId ? { agentId: { not: actorId } } : {}) },
        select: { agentId: true },
      });
      if ((await tx.groupDelivery.count({ where: { status: { in: pending } } })) + members.length > 128)
        throw new SwarmError('limit', 'The group delivery queue is full.');
      for (const member of members) {
        const count = await tx.groupDelivery.count({ where: { agentId: member.agentId, status: { in: pending } } });
        if (count >= 8) throw new SwarmError('limit', 'A group member’s delivery queue is full.');
      }
      const chainId = inheritedChain ?? crypto.randomUUID();
      if (actorId) {
        const budget = await tx.dmChain.updateMany({
          where: { ...liveChainWhere, id: chainId, remaining: { gt: 0 } },
          data: { remaining: { decrement: 1 } },
        });
        if (!budget.count)
          throw new SwarmError('limit', 'The communication chain stopped or reached its message limit.');
      } else
        await tx.dmChain.create({
          data: { id: chainId, origin: 'human', rootGroupId: groupId, remaining: GROUP_CHAIN_LIMIT },
        });
      const author = actorId
        ? await tx.agent.findUniqueOrThrow({ where: { id: actorId }, select: { name: true, avatar: true } })
        : { name: 'You', avatar: null };
      const message = await tx.groupMessage.create({
        data: {
          groupId,
          role: actorId ? 'assistant' : 'user',
          authorId: actorId,
          authorName: author.name,
          authorAvatar: author.avatar,
          text,
          replyToId,
          chainId,
          submissionKey,
          deliveries: {
            create: members.map(member => ({
              member: { connect: { groupId_agentId: { groupId, agentId: member.agentId } } },
            })),
          },
        },
        include: { deliveries: true, ...groupReplyInclude },
      });
      return { message, deliveries: message.deliveries, duplicate: false };
    });
  }
  async history(groupId: string, agentId?: string, before?: number, limit = 20) {
    window(before, limit);
    await this.store.initialize();
    return this.store.client.$transaction(async tx => {
      await this.authorize(tx, groupId, agentId);
      const rows = await tx.groupMessage.findMany({
        where: { groupId, ...(before === undefined ? {} : { sequence: { lt: before } }) },
        orderBy: { sequence: 'desc' },
        take: limit + 1,
        include: groupReplyInclude,
      });
      const messages = rows.slice(0, limit).reverse();
      return { messages, nextCursor: rows.length > limit ? messages[0].sequence : null };
    });
  }
  async message(groupId: string, messageId: string, agentId?: string) {
    await this.store.initialize();
    return this.store.client.$transaction(async tx => {
      await this.authorize(tx, groupId, agentId);
      const message = await tx.groupMessage.findFirst({
        where: { id: messageId, groupId },
        include: groupReplyInclude,
      });
      if (!message) throw new SwarmError('missing', 'Message not found in this group.');
      return message;
    });
  }
  async search(groupId: string, agentId: string, query: string, before?: number, limit = 10) {
    window(before, limit);
    if (!query.trim() || query.length > 200 || limit > 20)
      throw new SwarmError('invalid', 'Use a search phrase up to 200 characters and at most 20 results.');
    await this.store.initialize();
    return this.store.client.$transaction(async tx => {
      await this.authorize(tx, groupId, agentId);
      const args: (string | number)[] = [groupId, query];
      if (before !== undefined) args.push(before);
      args.push(limit + 1);
      const ids = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT "id" FROM "GroupMessage" WHERE "groupId" = ? AND instr(lower("text"), lower(?)) > 0 ${before === undefined ? '' : 'AND "sequence" < ?'} ORDER BY "sequence" DESC LIMIT ?`,
        ...args,
      );
      const messages = await tx.groupMessage.findMany({
        where: { groupId, id: { in: ids.slice(0, limit).map(row => row.id) } },
        orderBy: { sequence: 'desc' },
        include: groupReplyInclude,
      });
      return { messages, nextCursor: ids.length > limit ? messages.at(-1)!.sequence : null };
    });
  }
  async claim(messageId: string, agentId: string) {
    await this.store.initialize();
    const result = await this.store.client.groupDelivery.updateMany({
      where: { messageId, agentId, status: 'queued', message: { chain: liveChainWhere } },
      data: { status: 'running' },
    });
    if (!result.count) return null;
    return this.store.client.groupDelivery.findUnique({
      where: { messageId_agentId: { messageId, agentId } },
      include: { message: true },
    });
  }
  async finish(messageId: string, agentId: string, status: 'completed' | 'failed' | 'cancelled') {
    await this.store.initialize();
    await this.store.client.groupDelivery.updateMany({
      where: { messageId, agentId, status: { in: pending } },
      data: { status },
    });
  }
}
