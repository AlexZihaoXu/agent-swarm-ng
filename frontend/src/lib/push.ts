import { api } from '@/api/client';
import { randomUuid } from '@/lib/random-uuid';

/**
 * Web Push on this device (docs/notifications.md). The service worker (public/push-sw.js) shows what arrives;
 * here: whether this browser can, turning it on (the permission prompt needs a tap), and telling the backend.
 */
export type PushSupport =
  | 'supported'
  /** iPhone/iPad: only the app added to the Home Screen can receive pushes. */
  | 'ios-browser'
  | 'unsupported';

const isIos = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const installed = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function pushSupport(): PushSupport {
  const capable =
    window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (isIos() && !installed()) return 'ios-browser';
  return capable ? 'supported' : 'unsupported';
}

/** The page's service worker (none on the dev server, which registers none). */
async function registration() {
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

const keyBytes = (base64url: string) => {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};
const sameKey = (subscription: PushSubscription, key: Uint8Array) => {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === key.length && bytes.every((value, index) => value === key[index]);
};

export type Device = { id: string; label: string; createdAt: string; lastSuccessAt: string | null; paused: boolean };

async function save(subscription: PushSubscription, refresh = false): Promise<Device | null> {
  const json = subscription.toJSON();
  const { data, error, response } = await api.POST('/api/push/subscriptions', {
    body: {
      endpoint: subscription.endpoint,
      keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
      ...(refresh ? { refresh: true } : {}),
    },
  });
  if (refresh && response.status === 404) return null;
  if (!data) throw new Error((error as { message?: string } | undefined)?.message ?? 'Could not save this device.');
  return data;
}

async function serverKey() {
  const { data } = await api.GET('/api/push/key');
  if (!data) throw new Error('Notifications are unavailable on the dashboard right now.');
  return keyBytes(data.publicKey);
}

/**
 * This device, when notifications are on for it: its browser subscription (made with the dashboard's key) saved
 * again on the backend, which browsers need as they rotate them. Only a device the backend still has: one removed
 * elsewhere stays off (null), and a paused one stays paused.
 */
export async function currentDevice(): Promise<Device | null> {
  if (pushSupport() !== 'supported' || Notification.permission !== 'granted') return null;
  const subscription = await (await registration())?.pushManager.getSubscription();
  if (!subscription || !sameKey(subscription, await serverKey())) return null;
  return save(subscription, true);
}

/** Asks for permission (call from a tap), subscribes with the platform's key and saves this device. */
export async function enablePush(): Promise<Device> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted')
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked for this site. Allow them in the browser’s site settings, then try again.'
        : 'Notifications were not allowed.',
    );
  const worker = await registration();
  if (!worker) throw new Error('The app’s service worker is not running here. Reload the page and try again.');
  const key = await serverKey();
  let subscription = await worker.pushManager.getSubscription();
  // Subscribed with another key (another dashboard, a reset): start again with ours.
  if (subscription && !sameKey(subscription, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return (await save(subscription))!;
}

/**
 * Signing out: this browser stops receiving (best effort, at most 2 s). The backend drops the device with the session
 * either way.
 */
export async function forgetThisBrowser() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const unsubscribe = (async () => {
    await (await (await registration())?.pushManager.getSubscription())?.unsubscribe();
  })().catch(() => undefined);
  await Promise.race([unsubscribe, new Promise(resolve => setTimeout(resolve, 2000))]);
}

/** Stops pushes to this device: unsubscribes in the browser too. */
export async function disablePush(deviceId: string) {
  await (await (await registration())?.pushManager.getSubscription())?.unsubscribe();
  await api.DELETE('/api/push/subscriptions/{id}', { params: { path: { id: deviceId } } });
}

/** This tab, for presence reports (not stored anywhere). */
const tabId = randomUuid();
const PRESENCE_EVERY_MS = 25_000;

/**
 * Tells the backend while this tab is visible and focused (and when it stops being), so nothing is pushed to a person
 * looking at the dashboard. Returns a stop function.
 */
export function reportPresence() {
  let last: boolean | null = null;
  const send = (active: boolean) =>
    void window
      .fetch('/api/push/presence', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tabId, active }),
        keepalive: true,
        credentials: 'same-origin',
      })
      .catch(() => undefined);
  const update = () => {
    const active = document.visibilityState === 'visible' && document.hasFocus();
    if (active === last && !active) return;
    last = active;
    send(active);
  };
  const leave = () => {
    last = false;
    send(false);
  };
  const timer = window.setInterval(() => {
    if (last) update();
  }, PRESENCE_EVERY_MS);
  const events = ['focus', 'blur'] as const;
  events.forEach(name => window.addEventListener(name, update));
  document.addEventListener('visibilitychange', update);
  window.addEventListener('pagehide', leave);
  update();
  return () => {
    window.clearInterval(timer);
    events.forEach(name => window.removeEventListener(name, update));
    document.removeEventListener('visibilitychange', update);
    window.removeEventListener('pagehide', leave);
    leave();
  };
}

/** A tap on a notification while the app is open: the worker asks the app to go there (no reload). */
export function onNotificationOpen(navigate: (path: string) => void) {
  if (!('serviceWorker' in navigator)) return () => {};
  const listener = (event: MessageEvent) => {
    const data = event.data as { type?: string; url?: string } | null;
    if (data?.type !== 'open-path' || typeof data.url !== 'string') return;
    try {
      const url = new URL(data.url, window.location.origin);
      if (url.origin === window.location.origin) navigate(`${url.pathname}${url.search}`);
    } catch {
      // Not a URL: ignored.
    }
  };
  navigator.serviceWorker.addEventListener('message', listener);
  return () => navigator.serviceWorker.removeEventListener('message', listener);
}
