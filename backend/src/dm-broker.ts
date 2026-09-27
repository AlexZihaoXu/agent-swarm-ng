import type { AgentRuns, RunContext } from './agent-runs';
import type { PlatformStore } from './platform-store';
import type { EndpointStore } from './endpoint-store';
import type { CodexProvider } from './codex-provider';
import { SwarmStore, dmReplyInclude } from './swarm-store';
import { createDmTools, type DmReceipt } from './dm-tools';
import { resolveChatConnection } from './chat-connection';
import type { AgentMessageSource, ChannelMessage } from './chat-runtime';
import { runChat } from './chat-runner';
import { createChatHistoryTools } from './chat-history-tools';
import { messageText } from './message-text';
import { isLiveChain } from './communication-policy';
import { GroupStore, groupReplyInclude } from './group-store';
import { createGroupTools } from './group-tools';
import { groupSource, groupMessageView } from './group-message';
import { ReactionStore } from './reaction-store';
import { createReactionTools } from './reaction-tools';
import { ReactionCoordinator } from './reaction-coordinator';
import { channelReply, groupReplyContext, dmReplyContext } from './reply-preview';
import { AgentSessionStore } from './agent-session-store';
import { ActivityStore } from './activity-store';
import { SwarmKnowledgePlugin } from './swarm-knowledge/plugin';
import type { ComputerUseService } from './computer-use/service';
import type { ScreenshotPool } from './computer-use/image-pool';
import { createComputerTools } from './computer-use/tools';

