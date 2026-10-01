import { useSyncExternalStore } from 'react';
import type { Box } from './floating-windows';
import type { PortalWindowTarget } from './portal-search';

/** A window Portal pulled out: it stays open across pages until closed; minimized, it waits in the dock. */
export type PortalWindow = {
  key: string;
  target: PortalWindowTarget;
  title: string;
  minimized: boolean;
  /** Where it grew from (the palette row, or its dock button), in page coordinates. */
  from: { x: number; y: number } | null;
};

export const windowKey = (target: PortalWindowTarget) =>
  target.kind === 'chat'
    ? `chat:${target.agentId}`
    : target.kind === 'terminal'
      ? `terminal:${target.computerId}:${target.session}`
      : `computer:${target.computerId}`;

let windows: PortalWindow[] = [];
const listeners = new Set<() => void>();
const set = (next: PortalWindow[]) => {
  windows = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const usePortalWindows = () => useSyncExternalStore(subscribe, () => windows);

/** Opens (or brings back) a window; an open one is restored rather than duplicated. */
export function openWindow(target: PortalWindowTarget, title: string, from: PortalWindow['from'] = null) {
  const key = windowKey(target);
  const existing = windows.find(item => item.key === key);
  set(
    existing
      ? windows.map(item => (item.key === key ? { ...item, title, minimized: false, from } : item))
      : [...windows, { key, target, title, minimized: false, from }],
  );
  return key;
}
export const minimizeWindow = (key: string, to: PortalWindow['from'] = null) =>
  set(windows.map(item => (item.key === key ? { ...item, minimized: true, from: to } : item)));
export const closeWindow = (key: string) => set(windows.filter(item => item.key !== key));

// Where each window was last left, per browser (a convenience: private windows and blocked storage just forget).
const STORE = 'portal-window-boxes';
export function savedBox(key: string): Box | null {
  try {
    const boxes = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, Box>;
    const box = boxes[key];
    return box && [box.x, box.y, box.width, box.height].every(Number.isFinite) ? box : null;
  } catch {
    return null;
  }
}
export function saveBox(key: string, box: Box) {
  try {
    const boxes = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, Box>;
    delete boxes[key];
    boxes[key] = box;
    // Only the most recent few windows are remembered.
    const keys = Object.keys(boxes);
    for (const old of keys.slice(0, Math.max(0, keys.length - 30))) delete boxes[old];
    localStorage.setItem(STORE, JSON.stringify(boxes));
  } catch {
    /* storage unavailable: positions are not remembered */
  }
}
