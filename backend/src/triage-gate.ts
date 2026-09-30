const tails = new Map<string, Promise<unknown>>();

/**
 * Agents never triage in parallel: interruption, reaction and admission triage for one agent run one at a time,
 * in arrival order. A cancelled caller still takes its turn; its work sees the aborted signal and returns at once.
 */
export function triageGate<T>(agentId: string, work: () => Promise<T>): Promise<T> {
  const previous = tails.get(agentId) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(work);
  const tail = result.catch(() => {});
  tails.set(agentId, tail);
  void tail.then(() => {
    if (tails.get(agentId) === tail) tails.delete(agentId);
  });
  return result;
}