type Job = { senderId: string; rootAgentId: string | null; chainId: string; run: ReturnType<AgentRuns['enqueue']>; cleanup: Promise<void> };
/** Publishes once, then admits a source-labelled message to the recipient's normal inbox. */
export class DmBroker {
  readonly store: SwarmStore;
  readonly groups: GroupStore;
  readonly reactions: ReactionStore;
  readonly sessions: AgentSessionStore;
  readonly activity: ActivityStore;
  readonly knowledge: SwarmKnowledgePlugin;
  private reactionCoordinator: ReactionCoordinator;
  private starting?: Promise<void>;
  private closing = false;
  private jobs = new Map<string, Job>();
  private cancelling = new Map<string, Promise<void>>();
  private deleting = new Set<string>();
  private linked = new WeakSet<AbortSignal>();
  constructor(private database: PlatformStore, private endpoints: EndpointStore, private codex: CodexProvider, private runs: AgentRuns, private computers?: ComputerUseService, private screenshots?: ScreenshotPool) {
    this.store = new SwarmStore(database); this.groups = new GroupStore(database); this.reactions = new ReactionStore(database); this.sessions = new AgentSessionStore(database);
    this.activity = new ActivityStore(database);
    this.runs.setLifecycle(async (run, state, emit) => {
      await this.ready();
      const entry = await this.activity.lifecycle(run, state);
      if (entry) emit({ type: 'activity', agentId: run.agentId, append: false, entry });
    });
    this.knowledge = new SwarmKnowledgePlugin(database);
    this.reactionCoordinator = new ReactionCoordinator(database, endpoints, codex, runs, (agentId, input, context) => this.runInbox(agentId, input, context));
  }
  notifyHumanReaction(channelId: string, messageId: string, emoji: string) { return this.reactionCoordinator.offer(channelId, messageId, emoji); }
  ready() { return this.starting ??= (async () => { await this.store.cancelInterruptedDeliveries(); await this.activity.interruptActive(); await this.computers?.ready(); })(); }
  async send(senderId: string, recipientId: string, text: string, callId: string, context: RunContext, inheritedChain?: string, replyToId?: string): Promise<DmReceipt> {
    context.signal.throwIfAborted();
    if (this.closing || this.deleting.has(senderId) || this.deleting.has(recipientId)) throw new Error('DM delivery is unavailable.');
    await this.ready(); context.signal.throwIfAborted();
    const chainId = inheritedChain ?? context.runId;
    if (!inheritedChain) {
      if (!this.linked.has(context.signal)) {
        this.linked.add(context.signal);
        context.signal.addEventListener('abort', () => { void this.cancelChain(chainId).catch(() => {}); }, { once: true });
      }
      await this.store.beginChain(senderId, chainId);
    }
    context.signal.throwIfAborted();
    const { message, duplicate } = await this.store.send({ senderId, recipientId, text, chainId, deliveryKey: `${context.runId}:${callId}`, replyToId });
    if (duplicate) return { id: message.id, conversationId: message.conversationId, status: message.status, duplicate };
    let status = message.status;
    try {
      const chain = await this.database.client.dmChain.findUnique({ where: { id: chainId } });
      if (this.closing || context.signal.aborted || this.deleting.has(senderId) || this.deleting.has(recipientId) || !isLiveChain(chain)) {
        status = 'cancelled'; await this.store.finish(message.id, recipientId, 'cancelled');
      } else {
        const recipient = await this.database.findAgent(recipientId);
        if (!recipient) throw new Error('Recipient no longer exists.');
        const incoming = await this.store.message(recipientId, senderId, message.id);
        const input: ChannelMessage = { role: 'user', text, id: message.id, timestamp: message.createdAt.getTime(), replyTo: dmReplyContext(message), source: { agentId: senderId, name: incoming.sender.name, channelId: message.conversationId, chainId, messageId: message.id } };
        const channelId = recipient.channels[0].id;
        const run = this.runs.offer(recipientId, input, { type: 'dm_updated', channelId, conversationId: message.conversationId }) ?? this.runs.enqueue({ agentId: recipientId, channelId, clientMessageId: message.id, inputSource: 'agent' }, ctx => this.runInbox(recipientId, input, ctx), { queueTimeoutMs: 300000, executionTimeoutMs: 90000 });
        const cleanup = run.finished.then(async () => {
          await this.store.finish(message.id, recipientId, run.controller.signal.aborted ? 'cancelled' : 'failed');
          run.emit({ type: 'dm_updated', conversationId: message.conversationId });
        }).catch(() => {}).finally(() => { this.jobs.delete(message.id); });
        this.jobs.set(message.id, { senderId, rootAgentId: chain!.rootAgentId, chainId, run, cleanup });
      }
    } catch {
      status = 'failed'; await this.store.finish(message.id, recipientId, 'failed');
    }
    context.emit({ type: 'dm_updated', conversationId: message.conversationId });
    return { id: message.id, conversationId: message.conversationId, status, duplicate: false };
  }
  async sendHumanGroup(groupId: string, text: string, clientMessageId: string, replyToId?: string) {
    if (this.closing) throw new Error('Group delivery is unavailable.');
    await this.ready();
    const publication = await this.groups.publishHuman(groupId, text, clientMessageId, replyToId);
    if (!publication.duplicate) await this.dispatchGroup(publication);
    return publication;
  }
  async sendGroup(agentId: string, groupId: string, text: string, callId: string, context: RunContext, inheritedChain?: string, replyToId?: string) {
    context.signal.throwIfAborted();
    if (this.closing || this.deleting.has(agentId)) throw new Error('Group delivery is unavailable.');
    await this.ready();
    const chainId = inheritedChain ?? context.runId;
    if (!inheritedChain) {
      await this.store.beginChain(agentId, chainId);
      if (!this.linked.has(context.signal)) {
        this.linked.add(context.signal);
        context.signal.addEventListener('abort', () => { void this.cancelChain(chainId).catch(() => {}); }, { once: true });
      }
    }
    context.signal.throwIfAborted();
    const publication = await this.groups.publishAgent(groupId, agentId, text, chainId, `${context.runId}:${callId}`, replyToId);
    if (!publication.duplicate) await this.dispatchGroup(publication);
    return { id: publication.message.id, conversationId: `group:${groupId}`, duplicate: publication.duplicate, status: 'published' };
  }
  private async dispatchGroup(publication: Awaited<ReturnType<GroupStore['publishHuman']>>) {
    const { message } = publication;
    const chain = await this.database.client.dmChain.findUnique({ where: { id: message.chainId } });
    for (const delivery of publication.deliveries) {
      const agentId = delivery.agentId;
      try {
        if (this.closing || this.deleting.has(agentId) || !isLiveChain(chain)) throw new Error('Recipient unavailable.');
        const recipient = await this.database.findAgent(agentId);
        if (!recipient) throw new Error('Recipient no longer exists.');
        const input: ChannelMessage = { role: 'user', text: message.text, id: message.id, timestamp: message.createdAt.getTime(), replyTo: groupReplyContext(message), source: groupSource(message) };
        const channelId = recipient.channels[0].id;
        const run = this.runs.offer(agentId, input, { type: 'group_delivery', channelId, groupId: message.groupId }) ?? this.runs.enqueue({ agentId, channelId, clientMessageId: message.id, ...(message.role === 'user' ? {} : { inputSource: 'agent' as const }) }, ctx => this.runInbox(agentId, input, ctx), { queueTimeoutMs: 300000, executionTimeoutMs: 90000 });
        const key = `${message.id}:${agentId}`;
        const cleanup = run.finished.then(async () => {
          await this.groups.finish(message.id, agentId, run.controller.signal.aborted ? 'cancelled' : 'failed');
        }).catch(() => {}).finally(() => { this.jobs.delete(key); });
        this.jobs.set(key, { senderId: message.authorId ?? 'human', rootAgentId: chain?.rootAgentId ?? null, chainId: message.chainId, run, cleanup });
      } catch { await this.groups.finish(message.id, agentId, 'failed'); }
    }
    this.runs.announce(message.groupId, groupMessageView(message), true);
  }
  async runInbox(agentId: string, incoming: ChannelMessage, context: RunContext) {
    await this.ready();
    const agent = await this.database.findAgent(agentId);
    if (!agent) throw new Error('Agent no longer exists.');
    const channel = { id: agent.channels[0].id, kind: 'platform-chat' as const, agentId };
    const connection = await resolveChatConnection(agent.endpointId, this.endpoints, this.codex, context.signal);
    const human = await this.database.context(channel.id, incoming.source ? undefined : incoming.id, incoming.source ? undefined : incoming.sequence);
    const peerHistory = await this.database.client.dmMessage.findMany({ where: { OR: [{ senderId: agentId }, { recipientId: agentId, status: { notIn: ['queued', 'running'] } }] }, orderBy: { sequence: 'desc' }, take: 8, include: { sender: { select: { name: true } }, recipient: { select: { name: true } }, ...dmReplyInclude } });
    const threads = new Map<string, AgentMessageSource>();
    const peers: ChannelMessage[] = peerHistory.reverse().map(message => {
      const source = { agentId: message.senderId, name: message.sender.name, channelId: message.conversationId, chainId: message.chainId, messageId: message.id };
      if (message.recipientId === agentId) threads.set(message.conversationId, source);
      const preview = messageText(message.text);
      return { id: message.id, role: message.senderId === agentId ? 'assistant' : 'user', text: message.senderId === agentId ? `[Sent to Agent: ${message.recipient.name} in ${message.conversationId}]
${preview.text}` : preview.text, timestamp: message.createdAt.getTime(), replyTo: dmReplyContext(message), ...(message.recipientId === agentId ? { source } : {}) };
    });
    const groupHistory = await this.database.client.groupMessage.findMany({ where: { group: { members: { some: { agentId } } }, OR: [{ authorId: agentId }, { deliveries: { some: { agentId, status: { notIn: ['queued', 'running'] } } } }] }, orderBy: { sequence: 'desc' }, take: 8, include: groupReplyInclude });
    const shared: ChannelMessage[] = groupHistory.reverse().map(message => ({ id: message.id, role: message.authorId === agentId ? 'assistant' : 'user', text: `${message.authorId === agentId ? `[Sent to group:${message.groupId}]\n` : ''}${messageText(message.text).text}`, timestamp: message.createdAt.getTime(), replyTo: groupReplyContext(message), ...(message.authorId === agentId ? {} : { source: groupSource(message) }) }));
    const pending = new Set([incoming.id, ...context.inbox.pendingIds()]);
    const history = [...human, ...peers, ...shared].filter(message => !pending.has(message.id)).sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)).slice(-8);
    let humanBatch = !incoming.source || Boolean(incoming.source.reaction);
    let humanAuthority = !incoming.source || Boolean(incoming.source.human);
    let inherited = incoming.source?.chainId;
    let sources: AgentMessageSource[] = incoming.source ? [incoming.source] : [];
    const chainFor = (recipientId: string) => humanBatch ? undefined : sources.find(source => source.agentId === recipientId)?.chainId ?? inherited;
    const peerTools = createDmTools(this.store, agentId, (recipientId, text, callId, replyToId) => this.send(agentId, recipientId, text, callId, context, chainFor(recipientId), replyToId));
    const computerTools = this.computers && this.screenshots ? createComputerTools(this.computers, this.screenshots, agentId) : [];
    const notices = await this.computers?.notices(agentId) ?? [];
    await runChat(context, {
      name: agent.name, model: agent.model, thinkingLevel: agent.thinkingLevel, baseUrl: connection.baseUrl, apiKey: connection.apiKey, channel,
      publishPeer: async (channelId, text, callId, replyToId) => {
        if (channelId.startsWith('group:')) return JSON.stringify(await this.sendGroup(agentId, channelId.slice(6), text, callId, context, humanBatch ? undefined : sources.find(source => source.channelId === channelId)?.chainId ?? inherited, replyToId));
        const source = threads.get(channelId);
        if (!source) throw new Error('Unknown agent thread. Use send_dm for a new allowed contact.');
        return JSON.stringify(await this.send(agentId, source.agentId, text, callId, context, chainFor(source.agentId), replyToId));
      },
    }, history, incoming, async (text, replyToId) => {
      if (!humanAuthority) throw new Error('Reply to the input’s explicit group or agent-thread channel, not the private human channel.');
      const message = await this.database.appendMessage(channel.id, 'assistant', text, crypto.randomUUID(), replyToId);
      return { id: message.id, sequence: message.sequence, channelId: channel.id, role: message.role, text, timestamp: message.createdAt.getTime(), replyTo: channelReply(message) };
    }, connection.accessKey, connection.subscriptionRuntime, [...createChatHistoryTools(this.database, channel, agent.name), ...peerTools, ...createGroupTools(this.groups, this.store, channel, () => humanAuthority), ...createReactionTools(this.reactions, channel, () => humanAuthority, (channelId, messageId) => this.runs.reactionsChanged(channelId, messageId)), ...this.knowledge.toolsFor(agentId), ...computerTools], {
      sessionStore: this.sessions,
      notices: notices.map(notice => notice.text),
      noticesSaved: () => this.computers?.acknowledgeNotices(agentId, notices.map(notice => notice.id)) ?? Promise.resolve(),
      activityStore: this.activity,
      prepare: async messages => {
        const admitted: ChannelMessage[] = [];
        for (const message of messages) {
          if (!message.source || message.source.reaction || (message.source.groupId ? await this.groups.claim(message.source.messageId, agentId) : await this.store.claim(message.source.messageId, agentId))) admitted.push(message);
        }
        humanBatch = admitted.some(message => !message.source || message.source.reaction);
        humanAuthority = admitted.some(message => !message.source || message.source.human);
        sources = admitted.flatMap(message => message.source ? [message.source] : []);
        inherited = sources[0]?.chainId;
        for (const source of sources) threads.set(source.channelId, source);
        return admitted;
      },
      complete: async (messages, failed) => {
        for (const message of messages) if (message.source && !message.source.reaction) {
          const status = context.signal.aborted ? 'cancelled' : failed ? 'failed' : 'completed';
          if (message.source.groupId) {
            await this.groups.finish(message.source.messageId, agentId, status);
          } else {
            await this.store.finish(message.source.messageId, agentId, status);
            context.emit({ type: 'dm_updated', conversationId: message.source.channelId });
          }
        }
      },
    });
  }
  cancelChain(chainId: string) {
    const existing = this.cancelling.get(chainId); if (existing) return existing;
    const cancellation = this.store.cancelChain(chainId).finally(() => {
      for (const job of this.jobs.values()) if (job.chainId === chainId && !job.run.humanOwned) job.run.controller.abort();
    });
    this.cancelling.set(chainId, cancellation);
    void cancellation.finally(() => { this.cancelling.delete(chainId); }).catch(() => {});
    return cancellation;
  }
  async stopChainForRun(runId: string) {
    const job = [...this.jobs.values()].find(item => item.run.runId === runId);
    await this.cancelChain(job?.chainId ?? runId);
  }
  async beforeDelete(agentId: string) {
    this.deleting.add(agentId);
    await this.reactionCoordinator.cancelAgent(agentId);
    await this.runs.settled(agentId);
    const related = [...this.jobs.values()].filter(job => job.senderId === agentId || job.rootAgentId === agentId || job.run.agentId === agentId);
    await Promise.all([...new Set(related.map(job => job.chainId))].map(id => this.cancelChain(id)));
    await Promise.all(related.filter(job => !job.run.humanOwned).map(job => job.cleanup));
  }
  afterDelete(agentId: string) { this.deleting.delete(agentId); }
  close() { this.closing = true; this.reactionCoordinator.close(); }
  async settled() { await this.starting; await this.reactionCoordinator.settled(); await Promise.all([...this.jobs.values()].map(job => job.cleanup)); await Promise.all(this.cancelling.values()); }
}
