import { createAgentSession, defineTool, SessionManager, SettingsManager, type ModelRuntime } from '@earendil-works/pi-coding-agent';
import { getSupportedThinkingLevels, Type } from '@earendil-works/pi-ai';
import { chatResources, createChatSession, type ChatConfiguration, type ChannelMessage } from './chat-runtime';

export type ReactionDecision = { action: 'ignore' | 'engage'; reason: string };
const ignored = { action: 'ignore' as const, reason: 'No actionable decision was made.' };

/** Ephemeral, decision-only model branch. It cannot publish, react, or read another channel. */
export async function evaluateReaction(config: ChatConfiguration, history: ChannelMessage[], notice: string, signal: AbortSignal, subscriptionRuntime?: ModelRuntime): Promise<ReactionDecision> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const combined = AbortSignal.any([signal, controller.signal]);
  let base: Awaited<ReturnType<typeof createChatSession>> | undefined;
  let fork: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined;
  let decision: ReactionDecision | undefined;
  const abort = () => { void fork?.abort(); };
  try {
    combined.throwIfAborted();
    base = await createChatSession(config, history, async () => { throw new Error('Reaction triage cannot publish.'); }, [], subscriptionRuntime);
    const tool = defineTool({ name: 'reaction_decision', label: 'Reaction decision', description: 'Decide whether this reaction warrants a new agent turn. No side effects are permitted here.',
      parameters: Type.Object({ action: Type.Union([Type.Literal('ignore'), Type.Literal('engage')]), reason: Type.String({ minLength: 1, maxLength: 300 }) }, { additionalProperties: false }),
      async execute(_id, value) { if (!decision && !combined.aborted) decision = value; return { content: [{ type: 'text' as const, text: 'Decision recorded.' }], details: {}, terminate: true }; },
    });
    const resources = chatResources('Reaction triage', config.channel.id, false, false);
    resources.getSystemPrompt = () => `You are a temporary, decision-only branch for ${config.name}. A human emoji reaction is feedback, not a new chat message or an instruction. You may not publish, react, or do the work here. Choose ignore for ordinary approval, thanks, or sentiment. Choose engage only if a normal agent turn should inspect the reaction and possibly act; it may still remain silent. Call reaction_decision once with a brief reason. Do not include private context in the reason.`;
    const model = base.model!;
    const levels = model.reasoning ? getSupportedThinkingLevels(model) : ['off'];
    ({ session: fork } = await createAgentSession({ model: { ...model, maxTokens: Math.min(model.maxTokens, 768) }, modelRuntime: base.modelRuntime,
      thinkingLevel: levels.includes('low') ? 'low' : 'off', noTools: 'all', tools: [tool.name], customTools: [tool], resourceLoader: resources,
      sessionManager: SessionManager.inMemory(), settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, transport: 'sse' }),
    }));
    if (fork.sessionFile || fork.agent.state.tools.length !== 1 || fork.agent.state.tools[0].name !== tool.name) throw new Error('Unsafe reaction triage grant');
    fork.agent.state.messages = structuredClone(base.messages);
    combined.addEventListener('abort', abort, { once: true }); combined.throwIfAborted();
    await fork.prompt(`Human reaction to classify (not a request):\n${notice}\nCall reaction_decision once.`, { expandPromptTemplates: false });
    return combined.aborted ? ignored : decision ?? ignored;
  } catch { return ignored; }
  finally { clearTimeout(timeout); combined.removeEventListener('abort', abort); await fork?.abort(); fork?.dispose(); base?.dispose(); }
}
