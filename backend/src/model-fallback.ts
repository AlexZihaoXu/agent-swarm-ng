import { estimateTokens, type AgentSession, type ModelRuntime } from '@earendil-works/pi-coding-agent';
import { getSupportedThinkingLevels, type Api, type AssistantMessage, type Model } from '@earendil-works/pi-ai';
import { isContextOverflow, isRetryableAssistantError } from '@earendil-works/pi-ai/compat';
import type { ChainEvent, ChainRun, ModelChains, ModelChoice } from './model-chain';
import type { EndpointLimits } from './endpoint-store';
import { compactToFit } from './background-compaction';
import { providerFailure } from './activity-safety';

/** One choice's connection (users/connections.ts forChain), or why it cannot be reached. */
export type PreparedChoice = {
  choice: ModelChoice;
  connection?: { baseUrl: string; apiKey?: string; limits?: EndpointLimits; subscriptionRuntime?: ModelRuntime };
  unreachable?: string;
};
/** A main run's fallback chain (docs/agent-models.md). `run` is set once the session is created. */
export type SessionFallback = {
  chains: ModelChains;
  agentId: string;
  choices: PreparedChoice[];
  emit: (event: ChainEvent) => void;
  run?: ChainRun;
};
type Tagged = Model<Api> & { swarmChoice?: number };
type Resolved = { model: Tagged; runtime: ModelRuntime } | { error: string };
type Resolve = (
  choice: PreparedChoice & { connection: NonNullable<PreparedChoice['connection']> },
) => Promise<{ model: Model<Api>; modelRuntime: ModelRuntime }>;

/** Reserved reply room (the session's compaction reserve): a conversation fits when it leaves this much free. */
export const reserveFor = (contextWindow: number) => Math.min(16384, Math.max(1024, Math.floor(contextWindow / 4)));

/**
 * One Pi session, several connections: the session holds one runtime, so this one passes every call to the runtime of
 * the choice that made the model (each model carries its choice number; Pi copies models with a spread, which keeps
 * it). Provider-level questions go to the first runtime with that provider.
 */
function chainRuntime(resolved: Resolved[], current: () => number): ModelRuntime {
  const entries = resolved.flatMap(entry => ('model' in entry ? [entry] : []));
  const of = (model?: Tagged) => {
    const entry = resolved[model?.swarmChoice ?? current()] ?? resolved[current()];
    return entry && 'runtime' in entry ? entry.runtime : entries[0]!.runtime;
  };
  const byProvider = (provider: string) =>
    (resolved[current()] as { model?: Tagged; runtime?: ModelRuntime })?.model?.provider === provider
      ? of()
      : (entries.find(entry => entry.model.provider === provider)?.runtime ?? of());
  return new Proxy({} as ModelRuntime, {
    get(_, key) {
      switch (key) {
        case 'getAuth':
          return (target: string | Tagged, options?: object) =>
            typeof target === 'string'
              ? byProvider(target).getAuth(target, options)
              : of(target).getAuth(target, options);
        case 'streamSimple':
          return (model: Tagged, context: never, options?: never) => of(model).streamSimple(model, context, options);
        case 'checkAuth':
        case 'isUsingOAuth':
        case 'hasConfiguredAuth':
          return (provider: string, ...rest: unknown[]) =>
            (byProvider(provider)[key] as (...args: unknown[]) => unknown)(provider, ...rest);
        case 'getModel':
          return (provider: string, id: string) =>
            entries.find(entry => entry.model.provider === provider && entry.model.id === id)?.model ??
            byProvider(provider).getModel(provider, id);
        case 'getAvailableSnapshot':
          return () => entries.map(entry => entry.model);
        default: {
          const runtime = of();
          const value = (runtime as unknown as Record<PropertyKey, unknown>)[key];
          return typeof value === 'function' ? value.bind(runtime) : value;
        }
      }
    },
  });
}

/**
 * Resolves every reachable choice's model and starts this run's walk: on the agent's active choice, a higher one due
 * for its come-back try, or the next reachable one. Throws when none can be reached.
 */
