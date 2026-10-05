// Push notifications (docs/notifications.md), imported by the generated service worker (vite.config.ts importScripts).
// The payload is the JSON the backend encrypted for this device (backend/src/push/sender.ts PushPayload).
const APP_ICON = '/icon-192.png?v=2';
const BADGE = '/badge-96.png?v=1';

/** Only paths of this dashboard: a payload never sends a tap elsewhere. */
const sameOrigin = path => {
  try {
    const url = new URL(path || '/', self.location.origin);
    return url.origin === self.location.origin ? url.href : self.location.origin + '/';
  } catch {
    return self.location.origin + '/';
  }
};

/** Apple's WebKit (iPhone, iPad, Safari on a Mac) always shows the app's icon: fetching another would only delay. */
const appleWebKit =
  /iPhone|iPad|iPod|Macintosh/.test(self.navigator.userAgent) &&
  !/Chrome|Chromium|CriOS|Firefox|FxiOS|Edg/.test(self.navigator.userAgent);
/** The notification must show promptly whatever the network does: the avatar gets this long, then the app icon. */
const ICON_WAIT_MS = 2500;

/**
 * An agent's avatar as a data: URL, fetched with the session cookie (same origin). Browsers load notification icons
 * on their own, not always with cookies, so the worker does it; anything wrong or slow falls back to the app icon.
 */
async function iconFor(path) {
  if (!path || !path.startsWith('/api/') || appleWebKit) return APP_ICON;
  try {
    const response = await fetch(sameOrigin(path), {
      credentials: 'same-origin',
      cache: 'no-cache',
      // Covers reading the body too.
      signal: AbortSignal.timeout(ICON_WAIT_MS),
    });
    const type = response.headers.get('content-type') || '';
    if (!response.ok || !type.startsWith('image/png')) return APP_ICON;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 65536) return APP_ICON;
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:image/png;base64,${btoa(binary)}`;
  } catch {
    return APP_ICON;
  }
}

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  // iOS requires every push to show a notification, so there is always one.
  event.waitUntil(
    iconFor(data.icon).then(icon =>
      self.registration.showNotification(String(data.title || 'Agent Swarm'), {
        body: String(data.body || ''),
        icon,
        badge: BADGE,
        tag: data.tag ? String(data.tag) : undefined,
        renotify: Boolean(data.tag && data.renotify),
        timestamp: Number(data.timestamp) || Date.now(),
        data: { url: sameOrigin(data.url) },
      }),
    ),
  );
});

/** A computer's desktop stream (its own page, not the dashboard app). */
const desktop = /^\/computers\/[^/]+\/desktop(?:\/|$)/;

/**
 * Opens a dashboard page: an open app window goes there without reloading (src/lib/push.ts listens), another window of
 * the dashboard (a desktop stream) is navigated there, or a new window opens.
 */
async function openApp(path) {
  const url = sameOrigin(path);
  const windows = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(
    client => client.frameType !== 'nested' && new URL(client.url).origin === self.location.origin,
  );
  const app = windows.find(client => !desktop.test(new URL(client.url).pathname));
  // Focusing needs the tap's user activation; without it the window is still told where to go.
  if (app) {
    await app.focus().catch(() => undefined);
    app.postMessage({ type: 'open-path', url });
    return app;
  }
  if (windows[0]) {
    const moved = await windows[0].navigate(url).catch(() => null);
    if (moved) return moved.focus().catch(() => moved);
  }
  return self.clients.openWindow(url);
}
self.openApp = openApp;

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(openApp(event.notification.data && event.notification.data.url));
});
