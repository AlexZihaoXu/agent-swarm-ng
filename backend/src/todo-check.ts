import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from '@earendil-works/pi-coding-agent';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { chatResources } from './chat-runtime';
import { forkContext } from './interruption-triage';
import { TRIAGE_MAX_TOKENS } from './triage-turns';
import type { ActivityTrace } from './activity-events';
import { meterSession } from './usage/meter';
import { todoLines, type Todo } from './todos';

/** The check's limits (docs/agent-todos.md): model turns, and time (it re-reads the agent's whole context). */
export const TODO_CHECK_MAX_TURNS = 10;
export const TODO_CHECK_TIMEOUT_MS = 240_000;
export const TODO_NOTE_MAX = 800;

/** `failed`: no decision was made (error, timeout, cancelled); it means stop, but is not remembered as one. */
export type TodoDecision = { action: 'stop' | 'continue'; note: string; failed?: boolean };

type AgentMessage = AgentSession['messages'][number];
const DECISION = /^\W*(STOP|CONTINUE)\b\W*([\s\S]*)$/i;
export function parseTodoDecision(text: string): TodoDecision | undefined {
  const match = text.trim().match(DECISION);
  if (!match) return undefined;
  const note = match[2]!.trim().slice(0, TODO_NOTE_MAX);
  return { action: match[1]!.toUpperCase() === 'CONTINUE' ? 'continue' : 'stop', note: note || '(no details given)' };
}
const assistantText = (message: AgentMessage | undefined) =>
  message?.role === 'assistant'
    ? message.content
        .filter(block => block.type === 'text')
        .map(block => (block as { text: string }).text)
        .join('\n')
    : '';

export function todoCheckPrompt(todos: Todo[]) {
  return `Automatic todo check (from the platform, not a human message). This is a temporary read-only copy of your own conversation, made only to decide whether you should keep working now. Your todo list has unfinished items:
${todoLines(todos)}

Look at what you actually did (read-only tools only; anything that changes something is refused here) and answer with one line whose first word is the decision:
STOP: <short reason> when the work is in fact done (the list was just not updated), when you are blocked on something that will wake you (a timer, a watch or monitor, a reply you asked for), when it needs your owner, or when continuing now would not help.
CONTINUE: <note> when work remains that you can do now. The note becomes your next instruction in your real conversation: say concretely what to do next and how to finish (under ${TODO_NOTE_MAX} characters). Remind yourself to update the list and to report results with send_message when done.`;
}

/**
 * The turn-end todo check: a fork of the agent's live conversation that keeps the main request's exact system prompt,
 * tool list and transcript (so the provider reuses its cached prefix). Only read tools run (`reads`); anything else
 * is refused at execution; the decision is plain text rather than a new tool for the same reason. At most
 * TODO_CHECK_MAX_TURNS model turns. Any failure decides stop, so a broken check never loops the agent.
 */
export async function checkTodos(input: {
  main: AgentSession;
  thinkingLevel: string;
  channelId: string;
  todos: Todo[];
  /** Names of the agent's read-only tools: the only ones the check may run. */
  reads: Set<string>;
  signal: AbortSignal;
  trace?: ActivityTrace;
  agentId: string;
}): Promise<TodoDecision> {
  const { main } = input;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TODO_CHECK_TIMEOUT_MS);
  const combined = AbortSignal.any([input.signal, controller.signal]);
  let session: AgentSession | undefined;
  let detach = () => {};
  const abort = () => void session?.abort();
  try {
    combined.throwIfAborted();
    const systemPrompt = main.agent.state.systemPrompt;
    const resources = chatResources('Todo check', input.channelId, false, false);
    resources.getSystemPrompt = () => systemPrompt;
    const model = main.model!;
    const levels: string[] = model.reasoning ? getSupportedThinkingLevels(model) : ['off'];
    ({ session } = await createAgentSession({
      // The main request's settings, so its cached prefix is reused; output stays short.
      model: { ...model, maxTokens: Math.min(model.maxTokens, TRIAGE_MAX_TOKENS) },
      modelRuntime: main.modelRuntime,
      thinkingLevel: (levels.includes(input.thinkingLevel) ? input.thinkingLevel : 'off') as never,
      noTools: 'all',
      tools: [],
      customTools: [],
      resourceLoader: resources,
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: false },
        transport: 'sse',
      }),
    }));
    if (session.sessionFile) throw new Error('Unsafe todo check session');
    meterSession(session, { agentId: input.agentId, purpose: 'todo' });
    const agent = session.agent;
    agent.state.systemPrompt = systemPrompt;
    const prepare = agent.prepareNextTurnWithContext;
    agent.prepareNextTurnWithContext = async (turn, signal) => {
      const next = await prepare?.(turn, signal);
      return next?.context ? { ...next, context: { ...next.context, systemPrompt } } : next;
    };
    agent.state.tools = main.agent.state.tools;
    agent.state.messages = forkContext(main);
    agent.sessionId = main.sessionId;
    agent.beforeToolCall = async ({ toolCall }) =>
      input.reads.has(toolCall.name)
        ? undefined
        : {
            block: true,
            reason: `This is a read-only todo check, not your real turn: ${toolCall.name} changes something and is refused here. Look with read-only tools, then answer STOP: or CONTINUE:.`,
          };
    let turns = 0;
    const counting = agent.subscribe(event => {
      if (event.type === 'turn_end') turns++;
    });
    agent.shouldStopAfterTurn = () => turns >= TODO_CHECK_MAX_TURNS;
    detach = input.trace?.attach(session) ?? detach;
    combined.addEventListener('abort', abort, { once: true });
    try {
      let text = todoCheckPrompt(input.todos);
      while (!combined.aborted && turns < TODO_CHECK_MAX_TURNS) {
        await agent.prompt({ role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() });
        combined.throwIfAborted();
        const last = [...agent.state.messages].reverse().find(message => message.role === 'assistant');
        if (last?.role === 'assistant' && last.stopReason === 'error') break;
        const decision = parseTodoDecision(assistantText(last));
        if (decision) return decision;
        text = 'Automatic feedback: no decision was recorded. Answer with one line starting STOP: or CONTINUE:.';
      }
    } finally {
      counting();
    }
    return { action: 'stop', note: 'The todo check reached no decision.', failed: true };
  } catch {
    return { action: 'stop', note: 'The todo check could not run.', failed: true };
  } finally {
    clearTimeout(timer);
    combined.removeEventListener('abort', abort);
    await session?.abort();
    detach();
    input.trace?.close();
    session?.dispose();
  }
}
