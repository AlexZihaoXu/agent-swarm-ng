import type { ThinkingLevel } from './generated/prisma/enums';
import { LIMIT_RANGES } from './endpoint-store';

/**
 * Fallback models (docs/agent-models.md): an agent's ranked model choices. #1 is the agent's own endpoint, model and
 * thinking level; the rest and every choice's options are kept in `Agent.modelChain` (JSON).
 */
export type ChoiceOptions = {
  /** Tries before moving on to the next choice (errors that cannot succeed move on at once). */
  attempts: number;
  /** When the conversation is bigger than this model's context: skip it, or compact first and use it. */
  tooBig: 'skip' | 'compact';
  /** Minutes after it failed before the next call tries it again (once); 0: only when the owner switches back. */
  comeBack: number;
  /** The owner's cap on this model's context window (tokens); unset: the model's (or its endpoint's) own. */
  contextWindow?: number;
  /** The owner's cap on one reply (tokens, thinking included); unset: the model's own, or a quarter of the window. */
  maxOutputTokens?: number;
};
export type ModelChoice = { endpointId: string; model: string; thinkingLevel: ThinkingLevel } & ChoiceOptions;

export const MAX_CHOICES = 5;
export const ATTEMPTS = { min: 1, max: 5 };
export const COME_BACK = { min: 0, max: 60 };
export const DEFAULT_OPTIONS: ChoiceOptions = { attempts: 3, tooBig: 'skip', comeBack: 5 };
/** Backoff between tries of one choice: 2, 4, 8 … seconds (tests shorten it). */
export const RETRY_BASE = { ms: 2000 };

const clamp = (value: unknown, { min, max }: { min: number; max: number }, fallback: number) =>
  typeof value === 'number' && Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** A saved token cap, kept only when it is a whole number in the endpoint limits' range. */
const cap = (value: unknown, range: { minimum: number; maximum: number }) =>
  typeof value === 'number' && Number.isInteger(value) && value >= range.minimum && value <= range.maximum
    ? value
    : undefined;

function optionsOf(raw: unknown): ChoiceOptions {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<ChoiceOptions>;
  const contextWindow = cap(value.contextWindow, LIMIT_RANGES.contextWindow);
  const maxOutputTokens = cap(value.maxOutputTokens, LIMIT_RANGES.maxOutputTokens);
  return {
    attempts: clamp(value.attempts, ATTEMPTS, DEFAULT_OPTIONS.attempts),
    tooBig: value.tooBig === 'compact' ? 'compact' : 'skip',
    comeBack: clamp(value.comeBack, COME_BACK, DEFAULT_OPTIONS.comeBack),
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
  };
}

/** A choice's token caps, for its model's configuration (chat-runtime resolveChatModel). */
export const capsOf = ({ contextWindow, maxOutputTokens }: Partial<ChoiceOptions>) => ({
  ...(contextWindow ? { contextWindow } : {}),
  ...(maxOutputTokens ? { maxOutputTokens } : {}),
});

type Stored = { primary?: Partial<ChoiceOptions>; fallbacks?: Partial<ModelChoice>[] };

/** The agent's choices in rank order: #1 first. A fallback with a missing field is dropped, never guessed. */
export function choicesOf(agent: {
  endpointId: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  modelChain?: string | null;
}): ModelChoice[] {
  let stored: Stored = {};
  try {
    stored = JSON.parse(agent.modelChain || '{}') as Stored;
  } catch {}
  const fallbacks = (Array.isArray(stored.fallbacks) ? stored.fallbacks : [])
    .filter(
      (item): item is ModelChoice =>
        Boolean(item) &&
        typeof item.endpointId === 'string' &&
        Boolean(item.endpointId) &&
        typeof item.model === 'string' &&
        Boolean(item.model) &&
        typeof item.thinkingLevel === 'string',
    )
    .map(item => ({
      endpointId: item.endpointId,
      model: item.model,
      thinkingLevel: item.thinkingLevel,
      ...optionsOf(item),
    }));
  return [
    {
      endpointId: agent.endpointId,
      model: agent.model,
      thinkingLevel: agent.thinkingLevel,
      ...optionsOf(stored.primary),
    },
    ...fallbacks,
  ].slice(0, MAX_CHOICES);
}

