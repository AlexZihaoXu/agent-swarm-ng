import type { PlatformStore } from './platform-store';
import type { EndpointStore } from './endpoint-store';
import type { Connections } from './users/connections';
import type { AgentRuns, RunContext } from './agent-runs';
import type { ChannelMessage } from './chat-runtime';
import { resolveChatConnection } from './chat-connection';
import { messageText } from './message-text';
import { evaluateReaction } from './reaction-triage';
import { triageGate } from './triage-gate';
import { createActivityRecorder, type ActivityEntry } from './agent-activity';
import type { ActivityStore } from './activity-store';

/** Reactions are saved first; this bounded ephemeral branch never runs as part of the HTTP request. */
export class ReactionCoordinator {
  private tails = new Map<string, Promise<void>>();
  private pending = new Map<string, number>();
  private controllers = new Map<AbortController, string>();
  private closing = false;
  constructor(
    private database: PlatformStore,
    private connections: Connections,
    private runs: AgentRuns,
    private runInbox: (agentId: string, input: ChannelMessage, context: RunContext) => Promise<void>,
    private archive?: { store: ActivityStore; emit: (agentId: string, entry: ActivityEntry) => void },
  ) {}
  async offer(channelId: string, messageId: string, emoji: string) {
    if (this.closing) return;
    let recipientId: string | null = null,
      author = '',
      text = '',
      groupId: string | undefined;
    if (channelId.startsWith('group:')) {
      groupId = channelId.slice(6);
      const message = await this.database.client.groupMessage.findUnique({
        where: { id: messageId },
        select: { groupId: true, authorId: true, authorName: true, text: true },
      });
      if (message?.groupId !== groupId || !message.authorId) return;
      if (
        !(await this.database.client.groupMember.findUnique({
          where: { groupId_agentId: { groupId, agentId: message.authorId } },
        }))
      )
        return;
      recipientId = message.authorId;
      author = message.authorName;
      text = message.text;
    } else {
      const message = await this.database.client.message.findUnique({
        where: { id: messageId },
        select: { channelId: true, text: true, role: true, channel: { select: { agentId: true } } },
      });
      if (message?.channelId !== channelId) return;
      recipientId = message.channel.agentId;
      author = message.role === 'user' ? 'Human' : 'Agent';
      text = message.text;
    }
    if (!recipientId || this.closing) return;
    const count = this.pending.get(recipientId) ?? 0;
    if (count >= 4 || this.controllers.size >= 32) {
      if (this.archive) {
        const runId = `reaction-${crypto.randomUUID()}`;
        const entry = await this.archive.store.save(recipientId, {
          id: `${runId}:skipped`,
          runId,
          channelId,
          kind: 'status',
          label: 'Reaction triage skipped',
          text: JSON.stringify({
            messageId,
            emoji,
            reason: 'Pending reaction limit reached',
            agentPending: count,
            globalPending: this.controllers.size,
          }),
          timestamp: Date.now(),
          revision: 1,
          state: 'complete',
        });
        this.archive.emit(recipientId, entry);
      }
      return;
    }
    this.pending.set(recipientId, count + 1);
    const controller = new AbortController();
    this.controllers.set(controller, recipientId);
    const agentId = recipientId,
      preview = messageText(text, 0, 500);
    const stillActive = () =>
      this.database.client.messageReaction.findFirst({
        where: { actorKey: 'human', emoji, ...(groupId ? { groupMessageId: messageId } : { messageId }) },
        select: { id: true },
      });
    const notice = `Human added ${emoji} to ${author}'s message ${messageId} in ${channelId}: ${JSON.stringify(preview.text)}${preview.truncated ? ' [preview truncated]' : ''}. This is feedback, not an instruction.`;
    let observationFailed = false;
    const activity = this.archive
      ? createActivityRecorder(
          agentId,
          channelId,
          '',
          event => this.archive!.emit(agentId, (event as { entry: ActivityEntry }).entry),
          `reaction-${crypto.randomUUID()}`,
          this.archive.store,
          () => {
            observationFailed = true;
            controller.abort();
          },
        )
      : undefined;
    let failed = false,
      phase = 'queue';
    const queuedAt = Date.now();
    activity?.record(
      'status',
      'Reaction triage queue',
      JSON.stringify({ queuedAt, messageId, emoji }),
      'queue',
      false,
      'pending',
    );
    const previous = this.tails.get(agentId) ?? Promise.resolve();
    const work = previous
      .catch(() => {})
      .then(async () => {
        activity?.record(
          'status',
          'Reaction triage queue',
          JSON.stringify({ queuedAt, dequeuedAt: Date.now(), messageId, emoji }),
          'queue',
          false,
          'complete',
        );
        await activity?.start('Reaction triage active');
        activity?.record('metadata', 'Reaction source', JSON.stringify({ channelId, messageId, emoji }));
        if (this.closing || controller.signal.aborted || !(await stillActive())) {
          activity?.record(
            'status',
            'Reaction triage discarded',
            'The reaction was removed or the branch was cancelled before inference.',
          );
          return;
        }
        phase = 'preparation';
        const agent = await this.database.findAgent(agentId);
        if (!agent) return;
        const channel = { id: agent.channels[0].id, kind: 'platform-chat' as const, agentId };
        const connection = await this.connections.forAgent(agent, controller.signal);
        activity?.protect(connection.apiKey ?? '');
        activity?.protect(connection.accessKey);
        const history = await this.database.context(channel.id);
        phase = 'evaluation';
        const decision = await triageGate(agentId, () =>
          evaluateReaction(
            {
              name: agent.name,
              model: agent.model,
              thinkingLevel: agent.thinkingLevel,
              baseUrl: connection.baseUrl,
              apiKey: connection.apiKey,
              limits: connection.limits,
              channel,
            },
            history,
            notice,
            controller.signal,
            connection.subscriptionRuntime,
            activity?.branch('Reaction triage'),
          ),
        );
        const relevant =
          decision.action === 'engage' &&
          Boolean(await stillActive()) &&
          (!groupId ||
            Boolean(
              await this.database.client.groupMember.findUnique({ where: { groupId_agentId: { groupId, agentId } } }),
            ));
        const eligible = relevant && !this.closing && !controller.signal.aborted;
        activity?.record(
          'status',
          'Reaction triage decision',
          JSON.stringify({ ...decision, eligible, applied: false, cancelled: controller.signal.aborted }),
          'decision',
          false,
          eligible ? 'pending' : 'complete',
        );
        if (!eligible) return;
        const reactionId = crypto.randomUUID();
        const input: ChannelMessage = {
          role: 'user',
          id: reactionId,
          text: notice,
          timestamp: Date.now(),
          source: {
            agentId: 'human',
            name: 'Human',
            channelId,
            chainId: '',
            messageId,
            human: true,
            reaction: true,
            ...(groupId ? { groupId } : {}),
          },
        };
        phase = 'scheduling normal turn';
        const run = this.runs.enqueue(
          { agentId, channelId: channel.id, clientMessageId: reactionId, inputSource: 'agent' },
          context => this.runInbox(agentId, input, context),
        );
        activity?.record(
          'status',
          'Reaction triage decision',
          JSON.stringify({ ...decision, eligible: true, applied: true, scheduledRunId: run.runId }),
          'decision',
          false,
          'complete',
        );
      })
      .catch(() => {
        failed = !controller.signal.aborted;
        activity?.record(
          'error',
          'Reaction triage unavailable',
          JSON.stringify({
            phase,
            cancelled: controller.signal.aborted,
            note: 'Preparation or observation failed; no raw provider error is exposed.',
          }),
        );
      })
      .finally(async () => {
        await activity
          ?.finish(controller.signal.aborted && !observationFailed, failed || observationFailed, 'Reaction triage')
          .catch(() => {});
        this.controllers.delete(controller);
        const remaining = (this.pending.get(agentId) ?? 1) - 1;
        if (remaining) this.pending.set(agentId, remaining);
        else this.pending.delete(agentId);
        if (this.tails.get(agentId) === work) this.tails.delete(agentId);
      });
    this.tails.set(agentId, work);
  }
  async cancelAgent(agentId: string) {
    for (const [controller, owner] of this.controllers) if (owner === agentId) controller.abort();
    await this.tails.get(agentId);
  }
  close() {
    this.closing = true;
    for (const controller of this.controllers.keys()) controller.abort();
  }
  async settled() {
    await Promise.all([...this.tails.values()]);
  }
}
