import { useSyncExternalStore } from 'react';

/** Page (viewport) coordinates of a floating window. */
export type Box = { x: number; y: number; width: number; height: number };

/** At least this much of a floating window stays on screen, so it can always be grabbed again. */
export const KEEP_VISIBLE = 64;

/**
 * Floating windows may be dragged anywhere on the page, even past the viewer, but keep {@link KEEP_VISIBLE} pixels
 * on screen horizontally and their title bar on screen vertically.
 */
export function keepReachable(box: Box): Box {
  return {
    ...box,
    x: Math.min(Math.max(box.x, KEEP_VISIBLE - box.width), window.innerWidth - KEEP_VISIBLE),
    y: Math.min(Math.max(box.y, 0), window.innerHeight - KEEP_VISIBLE),
  };
}

// Stacking and focus: the window touched last is on top, and it is the focused one until something outside the
// floating windows is touched. Floating windows sit above the page and below dialogs (z-50).
let state: { order: string[]; active: string | null } = { order: [], active: null };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const set = (next: typeof state) => {
  state = next;
  for (const listener of listeners) listener();
};

/** Brings a window to the front and focuses it. */
export function raiseWindow(id: string) {
  if (state.order.at(-1) === id && state.active === id) return;
  set({ order: [...state.order.filter(item => item !== id), id], active: id });
}

if (typeof document !== 'undefined') {
  // Touching anything that is not a floating window (the desktop, the header) leaves no window focused.
  document.addEventListener(
    'pointerdown',
    event => {
      if (state.active && !(event.target as Element | null)?.closest?.('[data-floating-window]'))
        set({ ...state, active: null });
    },
    true,
  );
  // Clicking into the live desktop moves focus into its frame, which the page never sees as a pointer press.
  window.addEventListener('blur', () =>
    queueMicrotask(() => {
      if (state.active && document.activeElement instanceof HTMLIFrameElement) set({ ...state, active: null });
    }),
  );
}

/** This window's z-index (40 and up, in the order windows were last touched) and whether it is focused. */
export function useWindowLayer(id: string) {
  const current = useSyncExternalStore(subscribe, () => state);
  return { zIndex: 40 + Math.max(0, current.order.indexOf(id)), focused: current.active === id };
}

/** Which edge or corner of a window is being dragged to resize it. */
export type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/**
 * The box after dragging `edge` by (dx, dy). `size` turns the wanted size into an allowed one (minimums, a fixed
 * shape); the opposite edges stay where they were, and the result is kept reachable.
 */
export function resizeFrom(
  start: Box,
  edge: Edge,
  dx: number,
  dy: number,
  size: (want: { width: number; height: number }, edge: Edge) => { width: number; height: number },
): Box {
  const next = size(
    {
      width: start.width + (edge.includes('e') ? dx : edge.includes('w') ? -dx : 0),
      height: start.height + (edge.includes('s') ? dy : edge.includes('n') ? -dy : 0),
    },
    edge,
  );
  return keepReachable({
    ...next,
    x: edge.includes('w') ? start.x + start.width - next.width : start.x,
    y: edge.includes('n') ? start.y + start.height - next.height : start.y,
  });
}
