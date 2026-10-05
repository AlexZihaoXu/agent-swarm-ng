# Push notifications

The dashboard can notify you on your phone or computer when an agent writes to you, writes in one of your group chats or gets stuck, and (admin) when something critical happens, even while the dashboard is closed. It uses standard Web Push: no app store, no third-party account.

## How it works

1. **Turn it on per device** in **Settings → Account → Notifications** → **Turn on notifications on this device**. The browser asks for permission (a tap is required), then the app's service worker subscribes at the browser's push service (Google FCM for Chrome/Edge/Android, Apple for Safari and iPhone, Mozilla for Firefox, Microsoft WNS for legacy Edge) with the platform's VAPID public key. The subscription (an endpoint URL and two keys) is saved for you (`PushSubscription`), named from the browser ("Chrome on Android", "Safari on iPhone"), and tied to the browser session that turned it on: signing out, a password change or reset, and admin disabling or deleting the person end the session and with it that device's pushes (signing out also unsubscribes the browser). A session that expired gets nothing. Each visit to Settings saves this device's subscription again (browsers rotate them), but only while the backend still has the device and it was made with the dashboard's current key: a device removed elsewhere stays removed, a paused one stays paused. A person keeps at most 20 devices; turning on one more drops the oldest.
2. **On an event**, the backend (`backend/src/push/`) encrypts a small JSON payload for each of your devices (RFC 8291, `web-push`), signs the request with its VAPID key (RFC 8292) and posts it to the device's push service, which delivers it.
3. **The service worker** (`frontend/public/push-sw.js`, imported by the generated worker) shows the notification. Tapping it focuses an open dashboard window and moves it to the right page without reloading; a window showing only a computer's desktop stream is navigated there instead, and with none open a new window opens.

