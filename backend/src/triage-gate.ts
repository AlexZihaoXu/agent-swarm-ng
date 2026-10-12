const tails = new Map<string, Promise<unknown>>();

/**
 * Agents never triage in parallel: interruption, reaction and admission triage for one agent run one at a time,
 * in arrival order. A caller cancelled (`signal`) while it waits its turn stops waiting at once and its work never
 * runs: an interruption triage whose turn has ended must not hold up the next turn behind another triage.
 */
export function triageGate<T>(agentId: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const previous = tails.get(agentId) ?? Promise.resolve();
  const result = previous
    .catch(() => {})
    .then(() => {
      signal?.throwIfAborted();
      return work();
    });
  const tail = result.catch(() => {});
  tails.set(agentId, tail);
  void tail.then(() => {
    if (tails.get(agentId) === tail) tails.delete(agentId);
  });
  if (!signal) return result;
  return new Promise<T>((resolve, reject) => {
    const cancelled = () => reject(signal.reason ?? new Error('Triage cancelled.'));
    if (signal.aborted) return cancelled();
    signal.addEventListener('abort', cancelled, { once: true });
    result.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancelled));
  });
}
