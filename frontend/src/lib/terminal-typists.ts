import { useSyncExternalStore } from 'react';
import type { AvatarAppearance } from '@/lib/agent-avatar';

/** An agent typing into a terminal (from the backend's terminal_activity events). */
export type Typist = { agentId: string; name: string; avatar: AvatarAppearance | null; active: boolean };

/** How long an agent stays shown after its last combo ends, so consecutive combos do not flicker it. */
const LINGER_MS = 3000;
let typists = new Map<string, Typist>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const publish = (next: Map<string, Typist>) => {
  typists = next;
  for (const listener of listeners) listener();
};

export function recordTerminalActivity(event: {
  agentId: string;
  computerId: string;
  session: string;
  active: boolean;
  name: string;
  avatar?: AvatarAppearance | null;
}) {
  const key = `${event.computerId}:${event.session}`;
  clearTimeout(timers.get(key));
  timers.delete(key);
  const next = new Map(typists);
  next.set(key, { agentId: event.agentId, name: event.name, avatar: event.avatar ?? null, active: event.active });
  publish(next);
  if (!event.active)
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        const after = new Map(typists);
        after.delete(key);
        publish(after);
      }, LINGER_MS),
    );
}

/** The agent typing into this terminal right now (or a moment ago), if any. */
export function useTerminalTypist(computerId: string, session: string) {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => typists.get(`${computerId}:${session}`),
  );
}
