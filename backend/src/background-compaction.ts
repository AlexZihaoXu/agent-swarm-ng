import {
  buildSessionContext,
  compact,
  estimateTokens,
  findCutPoint,
  sessionEntryToContextMessages,
  type AgentSession,
  type CompactionResult,
  type SessionEntry,
  type SessionManager,
} from '@earendil-works/pi-coding-agent';

/** When an agent compacts its context in the background (per agent; see Agents → agent → Model). */
export type CompactionPolicy = {
  /** During work: start a background summary once the context reaches this share of the window. */
  atPercent: number;
  /** When idle this long (minutes; 0 = never)… */
  idleMinutes: number;
  /** …and the context is at least this full, summarize so the next turn starts light. */
  idlePercent: number;
};
export const DEFAULT_COMPACTION_POLICY: CompactionPolicy = { atPercent: 65, idleMinutes: 30, idlePercent: 50 };
export type CompactionState = 'running' | 'sleeping';
type Preparation = Parameters<typeof compact>[0];
type CompactionSettings = Preparation['settings'];
type Job = {
  /** The snapshot's newest entry: the summary covers the branch up to here. */
  baseLeafId: string;
  firstKeptEntryId: string;
  /** The newest compaction when the snapshot was taken; a newer one makes this summary stale. */
  previousCompactionId: string | null;
  controller: AbortController;
  settled: Promise<void>;
  result?: CompactionResult;
  failed?: boolean;
};

const latestCompactionId = (entries: SessionEntry[]) =>
  [...entries].reverse().find(entry => entry.type === 'compaction')?.id ?? null;

/**
 * The SDK's prepareCompaction (not exported in Pi 0.85.1), for a snapshot of the branch: what to summarize, and the
 * first entry kept verbatim (never a tool result; the SDK's own cut rule keeps a recent tail).
 */
export function prepareBackgroundCompaction(
  entries: SessionEntry[],
  settings: CompactionSettings,
): Preparation | undefined {
  if (!entries.length || entries.at(-1)!.type === 'compaction') return undefined;
  let previousIndex = -1;
  for (let index = entries.length - 1; index >= 0; index--)
    if (entries[index].type === 'compaction') {
      previousIndex = index;
      break;
    }
  let previousSummary: string | undefined;
  let start = 0;
  let details: { readFiles?: string[]; modifiedFiles?: string[] } | undefined;
  if (previousIndex >= 0) {
    const previous = entries[previousIndex] as Extract<SessionEntry, { type: 'compaction' }>;
    previousSummary = previous.summary;
    const kept = entries.findIndex(entry => entry.id === previous.firstKeptEntryId);
    start = kept >= 0 ? kept : previousIndex + 1;
    details = previous.details as typeof details;
  }
  const message = (entry: SessionEntry) =>
    entry.type === 'compaction' ? undefined : sessionEntryToContextMessages(entry)[0];
  const tokensBefore = buildSessionContext(entries).messages.reduce((total, item) => total + estimateTokens(item), 0);
  const cut = findCutPoint(entries, start, entries.length, settings.keepRecentTokens);
  const firstKept = entries[cut.firstKeptEntryIndex];
  if (!firstKept?.id) return undefined;
  const historyEnd = cut.isSplitTurn ? cut.turnStartIndex : cut.firstKeptEntryIndex;
  const messagesToSummarize = entries.slice(start, historyEnd).flatMap(entry => message(entry) ?? []);
  const turnPrefixMessages = cut.isSplitTurn
    ? entries.slice(cut.turnStartIndex, cut.firstKeptEntryIndex).flatMap(entry => message(entry) ?? [])
    : [];
  if (!messagesToSummarize.length && !turnPrefixMessages.length) return undefined;
  return {
    firstKeptEntryId: firstKept.id,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn: cut.isSplitTurn,
    tokensBefore,
    previousSummary,
    // Files read/changed carry over from the previous summary (our tools are not the SDK's file tools).
    fileOps: {
      read: new Set(details?.readFiles ?? []),
      written: new Set<string>(),
      edited: new Set(details?.modifiedFiles ?? []),
    },
    settings,
  };
}

/**
 * Background (non-blocking) context compaction, one summary in flight per agent. A snapshot of the branch is
 * summarized while the agent keeps working; the result is spliced into the agent's live session at a safe point
 * (between model calls, or before a run's first prompt) as a normal compaction entry that keeps everything after the
 * snapshot verbatim. A summary that no longer fits the session (another compaction happened, or the snapshot is
 * off-branch) is discarded. Results live in memory until spliced; a restart only loses the work.
 */
export class BackgroundCompactor {
  private jobs = new Map<string, Job>();
  private sleepers = new Map<string, number>();

  constructor(
    private events: {
      /** The agent's visible state: summarizing in the background, or waiting for it (sleeping). */
      state?: (agentId: string, state: CompactionState | null) => void;
    } = {},
  ) {}