/** The agent columns that store `choices` (#1 in its own columns, the rest in modelChain). */
export function chainColumns(choices: ModelChoice[]) {
  const [first, ...rest] = choices;
  if (!first) throw new Error('An agent needs at least one model.');
  const options = ({ attempts, tooBig, comeBack, ...caps }: ChoiceOptions) => ({
    attempts,
    tooBig,
    comeBack,
    ...capsOf(caps),
  });
  return {
    endpointId: first.endpointId,
    model: first.model,
    thinkingLevel: first.thinkingLevel,
    modelChain: JSON.stringify({
      primary: options(first),
      fallbacks: rest.map(choice => ({
        endpointId: choice.endpointId,
        model: choice.model,
        thinkingLevel: choice.thinkingLevel,
        ...options(choice),
      })),
    }),
  };
}

/** Choices are the same list (same models in the same order), whatever their options. */
const signature = (choices: ModelChoice[]) =>
  choices.map(choice => `${choice.endpointId}\0${choice.model}\0${choice.thinkingLevel}`).join('\n');

/** The agent's active choice moved: down after failures (`error`: the last one), or back up. */
export type ChainChange = { active: number; from: number; error?: string; reason?: string };

type State = { signature: string; active: number; failedAt: Map<number, number> };

/** What a run did, for its activity, the run events and push (the run records them). */
export type ChainEvent =
  | { type: 'retry'; index: number; attempt: number; attempts: number; delayMs: number; error: string }
  | { type: 'switch'; from: number; to: number; error: string; reason?: string; compact: boolean }
  | { type: 'skip'; index: number; reason: string }
  | { type: 'probe'; index: number; from: number }
  | { type: 'recovered'; index: number; from: number }
  | { type: 'exhausted'; index: number; error: string; reason?: string };

export type FailureDecision =
  { action: 'retry'; delayMs: number } | { action: 'switch'; index: number; compact: boolean } | { action: 'fail' };

/**
 * One run's walk down the chain. `usable(i)` says whether choice i could even be reached (its connection resolved);
 * `fits(i)` whether the conversation fits its context. Starts on the agent's active choice, or tries a higher one
 * once when its come-back time has passed (the lazy return).
 */
export class ChainRun {
  index: number;
  private tries = 0;
  /** A single try of a higher choice after its come-back time: no second attempt. */
  private probe = false;
  private readonly startedOn: number;
  /** Why it last moved down the chain, for the owner's notification: a provider error, or the platform's own reason. */
  private lastFailure?: { error: string; reason?: string };

  constructor(
    private readonly chains: ModelChains,
    readonly agentId: string,
    readonly choices: ModelChoice[],
    private readonly state: State,
    private readonly usable: (index: number) => string | null,
    private readonly fits: (index: number) => boolean,
    private readonly emit: (event: ChainEvent) => void,
  ) {
    this.startedOn = state.active;
    this.index = state.active;
    const due = this.due();
    if (due !== undefined) this.enter(due, true);
  }

  get choice() {
    return this.choices[this.index]!;
  }

  /** A higher choice whose come-back time has passed, if any (the highest) that is reachable and fits. */
  due() {
    const now = this.chains.now();
    for (let index = 0; index < this.index; index++) {
      const failed = this.state.failedAt.get(index);
      const comeBack = this.choices[index]!.comeBack;
      if (failed !== undefined && (comeBack === 0 || now - failed < comeBack * 60_000)) continue;
      if (this.usable(index) || !this.fits(index)) continue;
      return index;
    }
    return undefined;
  }

  private enter(index: number, probe: boolean) {
    if (probe) this.emit({ type: 'probe', index, from: this.index });
    this.index = index;
    this.tries = 0;
    this.probe = probe;
  }

  /** Before a model call within the run: the session moved to a higher choice that came due (`due()`). */
  enterDue(index: number) {
    this.enter(index, true);
  }

  /**
   * The current choice cannot be used at all (its connection failed, or it could not be compacted into): move on at
   * once. `reason` is the platform's own text, safe to show.
   */
  unusable(reason: string) {
    return this.failure(false, reason, reason);
  }

  /** Whether a failed call would be tried again (on this choice or another): no state changes. */
  wouldContinue(retryable: boolean) {
    if (retryable && !this.probe && this.tries + 1 < this.choice.attempts) return true;
    return this.next(false) !== undefined;
  }

