import {
  createAgentSession,
  defineTool,
  SessionManager,
  SettingsManager,
  type ModelRuntime,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { getSupportedThinkingLevels, Type } from '@earendil-works/pi-ai';
import { chatResources, createChatSession, type ChatConfiguration, type ChannelMessage } from './chat-runtime';
import { runTriageTurns, TRIAGE_MAX_TOKENS, TRIAGE_TIMEOUT_MS } from './triage-turns';
import type { ActivityTrace } from './activity-events';
import { accessOf, type AgentTool } from './tool-access';
import { meterSession } from './usage/meter';
import type { UsagePurpose } from './usage/recorder';

export type DecisionFork<A extends string> = {
  /** The one tool the fork may call, e.g. reaction_decision. */
  tool: string;
  description: string;
  actions: readonly [A, ...A[]];
  label: string;
  system: (name: string) => string;
  /** The item to classify, shown to the fork as the next user turn. */
  prompt: string;
  /** What any failure (timeout, provider error, no valid decision) means. */
  fallback: A;
  /** Read-only tools the branch may use before deciding (looking deeper); never anything with side effects. */
  tools?: AgentTool[];
  /** What its model usage counts as (default triage). */
  purpose?: UsagePurpose;
};

/**
 * An ephemeral, decision-only model branch (reaction and admission triage): the agent's recent channel context,
 * one decision tool (plus any read-only tools it is lent to look deeper), no publication or side effects, at most 10 corrective turns and a 120 s deadline. Every failure
 * returns the fallback.
 */
export async function runDecisionFork<A extends string>(
  fork: DecisionFork<A>,
  config: ChatConfiguration,
  history: ChannelMessage[],
  signal: AbortSignal,
  subscriptionRuntime?: ModelRuntime,
  trace?: ActivityTrace,
): Promise<{ action: A; reason: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRIAGE_TIMEOUT_MS);
  const combined = AbortSignal.any([signal, controller.signal]);
  let base: Awaited<ReturnType<typeof createChatSession>> | undefined;
  let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined;
  let decision: { action: A; reason: string } | undefined;
  let detach = () => {};
  let phase = 'creating fork';
  const abort = () => {
    void session?.abort();
  };
  try {
    combined.throwIfAborted();
    base = await createChatSession(
      config,
      history,
      async () => {
        throw new Error(`${fork.label} cannot publish.`);
      },
      [],
      subscriptionRuntime,
    );
    const tool = defineTool({
      name: fork.tool,
      label: fork.label,
      description: fork.description,
      parameters: Type.Object(
        {
          action: Type.Union(fork.actions.map(action => Type.Literal(action))),
          reason: Type.String({ minLength: 1, maxLength: 300 }),
        },
        { additionalProperties: false },
      ),
      async execute(_id, value) {
        if (!value.reason.trim()) throw new Error(`Invalid ${fork.tool}: provide a nonblank brief reason.`);
        if (!decision && !combined.aborted) decision = value as { action: A; reason: string };
        return { content: [{ type: 'text' as const, text: 'Decision recorded.' }], details: {}, terminate: true };
      },
    });
    const resources = chatResources(fork.label, config.channel.id, false, false);
    resources.getSystemPrompt = () => fork.system(config.name);
    const model = base.model!;
    const levels = model.reasoning ? getSupportedThinkingLevels(model) : ['off'];
    ({ session } = await createAgentSession({
      model: { ...model, maxTokens: Math.min(model.maxTokens, TRIAGE_MAX_TOKENS) },
      modelRuntime: base.modelRuntime,
      thinkingLevel: levels.includes('low') ? 'low' : 'off',
      noTools: 'all',
      tools: [tool.name, ...(fork.tools ?? []).map(item => item.name)],
      customTools: [tool, ...(fork.tools ?? [])],
      resourceLoader: resources,
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: false },
        transport: 'sse',
      }),
    }));
    if (
      session.sessionFile ||
      (fork.tools ?? []).some(item => accessOf(item) !== 'r') ||
      session.agent.state.tools.length !== 1 + (fork.tools?.length ?? 0) ||
      !session.agent.state.tools.some(item => item.name === tool.name)
    )
      throw new Error(`Unsafe ${fork.label} grant`);
    session.agent.state.messages = structuredClone(base.messages);
    meterSession(session, { agentId: config.channel.agentId, purpose: fork.purpose ?? 'triage' });
    detach = trace?.attach(session) ?? detach;
    combined.addEventListener('abort', abort, { once: true });
    combined.throwIfAborted();
    phase = 'evaluating';
    const failure = await runTriageTurns(session, fork.prompt, tool.name, () => Boolean(decision), combined);
    return !combined.aborted && decision ? decision : { action: fork.fallback, reason: failure };
  } catch {
    trace?.record(
      'error',
      'Fork failed',
      JSON.stringify({ phase, cancelled: combined.aborted, note: 'Raw provider/initialization errors are withheld.' }),
    );
    return { action: fork.fallback, reason: 'No actionable decision was made.' };
  } finally {
    clearTimeout(timeout);
    combined.removeEventListener('abort', abort);
    await session?.abort();
    detach();
    trace?.close();
    session?.dispose();
    base?.dispose();
  }
}
