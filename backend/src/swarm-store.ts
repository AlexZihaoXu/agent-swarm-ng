import type { PlatformStore } from './platform-store';
import { encodeAvatar, type AgentAvatar } from './agent-avatar';
import { liveChainWhere } from './communication-policy';

export const DM_CHAIN_LIMIT = 8;
export const DM_TEXT_LIMIT = 8000;
const pending = ['queued', 'running'];
export const dmReplyInclude = { replyTo: { select: { id: true, text: true, senderId: true, sender: { select: { name: true } } } } } as const;
export const dmConversationId = (a: string, b: string) => `dm:${[a, b].sort().join(':')}`;
export class SwarmError extends Error {
  constructor(readonly code: 'invalid' | 'missing' | 'denied' | 'limit', message: string) { super(message); }
}

/** Persistence/policy only. Scheduling and model execution remain in the broker. */
export class SwarmStore {
  constructor(private store: PlatformStore) {}
  async settings(agentId: string) {
    await this.store.initialize();
    const agent = await this.store.client.agent.findUnique({ where: { id: agentId }, select: { avatar: true, dmAllowed: { select: { recipient: { select: { id: true, name: true } } }, orderBy: { recipientId: 'asc' } } } });
    if (!agent) throw new SwarmError('missing', 'Agent not found.');
    return { avatar: agent.avatar ? JSON.parse(agent.avatar) as AgentAvatar : null, allowedDmAgents: agent.dmAllowed.map(grant => grant.recipient) };
  }
  async updateSettings(agentId: string, input: { avatar?: AgentAvatar; allowedDmAgentIds?: string[] }) {
    const ids = input.allowedDmAgentIds;
    if (!input.avatar && ids === undefined) throw new SwarmError('invalid', 'No settings supplied.');
    if (ids && (ids.length > 100 || new Set(ids).size !== ids.length || ids.includes(agentId))) throw new SwarmError('invalid', 'Choose up to 100 different agents, excluding this agent.');
    await this.store.initialize();
    await this.store.client.$transaction(async tx => {
      if (!await tx.agent.findUnique({ where: { id: agentId }, select: { id: true } })) throw new SwarmError('missing', 'Agent not found.');
      if (ids && await tx.agent.count({ where: { id: { in: ids } } }) !== ids.length) throw new SwarmError('invalid', 'One or more selected agents no longer exist.');
      if (input.avatar) await tx.agent.update({ where: { id: agentId }, data: { avatar: encodeAvatar(input.avatar) } });
      if (ids !== undefined) {
        // Treat both directed rows as one connection. Remove only this agent's pairs.
        await tx.dmGrant.deleteMany({ where: { OR: [{ senderId: agentId }, { recipientId: agentId }] } });
        for (const peerId of ids) {
          if (await tx.dmGrant.count({ where: { senderId: peerId } }) >= 100) throw new SwarmError('limit', 'A selected agent already has 100 connections.');
        }
        if (ids.length) await tx.dmGrant.createMany({ data: ids.flatMap(peerId => [{ senderId: agentId, recipientId: peerId }, { senderId: peerId, recipientId: agentId }]) });
      }
    });
    return this.settings(agentId);
  }
  async contacts(agentId: string) {
    await this.store.initialize();
    return (await this.store.client.dmGrant.findMany({ where: { senderId: agentId }, select: { recipient: { select: { id: true, name: true } } }, orderBy: { recipientId: 'asc' }, take: 100 })).map(row => row.recipient);
  }
  async beginChain(rootAgentId: string, id: string) {
    await this.store.initialize();
    if (!await this.store.client.agent.findUnique({ where: { id: rootAgentId }, select: { id: true } })) throw new SwarmError('missing', 'Agent not found.');
    const chain = await this.store.client.dmChain.upsert({ where: { id }, create: { id, rootAgentId, remaining: DM_CHAIN_LIMIT }, update: {} });
    if (chain.rootAgentId !== rootAgentId || chain.cancelled) throw new SwarmError('denied', 'This communication chain is no longer available.');
    return chain;
  }
  async send(input: { senderId: string; recipientId: string; chainId: string; deliveryKey: string; text: string; replyToId?: string }) {
    const { senderId, recipientId, chainId, deliveryKey, text, replyToId } = input;
    if (senderId === recipientId || !text.trim() || text.length > DM_TEXT_LIMIT || !deliveryKey || deliveryKey.length > 256) throw new SwarmError('invalid', 'Invalid DM recipient, text, or delivery key.');
    await this.store.initialize();
    return this.store.client.$transaction(async tx => {
      const previous = await tx.dmMessage.findUnique({ where: { deliveryKey }, include: dmReplyInclude });
      if (previous) {
        if (previous.senderId !== senderId || previous.recipientId !== recipientId || previous.chainId !== chainId || previous.text !== text || previous.replyToId !== (replyToId ?? null)) throw new SwarmError('invalid', 'Delivery key was already used for a different message.');
        return { message: previous, duplicate: true };
      }
      if (!await tx.dmGrant.findUnique({ where: { senderId_recipientId: { senderId, recipientId } } })) throw new SwarmError('denied', 'This agent is not allowed to DM that recipient.');
      if (replyToId && !await tx.dmMessage.findFirst({ where: { id: replyToId, conversationId: dmConversationId(senderId, recipientId) }, select: { id: true } })) throw new SwarmError('invalid', 'Reply target not found in this DM conversation.');
      if (await tx.dmMessage.count({ where: { recipientId, status: { in: pending } } }) >= 8 || await tx.dmMessage.count({ where: { status: { in: pending } } }) >= 64) throw new SwarmError('limit', 'The DM delivery queue is full.');
      const budget = await tx.dmChain.updateMany({ where: { ...liveChainWhere, id: chainId, remaining: { gt: 0 } }, data: { remaining: { decrement: 1 } } });
      if (!budget.count) throw new SwarmError('limit', 'The communication chain stopped or reached its message limit.');
      const message = await tx.dmMessage.create({ data: { senderId, recipientId, chainId, deliveryKey, text, replyToId, conversationId: dmConversationId(senderId, recipientId) }, include: dmReplyInclude });
      return { message, duplicate: false };
    });
  }
  async dmPeers(agentId: string, after?: number, limit = 50) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (after !== undefined && (!Number.isSafeInteger(after) || after < 1))) throw new SwarmError('invalid', 'Invalid conversation page.');
    await this.store.initialize();
    const rows = await this.store.client.agent.findMany({
      where: { id: { not: agentId }, ...(after === undefined ? {} : { sequence: { gt: after } }), OR: [{ dmSent: { some: { recipientId: agentId } } }, { dmReceived: { some: { senderId: agentId } } }] },
      orderBy: { sequence: 'asc' }, take: limit + 1,
      select: { id: true, sequence: true, name: true, avatar: true, channels: { where: { kind: 'platform-chat' }, select: { id: true }, take: 1 } },
    });
    const peers = rows.slice(0, limit);
    return { peers, nextCursor: rows.length > limit ? peers.at(-1)!.sequence : null };
  }
  async received(agentId: string, before?: number, limit = 20) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 40 || (before !== undefined && (!Number.isSafeInteger(before) || before < 1))) throw new SwarmError('invalid', 'Invalid inbox window.');
    await this.store.initialize();
    const rows = await this.store.client.dmMessage.findMany({ where: { recipientId: agentId, ...(before === undefined ? {} : { sequence: { lt: before } }) }, orderBy: { sequence: 'desc' }, take: limit + 1, include: { sender: { select: { id: true, name: true, avatar: true } }, ...dmReplyInclude } });
    const messages = rows.slice(0, limit).reverse();
    return { messages, nextCursor: rows.length > limit ? messages[0].sequence : null };
  }
  async message(agentId: string, peerId: string, id: string) {
    await this.store.initialize();
    const message = await this.store.client.dmMessage.findFirst({ where: { id, conversationId: dmConversationId(agentId, peerId), OR: [{ senderId: agentId, recipientId: peerId }, { senderId: peerId, recipientId: agentId }] }, include: { sender: { select: { name: true } }, ...dmReplyInclude } });
    if (!message) throw new SwarmError('missing', 'Message not found in this DM conversation.');
    return message;
  }
  async history(agentId: string, peerId: string, before?: number, limit = 20) {
    if (agentId === peerId || !Number.isSafeInteger(limit) || limit < 1 || limit > 40 || (before !== undefined && (!Number.isSafeInteger(before) || before < 1))) throw new SwarmError('invalid', 'Invalid history window.');
    await this.store.initialize();
    const messages = await this.store.client.dmMessage.findMany({
      where: { conversationId: dmConversationId(agentId, peerId), OR: [{ senderId: agentId, recipientId: peerId }, { senderId: peerId, recipientId: agentId }], ...(before === undefined ? {} : { sequence: { lt: before } }) },
      orderBy: { sequence: 'desc' }, take: limit + 1,
      include: { sender: { select: { name: true } }, recipient: { select: { name: true } }, ...dmReplyInclude },
    });
    const page = messages.slice(0, limit).reverse();
    return { messages: page, nextCursor: messages.length > limit ? page[0].sequence : null };
  }
  async context(agentId: string, peerId: string, incomingSequence: number) {
    await this.store.initialize();
    return (await this.store.client.dmMessage.findMany({ where: { conversationId: dmConversationId(agentId, peerId), OR: [{ senderId: agentId, recipientId: peerId }, { senderId: peerId, recipientId: agentId }], AND: [{ OR: [{ senderId: agentId }, { sequence: { lt: incomingSequence } }] }] }, orderBy: { sequence: 'desc' }, take: 8, include: dmReplyInclude })).reverse();
  }
  async claim(id: string, recipientId: string) {
    await this.store.initialize();
    const result = await this.store.client.dmMessage.updateMany({ where: { id, recipientId, status: 'queued', chain: liveChainWhere }, data: { status: 'running' } });
    if (!result.count) return null;
    return this.store.client.dmMessage.findFirst({ where: { id, recipientId, status: 'running' }, include: { sender: { select: { id: true, name: true } }, ...dmReplyInclude } });
  }
  async finish(id: string, recipientId: string, status: 'completed' | 'failed' | 'cancelled') {
    await this.store.initialize();
    await this.store.client.dmMessage.updateMany({ where: { id, recipientId, status: { in: pending } }, data: { status } });
  }
  async cancelChain(chainId: string) {
    await this.store.initialize();
    await this.store.client.$transaction([
      this.store.client.dmChain.updateMany({ where: { id: chainId }, data: { cancelled: true } }),
      this.store.client.dmMessage.updateMany({ where: { chainId, status: { in: pending } }, data: { status: 'cancelled' } }),
      this.store.client.groupDelivery.updateMany({ where: { message: { chainId }, status: { in: pending } }, data: { status: 'cancelled' } }),
    ]);
  }
  /** Call once at actual worker startup, never during OpenAPI generation/app construction. */
  async cancelInterruptedDeliveries() {
    await this.store.initialize();
    await this.store.client.$transaction([
      this.store.client.dmChain.updateMany({ where: { cancelled: false }, data: { cancelled: true } }),
      this.store.client.dmMessage.updateMany({ where: { status: { in: pending } }, data: { status: 'cancelled' } }),
      this.store.client.groupDelivery.updateMany({ where: { status: { in: pending } }, data: { status: 'cancelled' } }),
    ]);
  }
}
