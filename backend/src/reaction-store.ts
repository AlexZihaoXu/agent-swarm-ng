import type { Prisma } from './generated/prisma/client';
import type { PlatformStore } from './platform-store';
import { SwarmError } from './swarm-store';

export const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '👀', '✅', '🤔', '🔥'] as const;
export type ReactionSummary = { emoji: string; count: number; mine: boolean };
const key = (agentId?: string) => agentId ? `agent:${agentId}` : 'human';

export class ReactionStore {
  constructor(private database: PlatformStore) {}
  private async target(tx: Prisma.TransactionClient, channelId: string, ids: string[], agentId?: string) {
    if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw new SwarmError('invalid', 'Choose 1–100 different messages.');
    if (channelId.startsWith('group:')) {
      const groupId = channelId.slice(6);
      if (agentId && !await tx.groupMember.findUnique({ where: { groupId_agentId: { groupId, agentId } } })) throw new SwarmError('denied', 'This agent is not a member of that group.');
      if (await tx.groupMessage.count({ where: { groupId, id: { in: ids } } }) !== ids.length) throw new SwarmError('missing', 'Message not found in this chat.');
      return 'groupMessageId' as const;
    }
    if (!await tx.channel.findFirst({ where: { id: channelId, kind: 'platform-chat', ...(agentId ? { agentId } : {}) } })) throw new SwarmError('denied', 'This chat is not available.');
    if (await tx.message.count({ where: { channelId, id: { in: ids } } }) !== ids.length) throw new SwarmError('missing', 'Message not found in this chat.');
    return 'messageId' as const;
  }
  private async summaries(tx: Prisma.TransactionClient, field: 'messageId' | 'groupMessageId', ids: string[], agentId?: string) {
    const rows = await tx.messageReaction.findMany({ where: { [field]: { in: ids } }, select: { messageId: true, groupMessageId: true, emoji: true, actorKey: true } });
    const output: Record<string, ReactionSummary[]> = Object.fromEntries(ids.map(id => [id, []]));
    for (const row of rows) {
      const list = output[row[field]!];
      let summary = list.find(item => item.emoji === row.emoji);
      if (!summary) { summary = { emoji: row.emoji, count: 0, mine: false }; list.push(summary); }
      summary.count++; summary.mine ||= row.actorKey === key(agentId);
    }
    for (const list of Object.values(output)) list.sort((a, b) => REACTION_EMOJIS.indexOf(a.emoji as typeof REACTION_EMOJIS[number]) - REACTION_EMOJIS.indexOf(b.emoji as typeof REACTION_EMOJIS[number]));
    return output;
  }
  async read(channelId: string, ids: string[], agentId?: string) {
    await this.database.initialize();
    return this.database.client.$transaction(async tx => this.summaries(tx, await this.target(tx, channelId, ids, agentId), ids, agentId));
  }
  async set(channelId: string, messageId: string, emoji: string, active: boolean, agentId?: string) {
    if (!REACTION_EMOJIS.includes(emoji as typeof REACTION_EMOJIS[number])) throw new SwarmError('invalid', 'Unsupported reaction.');
    await this.database.initialize();
    return this.database.client.$transaction(async tx => {
      const field = await this.target(tx, channelId, [messageId], agentId);
      const where = { [field]: messageId, actorKey: key(agentId), emoji };
      if (!active) await tx.messageReaction.deleteMany({ where });
      else if (!await tx.messageReaction.findFirst({ where })) await tx.messageReaction.create({ data: { ...where, agentId } });
      return (await this.summaries(tx, field, [messageId], agentId))[messageId];
    });
  }
}
