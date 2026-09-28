import type { AgentRuns, RunContext, RunIdentity } from './agent-runs';

/** Test helper: enqueue a run only when the agent has none, the guard production code no longer needs. */
export function startRun(runs: AgentRuns, identity: RunIdentity, work: (context: RunContext) => Promise<void>) {
  if (runs.has(identity.agentId)) throw new Error('Agent is unavailable');
  return runs.enqueue(identity, work);
}
