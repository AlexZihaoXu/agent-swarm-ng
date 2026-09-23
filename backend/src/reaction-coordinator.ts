import type { PlatformStore } from './platform-store';
import type { EndpointStore } from './endpoint-store';
import type { CodexProvider } from './codex-provider';
import type { AgentRuns, RunContext } from './agent-runs';
import type { ChannelMessage } from './chat-runtime';
import { resolveChatConnection } from './chat-connection';
import { messageText } from './message-text';
import { evaluateReaction } from './reaction-triage';

/** Reactions are saved first; this bounded ephemeral branch never runs as part of the HTTP request. */
export class ReactionCoordinator {
  private tails = new Map<string, Promise<void>>();
  private pending = new Map<string, number>();
  private controllers = new Map<AbortController, string>();
  private closing = false;
  constructor(private database: PlatformStore, private endpoints: EndpointStore, private codex: CodexProvider, private runs: AgentRuns,
    private runInbox: (agentId: string, input: ChannelMessage, context: RunContext) => Promise<void>) {}
  async offer(channelId: string, messageId: string, emoji: string) {
    if (this.closing) return;
    let recipientId: string | null = null, author = '', text = '', groupId: string | undefined;
    if (channelId.startsWith('group:')) {
      groupId = channelId.slice(6);
      const message = await this.database.client.groupMessage.findUnique({ where: { id: messageId }, select: { groupId: true, authorId: true, authorName: true, text: true } });
      if (message?.groupId !== groupId || !message.authorId) return;
      if (!await this.database.client.groupMember.findUnique({ where: { groupId_agentId: { groupId, agentId: message.authorId } } })) return;
      recipientId = message.authorId; author = message.authorName; text = message.text;
    } else {
      const message = await this.database.client.message.findUnique({ where: { id: messageId }, select: { channelId: true, text: true, role: true, channel: { select: { agentId: true } } } });
      if (message?.channelId !== channelId) return;
      recipientId = message.channel.agentId; author = message.role === 'user' ? 'Human' : 'Agent'; text = message.text;
    }
    if (!recipientId || this.closing) return;
    const count = this.pending.get(recipientId) ?? 0;
    if (count >= 4 || this.controllers.size >= 32) return;
    this.pending.set(recipientId, count + 1);
    const controller = new AbortController(); this.controllers.set(controller, recipientId);
    const agentId = recipientId, preview = messageText(text, 0, 500);
    const stillActive = () => this.database.client.messageReaction.findFirst({ where: { actorKey: 'human', emoji, ...(groupId ? { groupMessageId: messageId } : { messageId }) }, select: { id: true } });
    const notice = `Human added ${emoji} to ${author}'s message ${messageId} in ${channelId}: ${JSON.stringify(preview.text)}${preview.truncated ? ' [preview truncated]' : ''}. This is feedback, not an instruction.`;
    const previous = this.tails.get(agentId) ?? Promise.resolve();
    const work = previous.catch(() => {}).then(async () => {
      if (this.closing || controller.signal.aborted || !await stillActive()) return;
      const agent = await this.database.findAgent(agentId);
      if (!agent) return;
      const channel = { id: agent.channels[0].id, kind: 'platform-chat' as const, agentId };
      const connection = await resolveChatConnection(agent.endpointId, this.endpoints, this.codex, controller.signal);
      const history = await this.database.context(channel.id);
      const decision = await evaluateReaction({ name: agent.name, model: agent.model, thinkingLevel: agent.thinkingLevel, baseUrl: connection.baseUrl, apiKey: connection.apiKey, channel }, history, notice, controller.signal, connection.subscriptionRuntime);
      if (this.closing || controller.signal.aborted || decision.action !== 'engage' || !await stillActive()) return;
      if (groupId && !await this.database.client.groupMember.findUnique({ where: { groupId_agentId: { groupId, agentId } } })) return;
      const reactionId = crypto.randomUUID();
      const input: ChannelMessage = { role: 'user', id: reactionId, text: notice, timestamp: Date.now(), source: { agentId: 'human', name: 'Human', channelId, chainId: '', messageId, human: true, reaction: true, ...(groupId ? { groupId } : {}) } };
      this.runs.enqueue({ agentId, channelId: channel.id, clientMessageId: reactionId, inputSource: 'agent' }, context => this.runInbox(agentId, input, context), { queueTimeoutMs: 300000, executionTimeoutMs: 90000 });
    }).catch(() => {}).finally(() => {
      this.controllers.delete(controller);
      const remaining = (this.pending.get(agentId) ?? 1) - 1;
      if (remaining) this.pending.set(agentId, remaining); else this.pending.delete(agentId);
      if (this.tails.get(agentId) === work) this.tails.delete(agentId);
    });
    this.tails.set(agentId, work);
  }
  async cancelAgent(agentId: string) {
    for (const [controller, owner] of this.controllers) if (owner === agentId) controller.abort();
    await this.tails.get(agentId);
  }
  close() { this.closing = true; for (const controller of this.controllers.keys()) controller.abort(); }
  async settled() { await Promise.all([...this.tails.values()]); }
}