export async function prepareFallback(
  fallback: SessionFallback,
  resolve: Resolve,
  /** The conversation's size before the session exists (its saved context; the prompt and tools are estimated). */
  before: () => number,
) {
  const resolved: Resolved[] = await Promise.all(
    fallback.choices.map(async (prepared, index): Promise<Resolved> => {
      if (!prepared.connection) return { error: prepared.unreachable ?? 'Its connection could not be reached.' };
      try {
        const { model, modelRuntime } = await resolve({ ...prepared, connection: prepared.connection });
        const levels = model.reasoning ? getSupportedThinkingLevels(model) : ['off'];
        if (!levels.includes(prepared.choice.thinkingLevel))
          return { error: 'Its thinking level is not supported by this model.' };
        return { model: { ...model, swarmChoice: index }, runtime: modelRuntime };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Its model could not be loaded.' };
      }
    }),
  );
  let session: AgentSession | undefined;
  const switching: { index?: number } = {};
  const fits = (index: number) => {
    const entry = resolved[index];
    if (!entry || !('model' in entry)) return true;
    // Before any response reported its usage, the conversation is estimated (system prompt included).
    const tokens = !session
      ? before()
      : (session.getContextUsage()?.tokens ??
        session.agent.state.messages.reduce(
          (total, message) => total + estimateTokens(message),
          estimateTokens({ role: 'user', content: session.agent.state.systemPrompt, timestamp: 0 }),
        ));
    return tokens <= entry.model.contextWindow - reserveFor(entry.model.contextWindow);
  };
  const run = fallback.chains.run(
    fallback.agentId,
    fallback.choices.map(prepared => prepared.choice),
    index => {
      const entry = resolved[index];
      return entry && 'error' in entry ? entry.error : null;
    },
    fits,
    fallback.emit,
  );
  const start = resolved[run.index];
  if (start && 'error' in start && run.unusable(start.error).action === 'fail') throw new Error(start.error);
  fallback.run = run;
  const entry = resolved[run.index] as Extract<Resolved, { model: Tagged }>;
  return {
    model: entry.model as Model<Api>,
    thinkingLevel: fallback.choices[run.index]!.choice.thinkingLevel,
    // A switch in progress already answers for its target (setModel checks the target's login).
    modelRuntime: chainRuntime(resolved, () => switching.index ?? run.index),
    /** Called once the session exists: lets the chain switch its model and take over Pi's retry. */
    install: (created: AgentSession) => {
      session = created;
      installFallback(created, run, resolved, fallback.agentId, switching);
    },
  };
}

type RetryInternals = {
  _isRetryableError(message: AssistantMessage): boolean;
  _prepareRetry(message: AssistantMessage): Promise<boolean>;
  _willRetryAfterAgentEnd(event: { messages: { role: string }[] }): boolean;
  _retryAbortController?: AbortController;
};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });

/**
 * The chain takes over Pi's retry (pinned Pi 0.85.1 private methods, like afterToolCall elsewhere): a failed model call
 * is tried again on the same choice, or the session moves to the next choice and continues, or the run fails. A
 * context overflow stays Pi's (it compacts). Before each model call within a run, a higher choice that is due gets
 * its one try. Every successful response makes its choice the agent's active one.
 */