  /** The next choice to move to after the current one failed, if any (`report`: emit the skipped ones). */
  private next(report: boolean) {
    const now = this.chains.now();
    for (let index = this.index + 1; index < this.choices.length; index++) {
      // A choice above the one this run started on failed recently: not again until it is due.
      if (index < this.startedOn) {
        const failed = this.state.failedAt.get(index);
        const comeBack = this.choices[index]!.comeBack;
        if (failed !== undefined && (comeBack === 0 || now - failed < comeBack * 60_000)) continue;
      }
      const unreachable = this.usable(index);
      if (unreachable) {
        if (report) {
          this.emit({ type: 'skip', index, reason: unreachable });
          this.state.failedAt.set(index, now);
        }
        continue;
      }
      const fits = this.fits(index);
      if (!fits && this.choices[index]!.tooBig === 'skip') {
        if (report) this.emit({ type: 'skip', index, reason: 'The conversation is bigger than its context.' });
        continue;
      }
      return { index, compact: !fits };
    }
    return undefined;
  }

  /**
   * A model call failed. `retryable`: a transient error worth another try of the same choice. `reason`: the platform's
   * own explanation, shown instead of a category of `error` (a provider's text, never shown).
   */
  failure(retryable: boolean, error: string, reason?: string): FailureDecision {
    this.tries++;
    if (retryable && !this.probe && this.tries < this.choice.attempts) {
      const delayMs = RETRY_BASE.ms * 2 ** (this.tries - 1);
      this.emit({
        type: 'retry',
        index: this.index,
        attempt: this.tries,
        attempts: this.choice.attempts,
        delayMs,
        error,
      });
      return { action: 'retry', delayMs };
    }
    this.state.failedAt.set(this.index, this.chains.now());
    const from = this.index;
    const next = this.next(true);
    if (!next) {
      this.emit({ type: 'exhausted', index: from, error, ...(reason ? { reason } : {}) });
      return { action: 'fail' };
    }
    this.lastFailure = { error, ...(reason ? { reason } : {}) };
    this.emit({ type: 'switch', from, to: next.index, error, ...(reason ? { reason } : {}), compact: next.compact });
    this.enter(next.index, false);
    return { action: 'switch', ...next };
  }

  /** A model call succeeded on the current choice: it becomes the agent's active one. */
  success() {
    this.tries = 0;
    this.probe = false;
    this.state.failedAt.delete(this.index);
    if (this.state.active === this.index) return;
    const from = this.state.active;
    this.state.active = this.index;
    if (this.index < from) this.emit({ type: 'recovered', index: this.index, from });
    this.chains.changed(this.agentId, {
      active: this.index,
      from,
      ...(this.index > from ? this.lastFailure : {}),
    });
  }
}

/** Each agent's place in its chain, in memory: a restart starts every agent on #1 again. */
export class ModelChains {
  private readonly states = new Map<string, State>();
  private readonly listeners = new Set<(agentId: string, change: ChainChange) => void>();

  constructor(readonly now: () => number = () => Date.now()) {}

  private state(agentId: string, choices: ModelChoice[]) {
    const key = signature(choices);
    let state = this.states.get(agentId);
    // A changed list starts again from #1.
    if (!state || state.signature !== key)
      this.states.set(agentId, (state = { signature: key, active: 0, failedAt: new Map() }));
    return state;
  }

  /** The choice the agent is on now (forks and side calls use it). */
  active(agentId: string, choices: ModelChoice[]) {
    return Math.min(this.state(agentId, choices).active, choices.length - 1);
  }

  run(
    agentId: string,
    choices: ModelChoice[],
    usable: (index: number) => string | null,
    fits: (index: number) => boolean,
    emit: (event: ChainEvent) => void,
  ) {
    return new ChainRun(this, agentId, choices, this.state(agentId, choices), usable, fits, emit);
  }

  /** The owner's "Use #1 again". */
  reset(agentId: string) {
    const state = this.states.get(agentId);
    this.states.delete(agentId);
    if (state && state.active !== 0) this.changed(agentId, { active: 0, from: state.active });
  }

  forget(agentId: string) {
    this.states.delete(agentId);
  }

  changed(agentId: string, change: ChainChange) {
    for (const listener of this.listeners) listener(agentId, change);
  }

  /** Active choice changes (the dashboard's "on #2" badge, the owner's notification). */
  subscribe(listener: (agentId: string, change: ChainChange) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/**
 * When an agent changes owner, the old owner's endpoints are not its own (docs/users.md#model-connections): only
 * fallbacks on the ChatGPT login (each person's own) are kept, like #1's endpoint is cleared.
 */
export function ownChainOnly(modelChain: string, codexConnection: string) {
  let stored: Stored = {};
  try {
    stored = JSON.parse(modelChain || '{}') as Stored;
  } catch {}
  return JSON.stringify({
    ...stored,
    fallbacks: (Array.isArray(stored.fallbacks) ? stored.fallbacks : []).filter(
      item => item?.endpointId === codexConnection,
    ),
  });
}
