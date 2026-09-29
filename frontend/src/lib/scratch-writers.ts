import { useSyncExternalStore } from 'react';

/** How long "writing" stays shown after the last scratchpad change, so consecutive edits do not flicker it. */
const LINGER_MS = 2000;
let writers = new Map<string, string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
/** Bumped whenever an agent's scratchpad changes, so open browsers refresh. */
let revisions = new Map<string, number>();
const publish = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** From the backend's scratch_activity events: an agent started or finished changing `path`. */
export function recordScratchActivity(event: { agentId: string; path: string; active: boolean }) {
  clearTimeout(timers.get(event.agentId));
  timers.delete(event.agentId);
  writers = new Map(writers).set(event.agentId, event.path);
  if (!event.active) {
    revisions = new Map(revisions).set(event.agentId, (revisions.get(event.agentId) ?? 0) + 1);
    timers.set(
      event.agentId,
      setTimeout(() => {
        timers.delete(event.agentId);
        writers = new Map(writers);
        writers.delete(event.agentId);
        publish();
      }, LINGER_MS),
    );
  }
  publish();
}

/** The scratch file this agent is writing right now (or a moment ago), if any. */
export function useScratchWriter(agentId: string | undefined) {
  return useSyncExternalStore(subscribe, () => (agentId ? writers.get(agentId) : undefined));
}
/** Changes whenever this agent's scratchpad changes. */
export function useScratchRevision(agentId: string) {
  return useSyncExternalStore(subscribe, () => revisions.get(agentId) ?? 0);
}
/** Snapshot getters (tests and non-React callers). */
export const scratchWriter = (agentId: string) => writers.get(agentId);
export const scratchRevision = (agentId: string) => revisions.get(agentId) ?? 0;
