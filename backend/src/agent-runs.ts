export type RunIdentity = { agentId: string; channelId: string; clientMessageId: string };
export type RunState = RunIdentity & { runId: string; typing: boolean };
export type RunEvent = Record<string, unknown> & { type: string; eventId: string; runId: string; agentId: string; channelId: string };
export type RunContext = { runId: string; signal: AbortSignal; emit: (event: object) => void };
type Run = RunState & { controller: AbortController; finished: Promise<void> };

/** One backend process owns work; stream listeners are disposable observers. */
export class AgentRuns {
  private active = new Map<string, Run>();
  private listeners = new Set<(event: RunEvent) => void>();
  private closing = false;
  constructor(private timeoutMs = Number(process.env.AGENT_RUN_TIMEOUT_MS ?? 0)) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647) throw new Error('Invalid AGENT_RUN_TIMEOUT_MS');
  }
  has(agentId: string) { return this.active.has(agentId); }
  snapshot(): RunState[] {
    return [...this.active.values()].map(({ agentId, channelId, clientMessageId, runId, typing }) => ({ agentId, channelId, clientMessageId, runId, typing }));
  }
  subscribe(listener: (event: RunEvent) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  start(identity: RunIdentity, work: (context: RunContext) => Promise<void>) {
    if (this.closing || this.has(identity.agentId)) throw new Error('Agent is unavailable');
    const run: Run = { ...identity, runId: crypto.randomUUID(), typing: false, controller: new AbortController(), finished: Promise.resolve() };
    this.active.set(identity.agentId, run);
    let sequence = 0;
    const emit = (data: object) => {
      const event = { ...data, agentId: run.agentId, channelId: run.channelId, runId: run.runId, eventId: `${run.runId}:${++sequence}` } as RunEvent;
      if (event.type === 'typing') run.typing = event.active === true;
      for (const listener of this.listeners) {
        try { listener(event); } catch { this.listeners.delete(listener); }
      }
    };
    const timer = this.timeoutMs ? setTimeout(() => run.controller.abort(), this.timeoutMs) : undefined;
    run.finished = Promise.resolve().then(async () => {
      emit({ type: 'run_started', clientMessageId: run.clientMessageId });
      await work({ runId: run.runId, signal: run.controller.signal, emit });
    }).catch(() => {
      emit({ type: 'error', message: run.controller.signal.aborted ? 'The agent was stopped.' : 'The agent run failed.' });
    }).finally(() => {
      clearTimeout(timer);
      this.active.delete(run.agentId);
      emit({ type: 'done', stopped: run.controller.signal.aborted });
    });
    return run;
  }
  async stop(agentId: string, clientMessageId: string) {
    const run = this.active.get(agentId);
    if (!run || run.clientMessageId !== clientMessageId) return false;
    run.controller.abort();
    await run.finished;
    return true;
  }
  async shutdown() {
    this.closing = true;
    const runs = [...this.active.values()];
    for (const run of runs) run.controller.abort();
    await Promise.all(runs.map(run => run.finished));
  }
}
