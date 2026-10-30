import { useSyncExternalStore } from 'react';

/**
 * Whether this viewer forwards the mouse to terminal programs that ask for it. Off by default; remembered per
 * browser (a convenience, so storage failures just mean "off"), and shared by every terminal on the page.
 */
const key = 'terminal-mouse';
const listeners = new Set<() => void>();
let enabled = (() => {
  try {
    return localStorage.getItem(key) === 'on';
  } catch {
    return false;
  }
})();
const notify = () => listeners.forEach(listener => listener());
// Another tab changing it applies here too.
window.addEventListener('storage', event => {
  if (event.key !== key) return;
  enabled = event.newValue === 'on';
  notify();
});
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export function setTerminalMouse(value: boolean) {
  enabled = value;
  try {
    if (value) localStorage.setItem(key, 'on');
    else localStorage.removeItem(key);
  } catch {}
  notify();
}
export const useTerminalMouse = () => useSyncExternalStore(subscribe, () => enabled);