The VAPID key pair is made on first use in `.local/push/vapid.json` (folder 0700, file 0600; looser permissions on an existing one are put back) and kept: every subscription is bound to its public key, so replacing it means every device turns notifications on again. The private key never leaves the backend (no response, log or database row). An unreadable key file is reported without its contents or path, and `GET /api/push/key` then answers 503. The sender is named to push services by `PUSH_SUBJECT` (an https address, for example the dashboard's public address; `.env`), defaulting to the project's page, never a personal email.

Delivery needs HTTPS the device trusts (a public domain, or a certificate the device trusts) and a backend that can reach the internet.

## What notifies

| Event | Who | Title | Text | Tap opens |
| --- | --- | --- | --- | --- |
| An agent publishes in its private chat | the owner of the agent's organization | agent name | the message as plain text (Markdown removed, ~160 characters) | `/chat/agents/:id` |
| An agent writes in a group chat | the owner of the group's organization | group name | "Agent: text" | `/chat/groups/:id` |
| An agent run started by your message in its private chat ends on an error before it published anything | the owner of the agent's organization | "Aether couldn't finish" | the reason in plain words | `/chat/agents/:id` |
| Critical events: a lockdown, a failed sign-in burst, an outage, a disk over 90% full | admin | the banner's title | its detail (a sign-in burst: counts only; the names tried stay in the log) | the matching log in Settings, or the Dashboard |

Never notified: messages between agents (DMs), Discord (you are already on Discord; a run you started there that fails is not reported either, nor one started by a group message, a timer or a heartbeat), your own messages, thinking, tools and other activity, heartbeats that leave no message, and runs a person (or a backend shutdown) stopped. Admin sees every organization in the dashboard but gets message pushes only for organizations they own, plus critical events.

The triggers watch the backend's run event bus and critical-event listeners, never the chat path: a push that fails or is slow never delays or fails a chat message.

### Icons

Agent messages (private and group) use the agent's avatar: the dashboard draws each agent's avatar as a 192 px PNG (the same art, at rest) and uploads it (`PUT /api/agents/:id/avatar.png`) whenever the backend has none for its current look (`GET /api/push/avatars` lists those). The service worker fetches it with the session cookie, waiting at most 2.5 seconds, and falls back to the app icon; on Apple's WebKit (iPhone, iPad, Safari on a Mac), which always shows the app's icon, it does not fetch at all, so the notification always shows promptly. An upload names the look it was drawn from and is refused (409) if the avatar changed meanwhile. System notifications (agent problems, critical events, the test) use the app icon. Android shows the monochrome pebble badge (`badge-96.png`) in the status bar. iPhone and iPad always show the app's icon (Web Push cannot change it).

## When not to notify

- **You are looking at the dashboard.** Each open dashboard tab reports to the backend (`POST /api/push/presence`) when it becomes visible and focused (and every 25 seconds while it is), and when it is hidden, loses focus or closes. While any of your tabs reported so within the last minute, on any device, nothing is pushed to you: the in-app sound, unread marks and banners have it. A backend restart forgets presence until the tabs report again.
- **Bursts.** Messages of one conversation are collected for 3 seconds of quiet (at most 10 seconds; notifications still waiting when the backend stops are dropped) and sent as one notification ("Aether · 3 new messages" with the latest text). Notifications of one conversation share a tag, so a newer one replaces the older one on the device.
- **Dead devices.** A device whose subscription is gone (the push service answers 404 or 410) is deleted. Other failures are counted; after 5 in a row the device is paused (shown in Settings) until notifications are turned on again from it.
- **Full disks** notify when a disk crosses 90%, and again only after it fell below 88% (or the backend restarted).
- At most 5 requests to push services run at once for one notification.

## Settings

**Settings → Account → Notifications** (Kibo `switch-cards-3`, like the agent's Discord settings):

- **Turn on notifications on this device**, or "On for this device". On an iPhone or iPad in Safari it explains adding the app to the Home Screen first; a browser without Web Push (or without HTTPS) says so; a refused permission explains how to allow it again.
- **Devices**: each of your devices, when it last received one, **Remove**. Removing this device also unsubscribes it in the browser.
- **What to be told** (all on by default, per person): Agent messages, Group chats, Agent problems, Critical alerts (admin only) and **Show message text**: off, message notifications say "New message" instead of the text, so nothing of a chat shows on the lock screen.
- **Send test notification**: to every one of your devices at once, whatever the settings and presence, except paused ones; at most one every 10 seconds.

Later, maybe: muting one conversation, quiet hours.

## Privacy

- The payload (title, text, page, icon address) is **encrypted end to end** for the device: Apple, Google, Mozilla and Microsoft relay it but cannot read it. They see its size and timing, the dashboard's VAPID public key and the subscription it is for. Payloads stay under 3 KB.
- Message text is reduced to plain text (Markdown and HTML tags removed) from at most its first 4 KB.
- With **Show message text** off, the notification itself (on the lock screen, in the notification centre) shows only the agent or group name and "New message".
- Subscriptions, preferences and avatar images are in the database; subscription endpoints and keys are never returned to the dashboard (only a device's id, name and dates) or logged. Delivery failures are logged with the device id and the push service's status only.
- The backend posts only to known push services (`fcm.googleapis.com`, `*.push.apple.com`, `*.push.services.mozilla.com`, `*.notify.windows.com` over HTTPS), so a subscription cannot make it call anything else, never following redirects.

## Routes

All are a person's own (`backend/src/users/rules.ts`): `GET /api/push/key`, `GET|POST /api/push/subscriptions`, `DELETE /api/push/subscriptions/:id` (own devices only; another person's is 404), `GET|PATCH /api/push/preferences`, `POST /api/push/test`, `POST /api/push/presence`; `GET /api/push/avatars` lists only the agents the person reaches; `GET|PUT /api/agents/:id/avatar.png` need access to that agent (a PNG of at most 512×512 and 64 KB, `?look=` from the list). `POST /api/push/subscriptions` with `refresh: true` only updates a device the person already has (404 otherwise); `POST /api/push/test` answers 429 within 10 seconds of the last.

## Platforms and limits

- **Android** Chrome/Edge/Firefox and **desktop** Chrome/Edge/Firefox/Safari: in the browser or the installed app.
- **iPhone/iPad** (iOS 16.4+): only the app added to the Home Screen, opened from there. iOS shows a notification for every push (no silent ones), which is why presence and batching are decided on the server.
- Checked automatically: the backend sender against a local stand-in push service (the request is decrypted with the device's keys and its VAPID signature verified), every trigger, presence, batching and expiry; the Settings card with the browser's push side faked; the production service worker's push and tap handlers through Chromium's DevTools push delivery. Not yet checked on real devices: delivery through Apple/Google/Mozilla, the iPhone Home Screen app, Android's avatar and badge, and taps from the lock screen.
