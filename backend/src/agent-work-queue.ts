export type WorkState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type WorkTicket = {
  readonly agentId: string;
  readonly key: string;
  readonly state: WorkState;
  readonly signal: AbortSignal;
  readonly finished: Promise<WorkState>;
  cancel: () => void;
};
type Job = WorkTicket & {
  state: WorkState;
  controller: AbortController;
  work: (signal: AbortSignal) => Promise<void>;
  resolve: (state: WorkState) => void;
  executionTimeoutMs: number;
  queueTimer?: ReturnType<typeof setTimeout>;
};

/** One execution slot per agent, independent of which conversation owns the work. */
export class AgentWorkQueue {
  private jobs = new Map<string, Job>();
  private waiting = new Map<string, Job[]>();
  private running = new Set<string>();
  private closing = false;
  constructor(
    private perAgentLimit = 16,
    private totalLimit = 128,
  ) {
    if (![perAgentLimit, totalLimit].every(value => Number.isSafeInteger(value) && value > 0))
      throw new Error('Invalid queue limits');
  }
  get size() {
    return this.jobs.size;
  }
  private id(agentId: string, key: string) {
    return JSON.stringify([agentId, key]);
  }
  submit(
    agentId: string,
    key: string,
    work: (signal: AbortSignal) => Promise<void>,
    options: { queueTimeoutMs?: number; executionTimeoutMs?: number } = {},
  ): WorkTicket {
    if (this.closing) throw new Error('The queue is shutting down');
    if (this.jobs.has(this.id(agentId, key))) throw new Error('Work is already queued');
    const owned = [...this.jobs.values()].filter(job => job.agentId === agentId).length;
    if (owned >= this.perAgentLimit || this.size >= this.totalLimit) throw new Error('The work queue is full');
    const queueTimeoutMs = options.queueTimeoutMs ?? 0,
      executionTimeoutMs = options.executionTimeoutMs ?? 0;
    if (
      ![queueTimeoutMs, executionTimeoutMs].every(
        value => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647,
      )
    )
      throw new Error('Invalid work deadline');
    const controller = new AbortController();
    let resolve!: (state: WorkState) => void;
    const finished = new Promise<WorkState>(done => {
      resolve = done;
    });
    const job: Job = {
      agentId,
      key,
      work,
      controller,
      signal: controller.signal,
      state: 'queued',
      finished,
      resolve,
      executionTimeoutMs,
      cancel: () => {
        if (job.state !== 'queued' && job.state !== 'running') return;
        controller.abort();
        if (job.state === 'queued') {
          const remaining = (this.waiting.get(agentId) ?? []).filter(item => item !== job);
          if (remaining.length) this.waiting.set(agentId, remaining);
          else this.waiting.delete(agentId);
          this.finish(job, 'cancelled');
        }
      },
    };
    this.jobs.set(this.id(agentId, key), job);
    this.waiting.set(agentId, [...(this.waiting.get(agentId) ?? []), job]);
    if (queueTimeoutMs) job.queueTimer = setTimeout(job.cancel, queueTimeoutMs);
    this.pump(agentId);
    return job;
  }
  private finish(job: Job, state: WorkState) {
    clearTimeout(job.queueTimer);
    job.state = state;
    this.jobs.delete(this.id(job.agentId, job.key));
    job.resolve(state);
  }
  private pump(agentId: string) {
    if (this.closing || this.running.has(agentId)) return;
    const queue = this.waiting.get(agentId),
      job = queue?.shift();
    if (!queue?.length) this.waiting.delete(agentId);
    if (!job) return;
    this.running.add(agentId);
    job.state = 'running';
    clearTimeout(job.queueTimer);
    const timer = job.executionTimeoutMs ? setTimeout(job.cancel, job.executionTimeoutMs) : undefined;
    void Promise.resolve()
      .then(async () => {
        job.signal.throwIfAborted();
        await job.work(job.signal);
        this.finish(job, job.signal.aborted ? 'cancelled' : 'completed');
      })
      .catch(() => {
        this.finish(job, job.signal.aborted ? 'cancelled' : 'failed');
      })
      .finally(() => {
        clearTimeout(timer);
        this.running.delete(agentId);
        this.pump(agentId);
      });
  }
  async cancelAgent(agentId: string) {
    const jobs = [...this.jobs.values()].filter(job => job.agentId === agentId);
    for (const job of jobs) job.cancel();
    await Promise.all(jobs.map(job => job.finished));
  }
  async shutdown() {
    this.closing = true;
    const jobs = [...this.jobs.values()];
    for (const job of jobs) job.cancel();
    await Promise.all(jobs.map(job => job.finished));
  }
}