  /** A summary is being written for this agent. */
  running(agentId: string) {
    const job = this.jobs.get(agentId);
    return Boolean(job && !job.result && !job.failed);
  }
  /** Settles when the agent's current summary is written (or fails). */
  settled(agentId: string) {
    return this.jobs.get(agentId)?.settled ?? Promise.resolve();
  }

  /**
   * Starts summarizing a snapshot of the session's branch. Uses the session's model, credentials, stream function,
   * thinking level and retry policy, so the session must stay alive until it settles. Returns whether it started.
   */
  start(agentId: string, session: AgentSession, onSettled?: (outcome: 'ready' | 'failed') => void) {
    if (this.jobs.has(agentId) || !session.model) return false;
    const settings = session.settingsManager.getCompactionSettings();
    if (!settings.enabled) return false;
    const entries = session.sessionManager.getBranch().slice();
    const preparation = prepareBackgroundCompaction(entries, settings);
    if (!preparation) return false;
    const model = session.model;
    const controller = new AbortController();
    const job: Job = {
      baseLeafId: entries.at(-1)!.id,
      firstKeptEntryId: preparation.firstKeptEntryId,
      previousCompactionId: latestCompactionId(entries),
      controller,
      settled: Promise.resolve(),
    };
    // The SDK's own summaries authenticate this way (a private method in Pi 0.85.1; pinned and tested).
    const auth = (
      session as unknown as {
        _getSummarizationRequestAuth(model: NonNullable<AgentSession['model']>): Promise<{
          model: NonNullable<AgentSession['model']>;
          apiKey?: string;
          headers?: Record<string, string>;
          env?: Record<string, string>;
        }>;
      }
    )._getSummarizationRequestAuth(model);
    const thinkingLevel = session.thinkingLevel;
    const streamFn = session.agent.streamFunction;
    const retry = session.settingsManager.getRetrySettings();
    job.settled = auth
      .then(request =>
        compact(
          preparation,
          request.model,
          request.apiKey,
          request.headers,
          undefined,
          controller.signal,
          thinkingLevel,
          streamFn,
          request.env,
          retry,
        ),
      )
      .then(
        result => {
          job.result = result;
          onSettled?.('ready');
        },
        () => {
          job.failed = true;
          if (this.jobs.get(agentId) === job) this.jobs.delete(agentId);
          onSettled?.('failed');
        },
      )
      .finally(() => this.publish(agentId));
    this.jobs.set(agentId, job);
    this.publish(agentId);
    return true;
  }

  /**
   * Applies a finished summary to this session (its branch must still contain the snapshot): appends the compaction
   * entry and rebuilds the agent's working messages. Returns 'spliced', 'stale' (discarded) or null (nothing ready).
   */
  splice(agentId: string, session: Pick<AgentSession, 'sessionManager' | 'agent'>): 'spliced' | 'stale' | null {
    const job = this.jobs.get(agentId);
    if (!job?.result) return null;
    this.jobs.delete(agentId);
    this.publish(agentId);
    const manager: SessionManager = session.sessionManager;
    const branch = manager.getBranch();
    const ids = new Set(branch.map(entry => entry.id));
    if (
      !ids.has(job.baseLeafId) ||
      !ids.has(job.firstKeptEntryId) ||
      latestCompactionId(branch) !== job.previousCompactionId
    )
      return 'stale';
    const { summary, firstKeptEntryId, tokensBefore, details, usage } = job.result;
    manager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, false, usage);
    session.agent.state.messages = manager.buildSessionContext().messages;
    return 'spliced';
  }

  /** The agent must wait for its summary (context nearly full): it sleeps until the summary is ready. */
  async sleep(agentId: string, signal: AbortSignal) {
    if (!this.running(agentId)) return;
    this.sleepers.set(agentId, (this.sleepers.get(agentId) ?? 0) + 1);
    this.publish(agentId);
    try {
      await Promise.race([
        this.settled(agentId),
        new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })),
      ]);
    } finally {
      const left = (this.sleepers.get(agentId) ?? 1) - 1;
      if (left) this.sleepers.set(agentId, left);
      else this.sleepers.delete(agentId);
      this.publish(agentId);
    }
  }

  /** Stops and forgets the agent's summary (the agent was deleted, or its model changed). */
  cancel(agentId: string) {
    const job = this.jobs.get(agentId);
    if (!job) return;
    job.controller.abort();
    this.jobs.delete(agentId);
    this.publish(agentId);
  }
  close() {
    for (const agentId of [...this.jobs.keys()]) this.cancel(agentId);
  }

  private published = new Map<string, CompactionState>();
  private publish(agentId: string) {
    const state = this.sleepers.has(agentId) ? 'sleeping' : this.running(agentId) ? 'running' : null;
    if ((this.published.get(agentId) ?? null) === state) return;
    if (state) this.published.set(agentId, state);
    else this.published.delete(agentId);
    this.events.state?.(agentId, state);
  }
  /** Agents summarizing or sleeping now (for a reconnecting dashboard). */
  states() {
    return Object.fromEntries(this.published);
  }
}
