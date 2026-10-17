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

/** How often an open app looks for a new version. */
const CHECK_MS = 60_000;

const updateServiceWorker = registerSW({
  onNeedRefresh: () => setNeedRefresh(true),
  // Browsers look for a new service worker only when a page loads, which an installed app left open (or resumed
  // from the background) never does: look every minute and whenever it comes back to the front.
  onRegisteredSW: (_url, registration) => {
    if (!registration) return;
    const check = () => {
      if (!registration.installing && navigator.onLine) registration.update().catch(() => {});
    };
    setInterval(check, CHECK_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  },
});

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