function installFallback(
  session: AgentSession,
  run: ChainRun,
  resolved: Resolved[],
  agentId: string,
  switching: { index?: number },
) {
  const internals = session as unknown as RetryInternals;
  const handled = (message: AssistantMessage) =>
    message.stopReason === 'error' && !isContextOverflow(message, session.model?.contextWindow ?? 0);
  internals._isRetryableError = handled;
  // Only says whether the run goes on (the activity's "will retry"); the decision itself is made once, below.
  internals._willRetryAfterAgentEnd = event => {
    const last = [...event.messages].reverse().find(message => message.role === 'assistant') as
      AssistantMessage | undefined;
    return Boolean(last && handled(last) && run.wouldContinue(isRetryableAssistantError(last)));
  };
  const switchTo = async (index: number) => {
    const entry = resolved[index] as Extract<Resolved, { model: Tagged }>;
    switching.index = index;
    try {
      await session.setModel(entry.model);
    } finally {
      switching.index = undefined;
    }
    session.setThinkingLevel(run.choices[index]!.thinkingLevel);
    const window = entry.model.contextWindow;
    session.settingsManager.applyOverrides({
      compaction: {
        enabled: session.settingsManager.getCompactionEnabled(),
        reserveTokens: reserveFor(window),
        keepRecentTokens: Math.min(20000, Math.max(512, Math.floor(window / 4))),
      },
    });
    return entry.model;
  };
  internals._prepareRetry = async message => {
    let decision = run.failure(isRetryableAssistantError(message), message.errorMessage || 'Unknown error');
    if (decision.action === 'fail') return false;
    // The failed response leaves the working context (it stays in the session's history).
    const messages = session.agent.state.messages;
    if (messages.at(-1)?.role === 'assistant') session.agent.state.messages = messages.slice(0, -1);
    const controller = new AbortController();
    internals._retryAbortController = controller;
    try {
      while (decision.action === 'switch') {
        await switchTo(decision.index);
        if (!decision.compact) break;
        const endpointId = run.choice.endpointId;
        const compacted = await compactToFit(session, agentId, controller.signal, endpointId).catch(error => {
          if (controller.signal.aborted) throw error;
          return false;
        });
        if (compacted) break;
        // It could not be made to fit: on to the next model, like one that cannot be reached.
        decision = run.unusable('The conversation could not be compacted to fit its context.');
      }
      if (decision.action === 'retry') await sleep(decision.delayMs, controller.signal);
      return decision.action !== 'fail' && !controller.signal.aborted;
    } catch {
      return false;
    } finally {
      internals._retryAbortController = undefined;
    }
  };
  /** A higher model whose come-back time passed gets its one try (between model calls, never mid-stream). */
  const comeBack = async () => {
    const due = run.due();
    if (due === undefined) return undefined;
    try {
      const model = await switchTo(due);
      run.enterDue(due);
      return model;
    } catch {
      return undefined; // Its login went away meanwhile: stay on the current model.
    }
  };
  const next = session.agent.prepareNextTurnWithContext;
  session.agent.prepareNextTurnWithContext = async (turn, signal) => {
    const prepared = await next?.(turn, signal);
    const model = await comeBack();
    if (!model) return prepared;
    return { ...prepared, context: prepared?.context ?? turn.context, model, thinkingLevel: session.thinkingLevel };
  };
  // Each new input of the run (the inbox's next batch) starts a new agent loop: its first call gets the same chance.
  const prompt = session.prompt.bind(session);
  session.prompt = async (text, options) => {
    if (!session.isStreaming) await comeBack();
    return prompt(text, options);
  };
  session.subscribe(event => {
    if (event.type !== 'message_end' || event.message.role !== 'assistant') return;
    const { stopReason } = event.message as AssistantMessage;
    if (stopReason !== 'error' && stopReason !== 'aborted') run.success();
  });
}

/** Why a model call failed, safe to show: a category and HTTP status, never the provider's text (activity-safety). */
export function failureReason(error: string) {
  const failure = providerFailure(error);
  return `${failure.category}${failure.httpStatus ? `, HTTP ${failure.httpStatus}` : ''}`;
}

/** What a chain event says in the run's activity: a provider's own error text is never repeated (activity-safety). */
export function describeFallback(event: ChainEvent, choices: PreparedChoice[]) {
  const name = (index: number) => `#${index + 1} (${choices[index]?.choice.model ?? 'unknown'})`;
  const why = failureReason;
  switch (event.type) {
    case 'retry':
      return {
        kind: 'status' as const,
        label: 'Model retry',
        text: `${name(event.index)} failed (${why(event.error)}). Trying it again in ${event.delayMs / 1000} s (try ${event.attempt + 1} of ${event.attempts}).`,
      };
    case 'switch':
      return {
        kind: 'status' as const,
        label: 'Model fallback',
        text: `${name(event.from)} ${event.reason ? `cannot be used: ${event.reason}` : `failed (${why(event.error)}).`} Now using ${name(event.to)}${event.compact ? ', compacting first to fit its context' : ''}.`,
      };
    case 'skip':
      return { kind: 'status' as const, label: 'Model skipped', text: `${name(event.index)}: ${event.reason}` };
    case 'probe':
      return {
        kind: 'status' as const,
        label: 'Model come-back try',
        text: `Trying ${name(event.index)} once again (on ${name(event.from)} since it failed).`,
      };
    case 'recovered':
      return { kind: 'status' as const, label: 'Model recovered', text: `Back on ${name(event.index)}.` };
    case 'exhausted':
      return {
        kind: 'error' as const,
        label: 'No model left',
        text: `${name(event.index)} ${event.reason ? `cannot be used: ${event.reason}` : `failed (${why(event.error)}).`} No other model could be tried.`,
      };
  }
}
