import type { AgentSession } from '@earendil-works/pi-coding-agent';

export const TRIAGE_MAX_TURNS = 10;
export const TRIAGE_MAX_TOKENS = 4096;
export const TRIAGE_TIMEOUT_MS = 120_000;

/** One provider turn per prompt, including turns with invalid tool calls. Never publishes fork output. */
export async function runTriageTurns(
  fork: AgentSession,
  initial: string,
  toolName: string,
  decided: () => boolean,
  signal: AbortSignal,
): Promise<string> {
  const previousStop = fork.agent.shouldStopAfterTurn;
  fork.agent.shouldStopAfterTurn = () => true;
  let turns = 0;
  let feedback = 'No valid decision was recorded.';
  try {
    while (turns < TRIAGE_MAX_TURNS && !signal.aborted) {
      const prompt =
        turns === 0
          ? initial
          : `Automatic private feedback (not a human message). Triage correction ${turns + 1}/${TRIAGE_MAX_TURNS}: ${feedback}\nReview any tool errors above and correct the call. Only ${toolName} is granted. Call it with valid arguments and a brief reason; do not perform the original task or output prose instead of a decision.`;
      turns++;
      await fork.prompt(prompt, { expandPromptTemplates: false });
      if (signal.aborted) break;
      if (decided()) return 'Decision recorded.';
      const message = [...fork.messages].reverse().find(message => message.role === 'assistant');
      // Transport/auth/context errors are not model-correctable tool mistakes. No blind API retries or raw error leakage.
      if (message?.role === 'assistant' && message.stopReason === 'error')
        return `Triage provider request failed on turn ${turns}; no decision recorded.`;
      feedback =
        message?.role === 'assistant' && message.stopReason === 'length'
          ? 'No valid decision: the previous response hit its output token limit. Keep reasoning brief and re-issue a complete decision call.'
          : 'No valid decision was recorded. A missing, invalid or unavailable tool call is not a decision.';
    }
    return signal.aborted
      ? `Triage cancelled or timed out after ${turns} turns.`
      : `No valid decision after ${TRIAGE_MAX_TURNS} turns.`;
  } finally {
    fork.agent.shouldStopAfterTurn = previousStop;
  }
}
