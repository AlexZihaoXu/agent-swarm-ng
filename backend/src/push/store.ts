import type { PlatformStore } from '../platform-store';

/** A device stops receiving after this many failed deliveries in a row; subscribing again from it resets the count. */
export const MAX_FAILURES = 5;
/** Devices a person keeps; subscribing one more drops the oldest. */
export const MAX_DEVICES = 20;

export type Preferences = {
  agentMessages: boolean;
  groupChats: boolean;
  agentProblems: boolean;
  critical: boolean;
  preview: boolean;
};
export const DEFAULT_PREFERENCES: Preferences = {
  agentMessages: true,
  groupChats: true,
  agentProblems: true,
  critical: true,
  preview: true,
};

/**
 * Push services browsers subscribe at (Chrome/Edge/Android: FCM; Safari: Apple; Firefox: Mozilla; legacy Edge: WNS).
 * The backend posts to a subscription's endpoint, so only these are accepted: a person cannot make it call anything
 * else (an internal service, the host's network).
 */
const PUSH_SERVICES = [
  /^fcm\.googleapis\.com$/,
  /\.push\.apple\.com$/,
  /\.push\.services\.mozilla\.com$/,
  /\.notify\.windows\.com$/,
];
export function isPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (url.port === '' || url.port === '443') &&
      PUSH_SERVICES.some(pattern => pattern.test(url.hostname))
    );
  } catch {
    return false;
  }
}

/** "Chrome on Android", "Safari on iPhone": a device's name from its browser's user agent (no version numbers). */
export function deviceLabel(userAgent = '') {
  const ua = userAgent;
  const browser = /Edg(?:e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser\//.test(ua)
        ? 'Samsung Internet'
        : /Firefox\/|FxiOS\//.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'Browser';
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /CrOS/.test(ua)
              ? 'ChromeOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : '';
  return device ? `${browser} on ${device}` : browser;
}

export type DeviceView = {
  id: string;
  label: string;
  createdAt: string;
  lastSuccessAt: string | null;
  /** Stopped after repeated failures (subscribing again from the device restarts it). */
  paused: boolean;
};

/** Each person's push devices and notification preferences (docs/notifications.md). */
export class PushStore {
  constructor(private readonly platform: PlatformStore) {}

  private async client() {
    await this.platform.initialize();
    return this.platform.client;
  }

  /**
   * Saves this device's subscription for a person, tied to the browser session that subscribed it. The endpoint
   * identifies the device: subscribing again (or after someone else signed in on it) moves it to this person and
   * session and starts its failure count afresh. A person keeps at most MAX_DEVICES (the oldest go).
   */
  async subscribe(
    userId: string,
    sessionId: string | null,
    input: { endpoint: string; p256dh: string; auth: string; label: string },
  ) {
    const client = await this.client();
    const { endpoint, p256dh, auth, label } = input;
    const update = { userId, sessionId, p256dh, auth, label, failures: 0 };
    let row;
    try {
      row = await client.pushSubscription.upsert({
        where: { endpoint },
        create: { userId, sessionId, endpoint, p256dh, auth, label },
        update,
      });
    } catch (error) {
      // Two saves of one device at once: the other created it, so this one updates it.
      if ((error as { code?: string }).code !== 'P2002') throw error;
      row = await client.pushSubscription.update({ where: { endpoint }, data: update });
    }
    const extra = await client.pushSubscription.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: MAX_DEVICES,
      select: { id: true },
    });
    if (extra.length)
      await client.pushSubscription.deleteMany({
        where: { id: { in: extra.map(item => item.id) }, NOT: { id: row.id } },
      });
    return view(row);
  }

  /**
   * A device's subscription saved again from the browser (they rotate keys): only when this person already has it,
   * so a device removed elsewhere stays removed, and without resetting a pause. Null when it is not theirs.
   */
  async refresh(
    userId: string,
    sessionId: string | null,
    input: { endpoint: string; p256dh: string; auth: string; label: string },
  ) {
    const client = await this.client();
    const { endpoint, p256dh, auth, label } = input;
    const done = await client.pushSubscription.updateMany({
      where: { userId, endpoint },
      data: { sessionId, p256dh, auth, label },
    });
    if (!done.count) return null;
    const row = await client.pushSubscription.findUnique({ where: { endpoint } });
    return row ? view(row) : null;
  }

  async devices(userId: string): Promise<DeviceView[]> {
    const client = await this.client();
    const rows = await client.pushSubscription.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    return rows.map(view);
  }

  /** Removes one of the person's own devices (another person's id answers false, like a missing one). */
  async remove(userId: string, id: string) {
    const client = await this.client();
    return (await client.pushSubscription.deleteMany({ where: { id, userId } })).count > 0;
  }

  /**
   * The devices to deliver to, with their keys (for the sender only): not paused, of a person not disabled, whose
   * session has not expired.
   */
  async targets(userId: string) {
    const client = await this.client();
    return client.pushSubscription.findMany({
      where: {
        userId,
        failures: { lt: MAX_FAILURES },
        user: { disabledAt: null },
        OR: [{ sessionId: null }, { session: { expiresAt: { gt: new Date() } } }],
      },
    });
  }

  async delivered(id: string) {
    const client = await this.client();
    await client.pushSubscription.updateMany({ where: { id }, data: { lastSuccessAt: new Date(), failures: 0 } });
  }

  async failed(id: string) {
    const client = await this.client();
    await client.pushSubscription.updateMany({ where: { id }, data: { failures: { increment: 1 } } });
  }

  /** The push service says the subscription is gone (404/410): the device unsubscribed or was reset. */
  async expired(id: string, endpoint: string) {
    const client = await this.client();
    // The endpoint too: the row may have been saved again with a new subscription meanwhile.
    await client.pushSubscription.deleteMany({ where: { id, endpoint } });
  }

  async preferences(userId: string): Promise<Preferences> {
    const client = await this.client();
    const row = await client.pushPreferences.findUnique({ where: { userId } });
    if (!row) return { ...DEFAULT_PREFERENCES };
    const { userId: _, ...preferences } = row;
    return preferences;
  }

  async setPreferences(userId: string, changes: Partial<Preferences>) {
    const client = await this.client();
    const { userId: _, ...preferences } = await client.pushPreferences.upsert({
      where: { userId },
      create: { userId, ...changes },
      update: changes,
    });
    return preferences;
  }
}

function view(row: {
  id: string;
  label: string;
  createdAt: Date;
  lastSuccessAt: Date | null;
  failures: number;
}): DeviceView {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    paused: row.failures >= MAX_FAILURES,
  };
}
