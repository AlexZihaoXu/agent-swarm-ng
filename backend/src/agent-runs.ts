import { MessageInbox } from './message-inbox';
import { AgentWorkQueue, type WorkTicket } from './agent-work-queue';
import type { ChannelMessage } from './chat-runtime';
import type { ActivityEntry } from './agent-activity';
export type RunIdentity = { agentId: string; channelId: string; clientMessageId: string; inputSource?: 'agent' };
export type RunState = RunIdentity & { runId: string; typing: boolean; typingTargets?: string[]; queued?: boolean };
export type RunEvent = Record<string, unknown> & {
  type: string;
  eventId: string;
  runId: string;
  agentId: string;
  channelId: string;
};
export type RunContext = { runId: string; signal: AbortSignal; emit: (event: object) => void; inbox: MessageInbox };
type Run = RunState & {
  humanOwned: boolean;
  controller: AbortController;
  finished: Promise<void>;
  inbox: MessageInbox;
  emit: (event: object) => void;
  ticket?: WorkTicket;
};

/** One execution slot per agent; separate conversations keep separate runs/inboxes. */
export class AgentRuns {
  private runs = new Map<string, Run>();
  private queue = new AgentWorkQueue();
  private listeners = new Set<(event: RunEvent) => void>();
  private closing = false;
  private lifecycle?: (
    run: RunState,
    state: 'queued' | 'completed' | 'failed' | 'cancelled',
    emit: (event: object) => void,
  ) => Promise<void>;
  setLifecycle(handler: NonNullable<AgentRuns['lifecycle']>) {
    this.lifecycle = handler;
  }
  private stops = new Map<string, number>();
  stopVersion(agentId: string) {
    return this.stops.get(agentId) ?? 0;
  }
  constructor(private timeoutMs = Number(process.env.AGENT_RUN_TIMEOUT_MS ?? 0)) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647)
      throw new Error('Invalid AGENT_RUN_TIMEOUT_MS');
  }
  has(agentId: string) {
    return [...this.runs.values()].some(run => run.agentId === agentId);
  }
  offer(agentId: string, message: ChannelMessage, event: object) {
    const channelId = (event as { channelId?: string }).channelId;
    // Never offer a human message to a peer-DM session for the same agent.
    const run = [...this.runs.values()]
      .reverse()
      .find(
        item =>
          item.agentId === agentId &&
          item.channelId === channelId &&
          !item.controller.signal.aborted &&
          item.inbox.add(message),
      );
    if (!run) return undefined;
    if (!message.source || message.source.human) run.humanOwned = true;
    run.emit(event);
    return run;
  }
  async settled(agentId: string) {
    const runs = [...this.runs.values()].filter(run => run.agentId === agentId);
    await Promise.all(runs.map(run => run.finished));
    return runs.some(run => run.controller.signal.aborted);
  }
  snapshot(): RunState[] {
    return [...this.runs.values()].map(
      ({ agentId, channelId, clientMessageId, runId, typing, typingTargets, queued }) => ({
        agentId,
        channelId,
        clientMessageId,
        runId,
        typing,
        ...(typingTargets ? { typingTargets } : {}),
        ...(queued ? { queued: true } : {}),
      }),
    );
  }
  subscribe(listener: (event: RunEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  announce(groupId: string, message?: object, publication = false) {
    const event: RunEvent = {
      type: 'group_updated',
      groupId,
      message,
      publication,
      eventId: crypto.randomUUID(),
      runId: 'platform',
      agentId: 'human',
      channelId: `group:${groupId}`,
    };
    this.broadcast(event);
  }
  groupDeleted(groupId: string) {
    this.broadcast({
      type: 'group_deleted',
      groupId,
      eventId: crypto.randomUUID(),
      runId: 'platform',
      agentId: 'human',
      channelId: `group:${groupId}`,
    });
  }
  reactionsChanged(channelId: string, messageId: string) {
    this.broadcast({
      type: 'reactions_updated',
      messageId,
      eventId: crypto.randomUUID(),
      runId: 'platform',
      agentId: 'human',
      channelId,
    });
  }
  /** An agent started or finished typing into a terminal; dashboards show it on that terminal. */
  terminalActivity(
    agentId: string,
    detail: { computerId: string; session: string; active: boolean; name: string; avatar: unknown },
  ) {
    this.broadcast({
      type: 'terminal_activity',
      ...detail,
      eventId: crypto.randomUUID(),
      runId: 'platform',
      agentId,
      channelId: `computer:${detail.computerId}`,
    });
  }
  /** An agent writing to its scratchpad (the chat status line shows it, like typing). */
  scratchActivity(agentId: string, detail: { path: string; active: boolean }) {
    this.broadcast({
      type: 'scratch_activity',
      ...detail,
      eventId: crypto.randomUUID(),
      runId: 'platform',
      agentId,
      channelId: `scratch:${agentId}`,
    });
  }
  /** Standalone advisory branches are observable without pretending they are main chat runs. */
  activity(agentId: string, entry: ActivityEntry) {
    this.broadcast({
      type: 'activity',
      agentId,
      channelId: entry.channelId,
      runId: entry.runId,
      eventId: `activity:${entry.id}:${entry.revision}`,
      append: false,
      entry,
    });
  }
  private broadcast(event: RunEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        this.listeners.delete(listener);
      }
    }
  }
  enqueue(
    identity: RunIdentity,
    work: (context: RunContext) => Promise<void>,
    options: { queueTimeoutMs?: number; executionTimeoutMs?: number } = {},
  ) {
    if (this.closing) throw new Error('Agent is unavailable');
    const run: Run = {
      ...identity,
      humanOwned: identity.inputSource !== 'agent',
      runId: crypto.randomUUID(),
      typing: false,
      queued: true,
      controller: new AbortController(),
      finished: Promise.resolve(),
      inbox: new MessageInbox(),
      emit: () => {},
    };
    let sequence = 0;
    run.emit = data => {
      const event = {
        ...data,
        agentId: run.agentId,
        channelId: run.channelId,
        runId: run.runId,
        eventId: `${run.runId}:${++sequence}`,
      } as RunEvent;
      if (event.type === 'typing') {
        run.typing = event.active === true;
        run.typingTargets = Array.isArray(event.targets)
          ? event.targets.filter((value): value is string => typeof value === 'string')
          : undefined;
      }
      this.broadcast(event);
    };
    this.runs.set(run.runId, run);
    let detach = () => {};
    let admission: Promise<void> = Promise.resolve();
    try {
      run.ticket = this.queue.submit(
        run.agentId,
        run.runId,
        async signal => {
          if (this.lifecycle) await admission;
          signal.throwIfAborted();
          run.queued = false;
          run.emit({ type: 'run_started', clientMessageId: run.clientMessageId });
          await work({ runId: run.runId, signal, emit: run.emit, inbox: run.inbox });
        },
        { ...options, executionTimeoutMs: options.executionTimeoutMs ?? this.timeoutMs },
      );
      admission = this.lifecycle?.(run, 'queued', run.emit) ?? Promise.resolve();
      void admission.catch(() => {}); // observed again by work/finalization, including queued cancellation
      run.emit({ type: 'run_queued', clientMessageId: run.clientMessageId, queued: true });
      const abortTicket = () => run.ticket!.cancel();
      const abortRun = () => run.controller.abort();
      run.controller.signal.addEventListener('abort', abortTicket);
      run.ticket.signal.addEventListener('abort', abortRun);
      detach = () => {
        run.controller.signal.removeEventListener('abort', abortTicket);
        run.ticket!.signal.removeEventListener('abort', abortRun);
      };
      run.finished = run.ticket.finished
        .then(async state => {
          await admission;
          await this.lifecycle?.(run, state as 'completed' | 'failed' | 'cancelled', run.emit);
          if (state === 'failed') run.emit({ type: 'error', message: 'The agent run failed.' });
          else if (state === 'cancelled')
            run.emit({ type: 'error', message: 'The agent was stopped or its deadline elapsed.' });
        })
        .catch(() => {
          run.emit({ type: 'error', message: 'The agent lifecycle could not be saved. Check backend storage.' });
        })
        .finally(() => {
          detach();
          run.inbox.close();
          this.runs.delete(run.runId);
          run.emit({ type: 'done', stopped: run.controller.signal.aborted });
        });
      return run;
    } catch (error) {
      this.runs.delete(run.runId);
      run.inbox.close();
      throw error;
    }
  }
  async stop(agentId: string, clientMessageId: string) {
    const run = [...this.runs.values()].find(
      item => item.agentId === agentId && item.clientMessageId === clientMessageId,
    );
    if (!run) return false;
    // Peer Stop must not invalidate a concurrent private-human admission.
    if (run.humanOwned && !run.channelId.startsWith('dm:')) this.stops.set(agentId, this.stopVersion(agentId) + 1);
    run.controller.abort();
    await run.finished;
    return true;
  }
  async shutdown() {
    this.closing = true;
    const runs = [...this.runs.values()];
    await this.queue.shutdown();
    await Promise.all(runs.map(run => run.finished));
  }
}
