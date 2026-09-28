import type { Prisma } from './generated/prisma/client';
import type { PlatformStore } from './platform-store';
import { SwarmError } from './swarm-store';

export const MAX_REACTION_LENGTH = 64;
const emojiSequence = new RegExp('^\\p{RGI_Emoji}$', 'v');
export function isReactionEmoji(value: string) {
  return value.length > 0 && value.length <= MAX_REACTION_LENGTH && emojiSequence.test(value);
}
export type ReactionSummary = { emoji: string; count: number; mine: boolean };
const key = (agentId?: string) => (agentId ? `agent:${agentId}` : 'human');

export class ReactionStore {
  constructor(private database: PlatformStore) {}
  private async target(tx: Prisma.TransactionClient, channelId: string, ids: string[], agentId?: string) {
    if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length)
      throw new SwarmError('invalid', 'Choose 1–100 different messages.');
    if (channelId.startsWith('group:')) {
      const groupId = channelId.slice(6);
      if (agentId && !(await tx.groupMember.findUnique({ where: { groupId_agentId: { groupId, agentId } } })))
        throw new SwarmError('denied', 'This agent is not a member of that group.');
      if ((await tx.groupMessage.count({ where: { groupId, id: { in: ids } } })) !== ids.length)
        throw new SwarmError('missing', 'Message not found in this chat.');
      return 'groupMessageId' as const;
    }
    if (
      !(await tx.channel.findFirst({
        where: { id: channelId, kind: 'platform-chat', ...(agentId ? { agentId } : {}) },
      }))
    )
      throw new SwarmError('denied', 'This chat is not available.');
    if ((await tx.message.count({ where: { channelId, id: { in: ids } } })) !== ids.length)
      throw new SwarmError('missing', 'Message not found in this chat.');
    return 'messageId' as const;
  }
  private async summaries(
    tx: Prisma.TransactionClient,
    field: 'messageId' | 'groupMessageId',
    ids: string[],
    agentId?: string,
  ) {
    const rows = await tx.messageReaction.findMany({
      where: { [field]: { in: ids } },
      select: { messageId: true, groupMessageId: true, emoji: true, actorKey: true },
    });
    const output: Record<string, ReactionSummary[]> = Object.fromEntries(ids.map(id => [id, []]));
    for (const row of rows) {
      const list = output[row[field]!];
      let summary = list.find(item => item.emoji === row.emoji);
      if (!summary) {
        summary = { emoji: row.emoji, count: 0, mine: false };
        list.push(summary);
      }
      summary.count++;
      summary.mine ||= row.actorKey === key(agentId);
    }
    for (const list of Object.values(output)) list.sort((a, b) => (a.emoji < b.emoji ? -1 : a.emoji > b.emoji ? 1 : 0));
    return output;
  }
  async read(channelId: string, ids: string[], agentId?: string) {
    await this.database.initialize();
    return this.database.client.$transaction(async tx =>
      this.summaries(tx, await this.target(tx, channelId, ids, agentId), ids, agentId),
    );
  }
  async recent(agentId: string) {
    await this.database.initialize();
    return (
      await this.database.client.agentEmojiRecent.findMany({
        where: { agentId },
        orderBy: [{ usedAt: 'desc' }, { emoji: 'asc' }],
        take: 4,
        select: { emoji: true },
      })
    ).map(item => item.emoji);
  }
  async set(channelId: string, messageId: string, emoji: string, active: boolean, agentId?: string) {
    return (await this.setDetailed(channelId, messageId, emoji, active, agentId)).reactions;
  }
  async setDetailed(channelId: string, messageId: string, emoji: string, active: boolean, agentId?: string) {
    if (!isReactionEmoji(emoji)) throw new SwarmError('invalid', 'Unsupported reaction.');
    await this.database.initialize();
    return this.database.client.$transaction(async tx => {
      const field = await this.target(tx, channelId, [messageId], agentId);
      const where = { [field]: messageId, actorKey: key(agentId), emoji };
      let changed = false;
      if (!active) changed = (await tx.messageReaction.deleteMany({ where })).count > 0;
      else if (!(await tx.messageReaction.findFirst({ where }))) {
        await tx.messageReaction.create({ data: { ...where, agentId } });
        changed = true;
      }
      if (active && agentId) {
        const latest = await tx.agentEmojiRecent.findFirst({
          where: { agentId },
          orderBy: { usedAt: 'desc' },
          select: { usedAt: true },
        });
        const now = Date.now();
        const usedAt = new Date(Math.max(now, (latest?.usedAt.getTime() ?? 0) + 1));
        await tx.agentEmojiRecent.upsert({
          where: { agentId_emoji: { agentId, emoji } },
          create: { agentId, emoji, usedAt },
          update: { usedAt },
        });
        const recent = await tx.agentEmojiRecent.findMany({
          where: { agentId },
          orderBy: [{ usedAt: 'desc' }, { emoji: 'asc' }],
          take: 4,
          select: { emoji: true },
        });
        await tx.agentEmojiRecent.deleteMany({ where: { agentId, emoji: { notIn: recent.map(item => item.emoji) } } });
      }
      return { reactions: (await this.summaries(tx, field, [messageId], agentId))[messageId], changed };
    });
  }
}
