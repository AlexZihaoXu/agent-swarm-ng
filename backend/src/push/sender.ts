import { createHash } from 'node:crypto';
import webpush from 'web-push';
import type { PushStore } from './store';
import type { VapidKeys } from './vapid';
import { BODY_LIMIT, clip, TITLE_LIMIT } from './preview';

/** What the service worker shows (frontend/public/push-sw.js). Encrypted end to end: push services see only its size. */
export type PushPayload = {
  title: string;
  body: string;
  /** Same tag: the new notification replaces the previous one (one per conversation). */
  tag: string;
  /** The dashboard page a tap opens. */
  url: string;
  /** Same-origin image URL; the worker falls back to the app icon. */
  icon?: string;
  timestamp: number;
  /** Alert again when it replaces an earlier one with the same tag. */
  renotify: boolean;
};

/** Push services accept 4 KB; ours stay under 3 KB. */
export const PAYLOAD_LIMIT = 3072;

export type PushRequest = {
  endpoint: string;
  method: string;
  headers: Record<string, string | number>;
  body: Buffer | null;
};
/** Sends one encrypted request to a push service and answers its HTTP status. */
export type PushTransport = (request: PushRequest) => Promise<number>;

/** Plain fetch, never following redirects (a push service answers directly), at most 10 s. */
export const fetchTransport: PushTransport = async request => {
  const response = await fetch(request.endpoint, {
    method: request.method,
    headers: Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, String(value)])),
    body: request.body ? new Uint8Array(request.body) : undefined,
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  await response.body?.cancel().catch(() => {});
  return response.status;
};

type Log = { warn(object: object, message: string): void };

/** Requests to push services in flight at once, per notification. */
export const SEND_CONCURRENCY = 5;
async function eachLimited<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++]!);
    }),
  );
}

/** The JSON a device receives: title and body cut down until the whole fits in PAYLOAD_LIMIT bytes. */
export function encodePayload(payload: PushPayload) {
  let title = clip(payload.title, TITLE_LIMIT),
    body = clip(payload.body, BODY_LIMIT);
  let json = JSON.stringify({ ...payload, title, body });
  // Only pathological text (every character escaped or 4 bytes) gets here.
  while (Buffer.byteLength(json) > PAYLOAD_LIMIT && (body.length > 1 || title.length > 1)) {
    body = clip(body, Math.max(1, Math.floor(Array.from(body).length / 2)));
    title = clip(title, Math.max(1, Math.floor(Array.from(title).length / 2)));
    json = JSON.stringify({ ...payload, title, body });
  }
  return json;
}

/**
 * Delivers notifications to a person's devices (RFC 8291 encryption and VAPID signing by `web-push`). A device whose
 * subscription is gone (404/410) is deleted; other failures are counted (MAX_FAILURES pauses it). Never throws:
 * a push failure must not reach the chat path. Logs carry the status and device id, never endpoints or keys.
 */
export class PushSender {
  constructor(
    private readonly store: PushStore,
    private readonly keys: () => Promise<VapidKeys>,
    private readonly subject: string,
    private readonly log: Log,
    private readonly transport: PushTransport = fetchTransport,
  ) {}

  async send(userId: string, payload: PushPayload, urgency: 'normal' | 'high' = 'normal') {
    const result = { delivered: 0, failed: 0, expired: 0 };
    let devices: Awaited<ReturnType<PushStore['targets']>>;
    try {
      devices = await this.store.targets(userId);
    } catch (error) {
      this.log.warn({ err: error instanceof Error ? error.message : 'unknown' }, 'Push: could not read devices');
      return result;
    }
    let keys: VapidKeys;
    try {
      keys = await this.keys();
    } catch (error) {
      this.log.warn({ err: error instanceof Error ? error.message : 'unknown' }, 'Push: no VAPID keys');
      return result;
    }
    const json = encodePayload(payload);
    // A topic lets the push service replace a not-yet-delivered message of the same conversation.
    const topic = createHash('sha256').update(payload.tag).digest('base64url').slice(0, 32);
    await eachLimited(devices, SEND_CONCURRENCY, async device => {
      let status = 0;
      try {
        const request = webpush.generateRequestDetails(
          { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
          json,
          {
            vapidDetails: { subject: this.subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
            TTL: 24 * 3600,
            urgency,
            topic,
          },
        ) as unknown as PushRequest;
        status = await this.transport(request);
      } catch {
        status = 0;
      }
      try {
        if (status >= 200 && status < 300) {
          result.delivered++;
          await this.store.delivered(device.id);
        } else if (status === 404 || status === 410) {
          result.expired++;
          await this.store.expired(device.id, device.endpoint);
        } else {
          result.failed++;
          await this.store.failed(device.id);
          this.log.warn({ device: device.id, status }, 'Push: delivery failed');
        }
      } catch {
        // Bookkeeping only.
      }
    });
    return result;
  }
}
