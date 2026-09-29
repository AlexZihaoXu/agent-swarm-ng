import { SessionManager, type ModelRuntime, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { createActivityRecorder } from './agent-activity';
import { channelInput, createChatSession, type ChatConfiguration, type ChannelMessage } from './chat-runtime';
import { createWebTools } from './web-tools';
import type { RunContext } from './agent-runs';
import { evaluateInterruption } from './interruption-triage';
import { formatContextUsage } from './context-usage';
import { createPublicationTyping } from './publication-typing';
import { AgentSessionStore } from './agent-session-store';
import type { ActivityStore } from './activity-store';
import { forkBasis, type ForkBasis } from './computer-use/watch-judge';

export type InboxHooks = {
  prepare?: (messages: ChannelMessage[]) => Promise<ChannelMessage[]>;
  complete?: (messages: ChannelMessage[], failed: boolean) => Promise<void>;
  sessionStore?: AgentSessionStore;
  notices?: string[];
  noticesSaved?: () => Promise<void>;
  activityStore?: ActivityStore;
  /** The run's session as a fork would copy it: live while running, then as it ended. */
  session?: (basis: () => ForkBasis, ended: boolean) => void;
};

export async function runChat(
  { runId, signal, emit, inbox }: RunContext,
  config: ChatConfiguration,
  history: ChannelMessage[],
  message: ChannelMessage,
  publish: (text: string, replyToMessageId?: string) => Promise<object>,
  accessKey: string,
  subscriptionRuntime?: ModelRuntime,
  historyTools: ToolDefinition[] = [],
  hooks: InboxHooks = {},
) {
  const { channel } = config;
  inbox.prepend(message);
  let activityFailed = false,
    runFailed = false;
  let phase = 'initialization';
  const activity = createActivityRecorder(
    channel.agentId,
    channel.id,
    accessKey,
    emit,
    runId,
    hooks.activityStore,
    () => {
      activityFailed = true;
      void session?.abort();
    },
  );
  const publicationTyping = createPublicationTyping(channel.agentId, emit);
  let published = 0,
    finalPublished = false,
    lastStopReason: string | undefined;
  let web: Awaited<ReturnType<typeof createWebTools>> | undefined;
  let session: Awaited<ReturnType<typeof createChatSession>> | undefined;
  let unsubscribe = () => {};
  let checkpoint = Promise.resolve();
  let checkpointFailure: unknown;
  const abort = () => {
    void session?.abort();
  };
  const clearTyping = publicationTyping.clear;
  try {
    signal.throwIfAborted();
    await activity.start();
    phase = 'loading web tools';
    web = await createWebTools();
    signal.throwIfAborted();
    phase = 'restoring private context';
    const restored = await hooks.sessionStore?.load(channel.agentId);
    const manager = hooks.sessionStore ? (restored ?? SessionManager.inMemory()) : undefined;
    phase = 'creating agent session';
    session = await createChatSession(
      config,
      restored ? [] : history,
      async (text, toolCallId, final, replyToMessageId) => {
        signal.throwIfAborted();
        await activity.flush();
        signal.throwIfAborted();
        // Publication belongs to the channel, not any connected browser.
        const saved = await publish(text, replyToMessageId);
        publicationTyping.published(toolCallId);
        published++;
        if (final) finalPublished = true;
        activity.record('channel', 'Channel publication', text);
        emit({ type: 'channel_message', ...saved });
      },
      [...historyTools, ...web.tools],
      subscriptionRuntime,
      manager,
    );
    if (hooks.sessionStore && !restored && session.sessionManager.getEntries().length)
      await hooks.sessionStore.save(channel.agentId, session.sessionManager);
    const live = session;
    hooks.session?.(() => forkBasis(live), false);
    signal.addEventListener('abort', abort, { once: true });
    signal.throwIfAborted();
    phase = 'running';
    const detachActivity = activity.attach(session);
    const reportContext = () =>
      activity.record('status', 'Context usage', formatContextUsage(session!.getContextUsage()), 'context-usage');
    reportContext();
    const detachSession = session.subscribe(event => {
      if (event.type === 'message_end') {
        // Recovery can remove truncated/error responses from working context.
        // Preserve the observed outcome instead of inferring it from that context.
        if (event.message.role === 'assistant') lastStopReason = event.message.stopReason;
        reportContext();
      }
      if (
        hooks.sessionStore &&
        !signal.aborted &&
        ((event.type === 'turn_end' &&
          event.message.role === 'assistant' &&
          !['aborted', 'error'].includes(event.message.stopReason)) ||
          (event.type === 'compaction_end' && event.result && !event.aborted))
      ) {
        // Capture the completed boundary now; a later provider turn may already be streaming
        // by the time the queued SQLite write acquires its short transaction.
        try {
          const snapshot = AgentSessionStore.capture(session!.sessionManager);
          checkpoint = checkpoint
            .then(() => hooks.sessionStore!.save(channel.agentId, snapshot, { advancePublications: false }))
            .catch(error => {
              checkpointFailure = error;
              void session?.abort();
            });
        } catch (error) {
          checkpointFailure = error;
          void session?.abort();
        }
      }
      publicationTyping.onEvent(event);
    });
    unsubscribe = () => {
      detachSession();
      detachActivity();
    };
    const main = session;
    if (hooks.notices?.length) {
      await main.sendCustomMessage(
        {
          customType: 'computer-release',
          display: false,
          content: `Computer control notices (platform state, not a new human request):\n${hooks.notices.join('\n')}`,
        },
        { triggerTurn: false },
      );
      await hooks.sessionStore?.save(channel.agentId, main.sessionManager, { advancePublications: false });
      await hooks.noticesSaved?.();
    }
    const stopReason = (): string | undefined => lastStopReason;
    while (inbox.hasPending() && !signal.aborted) {
      const batch = await inbox.take(signal);
      if (activityFailed) throw new Error('Activity persistence failed.');
      if (hooks.prepare) batch.messages = await hooks.prepare(batch.messages);
      if (!batch.messages.length) continue;
      const peerOnly = batch.messages.every(item => item.source);
      published = 0;
      finalPublished = false;
      lastStopReason = undefined;
      if (batch.note)
        await main.sendCustomMessage(
          { customType: 'interruption-decision', display: false, content: batch.note },
          { triggerTurn: false },
        );
      const interrupted = await inbox.during(
        async () => {
          await main.prompt(batch.messages.map(item => channelInput(channel.id, item.text, item)).join('\n\n'), {
            expandPromptTemplates: false,
          });
          if (!peerOnly && !finalPublished && !signal.aborted && !main.isStreaming && stopReason() === 'stop') {
            clearTyping();
            await main.sendCustomMessage(
              {
                customType: 'channel-delivery-reminder',
                display: false,
                content: published
                  ? `Automatic channel reminder: your earlier messages reached channel ${channel.id}, but no final reply was delivered. Plain assistant output is internal. Continue unfinished work, or deliver the actual result/limitation using send_message with channelId=${JSON.stringify(channel.id)} and final:true. Do not repeat delivered parts or the acknowledgment, or merely promise to send the result. If several sections remain, send them sequentially with final:false and use final:true only for the last part.`
                  : `Automatic channel reminder: nothing was sent to channel ${channel.id}. Plain assistant output is internal. For an actionable task, acknowledge now with send_message and final:false, then continue working and publish the result with final:true. If the answer is already ready, deliver it now with final:true. Use channelId=${JSON.stringify(channel.id)}. If no reply was appropriate or the user requested silence, remain silent.`,
              },
              { triggerTurn: true },
            );
          }
          await checkpoint;
          await activity.flush();
          if (checkpointFailure) throw checkpointFailure;
          if (!signal.aborted) await hooks.sessionStore?.save(channel.agentId, main.sessionManager);
        },
        async (messages, triageSignal) => {
          activity.record('status', 'Interruption triage', 'Evaluating new messages in a temporary full-context fork.');
          const decision = await evaluateInterruption(
            main,
            channel.id,
            messages,
            triageSignal,
            activity.branch('Interruption triage'),
          );
          activity.record(
            'status',
            triageSignal.aborted ? 'Triage discarded' : 'Triage decision',
            triageSignal.aborted
              ? 'Fork cancelled or superseded; its decision was not applied.'
              : `${decision.action}: ${decision.reason}`,
          );
          return decision;
        },
        async () => {
          await main.abort();
        },
        signal,
      );
      clearTyping();
      reportContext();
      if (
        !interrupted &&
        (signal.aborted ||
          ['error', 'aborted'].includes(stopReason() ?? '') ||
          (!peerOnly && !published && stopReason() !== 'stop'))
      )
        emit({
          type: 'error',
          message:
            'The agent could not finish its response. It may have been stopped, timed out, or encountered a model error.',
        });
      await hooks.complete?.(batch.messages, signal.aborted || ['error', 'aborted'].includes(stopReason() ?? ''));
      const missingFinal =
        !peerOnly && !interrupted && published > 0 && !finalPublished && !signal.aborted && stopReason() === 'stop';
      if (missingFinal)
        emit({ type: 'error', message: 'The agent acknowledged the request but did not deliver a final reply.' });
      const providerFailed = !interrupted && !signal.aborted && ['error', 'aborted'].includes(stopReason() ?? '');
      const incomplete = !interrupted && !finalPublished && ['length', 'pending'].includes(stopReason() ?? '');
      runFailed ||= providerFailed || missingFinal || incomplete;
      if (incomplete && !peerOnly && published > 0)
        emit({ type: 'error', message: 'The model response ended before a final reply was delivered.' });
      activity.record(
        providerFailed || missingFinal || incomplete ? 'error' : 'status',
        signal.aborted
          ? 'Stopped'
          : interrupted
            ? 'Interrupted for new messages'
            : missingFinal
              ? 'Final reply missing'
              : providerFailed
                ? 'Turn failed'
                : incomplete
                  ? 'Turn incomplete'
                  : 'Turn ended',
        peerOnly
          ? 'Agent-thread inputs processed.'
          : published
            ? `${published} channel message(s) published.`
            : 'No channel message published.',
      );
    }
    inbox.close();
  } catch {
    runFailed = !signal.aborted;
    activity.record(
      'metadata',
      'Run failure context',
      JSON.stringify({
        phase,
        checkpointFailed: Boolean(checkpointFailure),
        activityFailed,
        cancelled: signal.aborted,
      }),
    );
    activity.record(
      'error',
      signal.aborted ? 'Stopped' : 'Request failed',
      signal.aborted
        ? 'The agent run was stopped.'
        : checkpointFailure
          ? 'The private agent session could not be saved. Published messages remain in chat.'
          : 'The model request failed. Check the endpoint and model configuration.',
    );
    emit({
      type: 'error',
      message: signal.aborted
        ? 'The agent was stopped.'
        : checkpointFailure
          ? 'The private agent session could not be saved. Published messages remain in chat.'
          : 'The model request failed. Check the endpoint, model, and tool-calling support.',
    });
  } finally {
    inbox.close();
    clearTyping();
    unsubscribe();
    signal.removeEventListener('abort', abort);
    await checkpoint;
    if (session) {
      const ended = { ...forkBasis(session), messages: session.messages.slice(), streamingMessage: undefined };
      hooks.session?.(() => ended, true);
    }
    session?.dispose();
    await web?.close();
    try {
      await activity.finish(signal.aborted, runFailed || activityFailed);
    } catch {
      emit({ type: 'error', message: 'Operator activity could not be saved. Published messages remain in chat.' });
    }
  }
}
