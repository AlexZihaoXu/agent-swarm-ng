/// <reference types="vite-plugin-pwa/vanillajs" />
import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

// The service worker registers once, as the page loads, so a signed-out visitor can install the app too (the dashboard
// only mounts after sign-in). The signed-in dashboard reads `needRefresh` to offer the update.
let needRefresh = false;
const listeners = new Set<() => void>();
const setNeedRefresh = (value: boolean) => {
  needRefresh = value;
  listeners.forEach(listener => listener());
};

const updateServiceWorker = registerSW({ onNeedRefresh: () => setNeedRefresh(true) });

/** Whether a new version is waiting, and how to apply (reload) or dismiss it. */
export function useAppUpdate() {
  const ready = useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => needRefresh,
  );
  return { needRefresh: ready, dismiss: () => setNeedRefresh(false), update: () => updateServiceWorker(true) };
}
