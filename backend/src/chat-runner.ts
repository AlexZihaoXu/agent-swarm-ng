import {
  estimateTokens,
  SessionManager,
  type AgentSession,
  type ModelRuntime,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { createActivityRecorder } from './agent-activity';
import { accessOf, type AgentTool } from './tool-access';
import { openTodos, type Todo } from './todos';
import { checkTodos } from './todo-check';
import { timeNoteFor } from './time-notes';

/** Continuations in a row a turn's todo checks may start (docs/agent-todos.md). */
export const TODO_CONTINUATIONS = 3;
import { HEARTBEAT_NOTE_QUESTION, heartbeatPromotion, promotes, type HeartbeatBranch } from './heartbeat';
import { channelInput, createChatSession, type ChatConfiguration, type ChannelMessage } from './chat-runtime';
import { createWebTools } from './web-tools';
import type { RunContext } from './agent-runs';
import { evaluateInterruption } from './interruption-triage';
import { triageGate } from './triage-gate';
import { formatContextUsage } from './context-usage';
import { createPublicationTyping } from './publication-typing';
import type { BackgroundCompactor } from './background-compaction';
import { AgentSessionStore } from './agent-session-store';
import type { ActivityStore } from './activity-store';
import { forkBasis, type ForkBasis } from './computer-use/watch-judge';
import { CUE_LIMITS, inputReminder, knowledgeReminder, toolReminder, type CueRecall } from './memory/cues';
import { meterSession } from './usage/meter';

/** Knowledge tools and help are never cues (their results are Knowledge already). */
const KNOWLEDGE_TOOLS = new Set(['list_knowledge', 'search_knowledge', 'read_knowledge', 'help']);
import { MEMORY_TOOL_NAMES } from './memory/tools';
import { lastNightNote, SAVE_BEFORE_FORGETTING } from './memory/guidance';

export type InboxHooks = {
  prepare?: (messages: ChannelMessage[]) => Promise<ChannelMessage[]>;
  complete?: (messages: ChannelMessage[], failed: boolean) => Promise<void>;
  sessionStore?: AgentSessionStore;
  notices?: string[];
  noticesSaved?: () => Promise<void>;
  activityStore?: ActivityStore;
  /** The run's session as a fork would copy it: live while running, then as it ended. */
  session?: (basis: () => ForkBasis, ended: boolean) => void;
  /**
   * A heartbeat: the run is a branch of the saved session, saved only once promoted (its first change, or a real
   * message arriving). Unpromoted at the end, it asks once for a note and is dropped (`dropped` gets the note).
   */
  heartbeat?: { branch: HeartbeatBranch; dropped: (note?: string) => Promise<void> };
  /** The agent is changing something (a w or rw tool call is about to run): its Discord status counts it. */
  wrote?: () => void;
  /**
   * Long-term memory: cue-driven recall on every input and tool call, a note to memorize before compaction drops
   * details, and what the last sleep changed (told once; `lastNightTold` clears it).
   */
  memory?: { cues: CueRecall; lastNight?: string; lastNightTold?: () => Promise<void> };
  /** Background compaction: start a summary at atPercent of the context; report usage when the run ends. */
  compaction?: {
    compactor: BackgroundCompactor;
    atPercent: number;
    ended?: (usage: ReturnType<AgentSession['getContextUsage']>) => void;
  };
  /**
   * The agent's todo list (docs/agent-todos.md): when a turn ends with unfinished items, a read-only fork decides
   * whether it continues. `stoppedOn`/`stopped`: the list a check last decided to stop on (not checked again).
   */
  todos?: { get: () => Promise<Todo[]>; stoppedOn: () => string | undefined; stopped: (list: string) => void };
  /** Time notes (docs/agent-time.md#time-notes): one per clock window of `minutes`; `last`/`given` its window. */
  timeNotes?: {
    /** The owner's zone (docs/users.md#time-zone), else the platform's. */
    zone: string;
    minutes: () => number;
    last: () => string | undefined;
    given: (window: string) => void;
  };
};

export async function runChat(
  { runId, signal, emit, inbox, active }: RunContext,
  config: ChatConfiguration,
  history: ChannelMessage[],
  message: ChannelMessage,
  publish: (text: string, replyToMessageId?: string, fileIds?: string[]) => Promise<object>,
  accessKey: string,
  subscriptionRuntime?: ModelRuntime,
  historyTools: AgentTool[] = [],
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
  /** The session a background summary is being written from: kept alive until it settles. */
  let summarizing: typeof session;
  let unsubscribe = () => {};
  let checkpoint = Promise.resolve();
  let checkpointFailure: unknown;
  // A heartbeat's branch is saved only from its promotion on; everything else is saved as it goes.
  const heartbeat = hooks.heartbeat;
  let promoted = !heartbeat,
    dropped = false,
    promotionNotice: string | undefined;
  const abort = () => {
    void session?.abort();
  };
  const clearTyping = publicationTyping.clear;
  try {
    signal.throwIfAborted();
    await activity.start(hooks.heartbeat ? 'Heartbeat active' : undefined);
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
      async (text, toolCallId, final, replyToMessageId, fileIds) => {
        signal.throwIfAborted();
        await activity.flush();
        signal.throwIfAborted();
        // Publication belongs to the channel, not any connected browser.
        const saved = await publish(text, replyToMessageId, fileIds);
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
    // Model usage of every response (the dashboard): an unpromoted heartbeat's calls are its own purpose.
    meterSession(session, {
      agentId: channel.agentId,
      purpose: () => (promoted ? 'turn' : 'heartbeat'),
      saved: Boolean(hooks.sessionStore),
    });
    if (hooks.sessionStore && !restored && session.sessionManager.getEntries().length)
      await hooks.sessionStore.save(channel.agentId, session.sessionManager);
    const live = session;
    // Durable checkpoints are captured at a boundary and written in order, off the model's critical path.
    const queueCheckpoint = () => {
      if (!promoted) return;
      try {
        const snapshot = AgentSessionStore.capture(live.sessionManager);
        checkpoint = checkpoint
          .then(() => hooks.sessionStore!.save(channel.agentId, snapshot, { advancePublications: false }))
          .catch(error => {
            checkpointFailure = error;
            void live.abort();
          });
      } catch (error) {
        checkpointFailure = error;
        void live.abort();
      }
    };
    const promote = (reason: string) => {
      if (promoted) return false;
      promoted = true;
      if (heartbeat) heartbeat.branch.promoted = true;
      // Now it is real work: the run counts as active time from its start.
      active?.();
      activity.record('status', 'Heartbeat promoted', `It became a real turn: ${reason}.`);
      queueCheckpoint();
      return true;
    };
    // What each tool does (tool-access.ts), for write activity and heartbeats.
    const access = new Map<string, ReturnType<typeof accessOf>>([
      ['send_message', 'w'],
      ['help', 'r'],
      ...[...historyTools, ...web.tools].map(tool => [tool.name, accessOf(tool)] as const),
    ]);
    if (hooks.wrote) {
      const before = live.agent.beforeToolCall;
      live.agent.beforeToolCall = async (context, callSignal) => {
        const kind = access.get(context.toolCall.name);
        if (kind !== 'r' && kind !== 'claim') hooks.wrote!();
        return before?.(context, callSignal);
      };
    }
    if (heartbeat) {
      const promotedCalls = new Set<string>();
      const before = live.agent.beforeToolCall;
      live.agent.beforeToolCall = async (context, callSignal) => {
        const name = context.toolCall.name;
        if (!promoted && heartbeat.branch.asking && name !== 'leave_note')
          return { block: true, reason: 'Only leave_note is available now, or end without a note.' };
        if (!promoted && promotes(access.get(name), heartbeat.branch, context.args) && promote(`you called ${name}`))
          promotedCalls.add(context.toolCall.id);
        return before?.(context, callSignal);
      };
      const after = live.agent.afterToolCall;
      live.agent.afterToolCall = async (context, callSignal) => {
        const result = await after?.(context, callSignal);
        if (!promotedCalls.delete(context.toolCall.id)) return result;
        const content = result?.content ?? context.result.content;
        return {
          ...result,
          content: [
            { type: 'text' as const, text: heartbeatPromotion(`you called ${context.toolCall.name}`) },
            ...content,
          ],
        };
      };
      // A real message arriving makes the heartbeat a real turn: that message is answered in it.
      inbox.onAdd = () => {
        if (promote('a new message arrived')) promotionNotice = heartbeatPromotion('a new message arrived');
      };
    }
    // Time notes: the current time once per clock window, stacked before the next model call (never interrupting).
    const timeNote = () => {
      const notes = hooks.timeNotes;
      if (!notes || (heartbeat && !promoted)) return null;
      const note = timeNoteFor(new Date(), notes.minutes(), notes.zone, notes.last());
      if (!note) return null;
      notes.given(note.window);
      activity.record('status', 'Time note', note.text);
      return note.text;
    };
    const noteLine = () => {
      const note = timeNote();
      return note ? `${note}\n` : '';
    };
    if (hooks.timeNotes) {
      const after = live.agent.afterToolCall;
      live.agent.afterToolCall = async (context, callSignal) => {
        const result = await after?.(context, callSignal);
        const note = timeNote();
        if (!note) return result;
        return {
          ...result,
          content: [...(result?.content ?? context.result.content), { type: 'text' as const, text: note }],
        };
      };
    }
    // Cue-driven recall: a tool's arguments and result may bring memories to mind (one short line each, a few per turn).
    const memory = hooks.memory;
    const windowTokens = live.model?.contextWindow ?? 32768;
    let cued = 0;
    const cue = async (text: string, limit: number) => {
      if (!memory) return [];
      const hits = await memory.cues
        .cue(channel.agentId, text, Math.min(limit, CUE_LIMITS.turn - cued), windowTokens)
        .catch(() => []);
      cued += hits.length;
      return hits;
    };
    if (memory) {
      const after = live.agent.afterToolCall;
      live.agent.afterToolCall = async (context, callSignal) => {
        const result = await after?.(context, callSignal);
        const name = context.toolCall.name;
        // Reading a Knowledge entry puts it in view: no pointer to it for a while.
        if (name === 'read_knowledge')
          memory.cues.readKnowledge(channel.agentId, String((context.args as { id?: unknown })?.id ?? ''));
        if (MEMORY_TOOL_NAMES.has(name) || KNOWLEDGE_TOOLS.has(name) || cued >= CUE_LIMITS.turn) return result;
        const content = result?.content ?? context.result.content;
        const said = content.flatMap(part => (part.type === 'text' ? [part.text] : []));
        // Image-only results are not cues; only the start of a long result is read.
        if (!said.length) return result;
        const text = `${JSON.stringify(context.args ?? {}).slice(0, 1024)}\n${said.join('\n').slice(0, CUE_LIMITS.scanChars)}`;
        const hits = await cue(text, CUE_LIMITS.tool);
        const pointer =
          cued < CUE_LIMITS.turn ? memory.cues.knowledgeCue(channel.agentId, text, windowTokens, name) : null;
        if (pointer) cued++;
        if (!hits.length && !pointer) return result;
        return {
          ...result,
          content: [
            ...content,
            ...(hits.length ? [{ type: 'text' as const, text: toolReminder(hits) }] : []),
            ...(pointer ? [{ type: 'text' as const, text: knowledgeReminder(pointer) }] : []),
          ],
        };
      };
    }
    // Background compaction: a summary written while the agent works, applied between model calls.
    const background = hooks.sessionStore ? hooks.compaction : undefined;
    const agentId = channel.agentId;
    const applySummary = () => {
      const outcome = background?.compactor.splice(agentId, live);
      if (outcome === 'spliced') {
        hooks.memory?.cues.reset(agentId);
        activity.record(
          'status',
          'Background compaction applied',
          'Earlier context was replaced by its summary; everything after it is kept verbatim.',
        );
        queueCheckpoint();
      } else if (outcome === 'stale')
        activity.record(
          'status',
          'Background compaction discarded',
          'The summary no longer matched this context (it changed meanwhile).',
        );
      return outcome === 'spliced';
    };
    /** Before a model call: sleep if the context is nearly full while a summary is being written, then apply it. */
    const beforeModelCall = async (callSignal: AbortSignal) => {
      // An unpromoted heartbeat leaves summaries alone: it may be dropped.
      if (!background || !promoted) return false;
      const usage = live.getContextUsage();
      const reserve = live.settingsManager.getCompactionSettings().reserveTokens;
      if (
        background.compactor.running(agentId) &&
        usage?.tokens != null &&
        usage.tokens > usage.contextWindow - reserve
      ) {
        activity.record(
          'status',
          'Sleeping',
          'The context is nearly full: waiting for the background summary before continuing.',
        );
        await background.compactor.sleep(agentId, AbortSignal.any([signal, callSignal]));
      }
      return applySummary();
    };
    if (background) {
      const next = live.agent.prepareNextTurnWithContext;
      live.agent.prepareNextTurnWithContext = async (turn, turnSignal) => {
        const spliced = await beforeModelCall(turnSignal ?? signal);
        const context = spliced ? { ...turn.context, messages: live.agent.state.messages.slice() } : turn.context;
        return next ? next({ ...turn, context }, turnSignal) : spliced ? { context } : undefined;
      };
    }
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
        memory?.cues.advance(channel.agentId, estimateTokens(event.message));
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
        queueCheckpoint();
      }
      // The context passed the agent's threshold: summarize its earlier part in the background.
      if (
        background &&
        promoted &&
        !signal.aborted &&
        event.type === 'turn_end' &&
        event.message.role === 'assistant' &&
        !['aborted', 'error'].includes(event.message.stopReason)
      ) {
        const percent = live.getContextUsage()?.percent;
        if (percent != null && percent >= background.atPercent && background.compactor.start(agentId, live)) {
          summarizing = live;
          // Save before forgetting: Pi holds this note until the current tool calls finish.
          if (memory)
            void live
              .sendCustomMessage(
                { customType: 'memory-save', display: false, content: SAVE_BEFORE_FORGETTING },
                { triggerTurn: false },
              )
              .catch(() => {});
          activity.record(
            'status',
            'Background compaction started',
            `Context at ${Math.round(percent)}% (starts at ${background.atPercent}%): summarizing earlier context while the agent keeps working.`,
          );
        }
      }
      publicationTyping.onEvent(event);
    });
    unsubscribe = () => {
      detachSession();
      detachActivity();
    };
    const main = session;
    if (memory?.lastNight) {
      await main.sendCustomMessage(
        { customType: 'sleep-note', display: false, content: lastNightNote(memory.lastNight) },
        { triggerTurn: false },
      );
      await hooks.sessionStore?.save(channel.agentId, main.sessionManager, { advancePublications: false });
      await memory.lastNightTold?.();
    }
    if (hooks.notices?.length) {
      // Notices are non-chat events too: they may bring memories to mind.
      const hits = await cue(hooks.notices.join('\n'), CUE_LIMITS.input);
      await main.sendCustomMessage(
        {
          customType: 'computer-release',
          display: false,
          content: `Computer control notices (platform state, not a new human request):\n${hooks.notices.join('\n')}${hits.length ? `\n${inputReminder(hits)}` : ''}`,
        },
        { triggerTurn: false },
      );
      await hooks.sessionStore?.save(channel.agentId, main.sessionManager, { advancePublications: false });
      await hooks.noticesSaved?.();
    }
    const stopReason = (): string | undefined => lastStopReason;
    // Unfinished todos when a turn ends: a read-only fork of the conversation decides whether to keep going, and
    // its note continues the main branch (at most TODO_CONTINUATIONS times in a row).
    const reads = new Set([...access].flatMap(([name, kind]) => (kind === 'r' ? [name] : [])));
    const todoGate = async (peerOnly: boolean) => {
      if (!hooks.todos) return;
      for (let round = 0; round <= TODO_CONTINUATIONS; round++) {
        // A turn ends by stopping, or by delivering its final reply (send_message final:true ends it at once).
        const ended =
          stopReason() === 'stop' || (finalPublished && !['error', 'aborted', 'length'].includes(stopReason() ?? ''));
        if (signal.aborted || main.isStreaming || inbox.hasPending() || !ended) return;
        if (heartbeat && !promoted) return;
        const todos = await hooks.todos.get().catch(() => []);
        const open = openTodos(todos);
        const list = JSON.stringify(todos);
        if (!open.length || list === hooks.todos.stoppedOn()) return;
        if (round === TODO_CONTINUATIONS) {
          activity.record(
            'status',
            'Todo check: limit',
            `Continued ${TODO_CONTINUATIONS} times in a row; stopping here with ${open.length} unfinished.`,
          );
          // Not again for this list: every later turn would otherwise repeat the same continuations.
          hooks.todos.stopped(list);
          return;
        }
        activity.record(
          'status',
          'Todo check',
          `${open.length} of ${todos.length} unfinished: a read-only fork decides whether to continue.`,
        );
        // Not under the triage lock, and cancelled the moment a message arrives: new messages come first.
        const arrived = new AbortController();
        const previousOnAdd = inbox.onAdd;
        inbox.onAdd = () => {
          previousOnAdd?.();
          arrived.abort();
        };
        let decision: Awaited<ReturnType<typeof checkTodos>>;
        try {
          decision = await checkTodos({
            main,
            thinkingLevel: config.thinkingLevel,
            channelId: channel.id,
            todos,
            reads,
            signal: AbortSignal.any([signal, arrived.signal]),
            trace: activity.branch('Todo check'),
            agentId: channel.agentId,
          });
        } finally {
          inbox.onAdd = previousOnAdd;
        }
        if (arrived.signal.aborted || signal.aborted) {
          activity.record('status', 'Todo check: cancelled', 'A message arrived; it comes first.');
          return;
        }
        activity.record(
          'status',
          decision.action === 'continue' ? 'Todo check: continue' : 'Todo check: stop',
          decision.note,
        );
        if (decision.action !== 'continue') {
          // A real decision is remembered; a failed check is not (the next turn may check again).
          if (!decision.failed) hooks.todos.stopped(list);
          return;
        }
        // A message that arrived during the check comes first; the list is checked again after it.
        if (inbox.hasPending() || signal.aborted) return;
        const before = published;
        await main.sendCustomMessage(
          {
            customType: 'todo-continue',
            display: false,
            content: `${noteLine()}Automatic todo check (from the platform, not a human message), continuation ${round + 1}/${TODO_CONTINUATIONS}. Your own read-only review says: ${decision.note}`,
          },
          { triggerTurn: true },
        );
        // A continuation that ended without telling anyone: the usual reminder that plain output is internal.
        if (!peerOnly && published === before && !signal.aborted && !main.isStreaming && stopReason() === 'stop')
          await main.sendCustomMessage(
            {
              customType: 'channel-delivery-reminder',
              display: false,
              content: `${noteLine()}Automatic channel reminder: you continued your work but sent nothing to channel ${channel.id}. Plain assistant output is internal. If you finished something the human is waiting for, report it with send_message (channelId=${JSON.stringify(channel.id)}, final:true); otherwise remain silent.`,
            },
            { triggerTurn: true },
          );
      }
    };
    while (inbox.hasPending() && !signal.aborted) {
      const batch = await inbox.take(signal);
      // A summary finished since the last prompt (or while idle): this prompt's first model call already uses it.
      await beforeModelCall(signal);
      if (activityFailed) throw new Error('Activity persistence failed.');
      if (hooks.prepare) batch.messages = await hooks.prepare(batch.messages);
      if (!batch.messages.length) continue;
      // A real message (even one that arrived before the heartbeat started) makes it a real turn before it is read.
      if (heartbeat && batch.messages.some(item => item.source?.platform !== 'heartbeat'))
        promote('a new message arrived');
      const peerOnly = batch.messages.every(item => item.source);
      published = 0;
      finalPublished = false;
      lastStopReason = undefined;
      // Every input of the batch (messages and non-chat events alike) is a cue; a turn has a ceiling of reminders.
      cued = 0;
      const inputs: string[] = [];
      for (const item of batch.messages) {
        const hits = await cue(item.text, CUE_LIMITS.input);
        const pointer =
          memory && cued < CUE_LIMITS.turn ? memory.cues.knowledgeCue(channel.agentId, item.text, windowTokens) : null;
        if (pointer) cued++;
        inputs.push(
          `${channelInput(channel.id, item.text, item)}${hits.length ? `\n${inputReminder(hits)}` : ''}${pointer ? `\n${knowledgeReminder(pointer)}` : ''}`,
        );
      }
      const noted = timeNote();
      if (noted) inputs.unshift(noted);
      if (batch.note)
        await main.sendCustomMessage(
          { customType: 'interruption-decision', display: false, content: batch.note },
          { triggerTurn: false },
        );
      if (promotionNotice) {
        await main.sendCustomMessage(
          { customType: 'heartbeat-promoted', display: false, content: promotionNotice },
          { triggerTurn: false },
        );
        promotionNotice = undefined;
      }
      const interrupted = await inbox.during(
        async () => {
          await main.prompt(inputs.join('\n\n'), {
            expandPromptTemplates: false,
          });
          if (!peerOnly && !finalPublished && !signal.aborted && !main.isStreaming && stopReason() === 'stop') {
            clearTyping();
            await main.sendCustomMessage(
              {
                customType: 'channel-delivery-reminder',
                display: false,
                // A turn the platform starts gets a due time note too (before every model call).
                content:
                  noteLine() +
                  (published
                    ? `Automatic channel reminder: your earlier messages reached channel ${channel.id}, but no final reply was delivered. Plain assistant output is internal. Continue unfinished work, or deliver the actual result/limitation using send_message with channelId=${JSON.stringify(channel.id)} and final:true. Do not repeat delivered parts or the acknowledgment, or merely promise to send the result. If several sections remain, send them sequentially with final:false and use final:true only for the last part.`
                    : `Automatic channel reminder: nothing was sent to channel ${channel.id}. Plain assistant output is internal. For an actionable task, acknowledge now with send_message and final:false, then continue working and publish the result with final:true. If the answer is already ready, deliver it now with final:true. Use channelId=${JSON.stringify(channel.id)}. If no reply was appropriate or the user requested silence, remain silent.`),
              },
              { triggerTurn: true },
            );
          }
          await todoGate(peerOnly);
          // A quiet heartbeat asks once for a note before it is dropped.
          if (heartbeat && !promoted && !signal.aborted && !inbox.hasPending() && stopReason() !== 'error') {
            heartbeat.branch.asking = true;
            await main.sendCustomMessage(
              { customType: 'heartbeat-note', display: false, content: HEARTBEAT_NOTE_QUESTION },
              { triggerTurn: true },
            );
            heartbeat.branch.asking = false;
          }
          // A summary that finished during the last model call joins this checkpoint.
          applySummary();
          await checkpoint;
          await activity.flush();
          if (checkpointFailure) throw checkpointFailure;
          if (!signal.aborted && promoted) await hooks.sessionStore?.save(channel.agentId, main.sessionManager);
        },
        async (messages, triageSignal) => {
          activity.record('status', 'Interruption triage', 'Evaluating new messages in a temporary full-context fork.');
          // One triage at a time per agent (interruption, reaction, Discord admission).
          const decision = await triageGate(channel.agentId, () =>
            evaluateInterruption(
              main,
              channel.id,
              messages,
              triageSignal,
              activity.branch('Interruption triage'),
              channel.agentId,
            ),
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
        providerFailed || missingFinal || incomplete
          ? published
            ? `${published} channel message(s) published before it stopped.`
            : 'Nothing was published: the people waiting received no reply.'
          : peerOnly
            ? 'Inputs from other agents or apps processed.'
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
    // Dropped (also after a failure or Stop): nothing of it is kept but its note, and what it claimed is given back.
    if (heartbeat && !promoted) {
      dropped = true;
      activity.record(
        'status',
        'Heartbeat dropped',
        heartbeat.branch.note
          ? `Nothing changed. Note kept in its context: ${heartbeat.branch.note}`
          : 'Nothing changed; nothing was kept in its context.',
      );
      await heartbeat.dropped(heartbeat.branch.note).catch(() => {});
      // Reminders shown in the dropped branch left with it.
      hooks.memory?.cues.reset(channel.agentId);
    }
    if (session) {
      const ended = { ...forkBasis(session), messages: session.messages.slice(), streamingMessage: undefined };
      hooks.session?.(() => ended, true);
    }
    // A dropped heartbeat is not activity (idle compaction keeps counting from the last real turn).
    if (session && !dropped) hooks.compaction?.ended?.(session.getContextUsage());
    const ending = session;
    if (ending && summarizing === ending && hooks.compaction?.compactor.running(channel.agentId))
      void hooks.compaction.compactor.settled(channel.agentId).finally(() => ending.dispose());
    else session?.dispose();
    await web?.close();
    try {
      await activity.finish(signal.aborted, runFailed || activityFailed, hooks.heartbeat ? 'Heartbeat' : undefined);
    } catch {
      emit({ type: 'error', message: 'Operator activity could not be saved. Published messages remain in chat.' });
    }
  }
}
