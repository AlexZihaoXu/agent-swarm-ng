import { test, expect, type Page } from './fixtures';
import { TEST_PASSWORD } from './sign-in.setup';

/**
 * Settings → Account → Notifications against the suite's real backend, with the browser's push side faked in the page
 * (the dev server registers no service worker, and a real subscription would reach Google's push service).
 */
async function fakePush(page: Page, { permission = 'granted' }: { permission?: NotificationPermission } = {}) {
  await page.addInitScript(answer => {
    const calls = { requested: 0, subscribed: [] as number[], unsubscribed: 0 };
    // Kept across reloads, like the browser's own permission and subscription.
    const saved = JSON.parse(sessionStorage.getItem('fake-push') ?? '{}') as {
      state?: NotificationPermission;
      key?: number[];
    };
    const remember = () => sessionStorage.setItem('fake-push', JSON.stringify({ state, key: saved.key }));
    let state: NotificationPermission = saved.state ?? 'default';
    let subscription: object | null = null;
    // A real-looking P-256 public key (65 bytes) and auth secret (16 bytes), base64url.
    const p256dh = `B${'A'.repeat(86)}`;
    const auth = 'AAAAAAAAAAAAAAAAAAAAAA';
    const make = (key: Uint8Array) => ({
      endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-device',
      options: { applicationServerKey: key.buffer },
      toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-device', keys: { p256dh, auth } }),
      unsubscribe: async () => {
        calls.unsubscribed++;
        subscription = null;
        saved.key = undefined;
        remember();
        return true;
      },
    });
    if (saved.key) subscription = make(Uint8Array.from(saved.key));
    const pushManager = {
      getSubscription: async () => subscription,
      subscribe: async ({ applicationServerKey }: { applicationServerKey: Uint8Array }) => {
        calls.subscribed.push(applicationServerKey.length);
        saved.key = [...applicationServerKey];
        remember();
        return (subscription = make(applicationServerKey));
      },
    };
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: {
        get permission() {
          return state;
        },
        requestPermission: async () => {
          calls.requested++;
          state = answer;
          remember();
          return state;
        },
      },
    });
    navigator.serviceWorker.getRegistration = async () => ({ pushManager }) as unknown as ServiceWorkerRegistration;
    Object.assign(window, { pushCalls: calls });
  }, permission);
}
const calls = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { pushCalls: { requested: number; subscribed: number[]; unsubscribed: number } }).pushCalls,
  );

test('turns notifications on for this device, lists it, saves what to be told and sends a test', async ({ page }) => {
  await fakePush(page);
  let tests = 0;
  await page.route('**/api/push/test', route => {
    tests++;
    return route.fulfill({ json: { delivered: 1, failed: 0, expired: 0 } });
  });
  await page.goto('/settings');
  const card = page.getByRole('group', { name: 'Notifications' });
  await expect(card).toBeVisible();
  // All on by default; admin also has critical alerts.
  for (const name of ['Agent messages', 'Group chats', 'Agent problems', 'Critical alerts', 'Show message text'])
    await expect(card.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'true');
  await expect(card.getByRole('button', { name: 'Send test notification' })).toHaveCount(0);

  const turnOn = card.getByRole('button', { name: 'Turn on notifications on this device' });
  await expect(turnOn).toHaveCSS('cursor', 'pointer');
  await turnOn.click();
  await expect(card.getByText('On for this device.')).toBeVisible();
  expect(await calls(page)).toMatchObject({ requested: 1, subscribed: [65] });
  const devices = card.getByRole('list', { name: 'Devices' });
  await expect(devices.getByRole('listitem')).toHaveCount(1);
  await expect(devices).toContainText('Chrome on Linux');
  await expect(devices).toContainText('This device');
  await expect(devices).toContainText('nothing delivered yet');

  await card.getByRole('button', { name: 'Send test notification' }).click();
  await expect(card.getByRole('status')).toHaveText('Sent to 1 device.');
  expect(tests).toBe(1);

  // A preference is saved for the person, not the page.
  await card.getByRole('switch', { name: 'Show message text' }).click();
  await expect(card.getByRole('switch', { name: 'Show message text' })).toHaveAttribute('aria-checked', 'false');
  await page.reload();
  await expect(
    page.getByRole('group', { name: 'Notifications' }).getByRole('switch', { name: 'Show message text' }),
  ).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('group', { name: 'Notifications' }).getByRole('switch', { name: 'Show message text' }).click();
  await expect(
    page.getByRole('group', { name: 'Notifications' }).getByRole('switch', { name: 'Show message text' }),
  ).toHaveAttribute('aria-checked', 'true');

  // After the reload the subscription is saved again and recognised as this device; removing it unsubscribes.
  const again = page.getByRole('group', { name: 'Notifications' });
  await expect(again.getByText('On for this device.')).toBeVisible();
  await again.getByRole('button', { name: 'Remove Chrome on Linux (this device)' }).click();
  await expect(again.getByRole('list', { name: 'Devices' })).toHaveCount(0);
  await expect(again.getByRole('button', { name: 'Turn on notifications on this device' })).toBeVisible();
  expect((await calls(page)).unsubscribed).toBe(1);
});

test('explains a refused permission', async ({ page }) => {
  await fakePush(page, { permission: 'denied' });
  await page.goto('/settings');
  const card = page.getByRole('group', { name: 'Notifications' });
  await card.getByRole('button', { name: 'Turn on notifications on this device' }).click();
  await expect(card.getByRole('status')).toContainText('blocked for this site');
  await expect(card.getByRole('button', { name: 'Turn on notifications on this device' })).toBeDisabled();
  expect((await calls(page)).subscribed).toEqual([]);
});

test.describe('on an iPhone in Safari', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
  });

  test('asks to add the app to the Home Screen first', async ({ page }) => {
    await page.goto('/settings');
    const card = page.getByRole('group', { name: 'Notifications' });
    await expect(card).toContainText('Add to Home Screen');
    await expect(card.getByRole('button', { name: 'Turn on notifications on this device' })).toHaveCount(0);
    // What to be told can still be chosen here (for the Home Screen app).
    await expect(card.getByRole('switch', { name: 'Agent messages' })).toBeVisible();
  });
});

test('draws the avatar PNGs the backend lacks, for notification icons', async ({ page }) => {
  // Drawn as the backend has them saved (null: the default for its id), uploaded with that look.
  await page.route('**/api/push/avatars', route =>
    route.fulfill({
      json: {
        stale: [
          { id: 'morgan', avatar: { shape: 'bean', color: '#38bdf8', seed: 7 }, look: '0123456789abcdef' },
          { id: 'not-loaded', avatar: null, look: 'fedcba9876543210' },
        ],
      },
    }),
  );
  const uploads: { id: string; look: string | null; type: string; body: Buffer }[] = [];
  await page.route(/\/api\/agents\/[^/]+\/avatar\.png\?/, route => {
    const request = route.request();
    uploads.push({
      id: new URL(request.url()).pathname.split('/')[3]!,
      look: new URL(request.url()).searchParams.get('look'),
      type: request.headers()['content-type'] ?? '',
      body: request.postDataBuffer() ?? Buffer.alloc(0),
    });
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/agents/avery');
  await expect.poll(() => uploads.length, { timeout: 10_000 }).toBe(2);
  expect(uploads[0]).toMatchObject({ id: 'morgan', look: '0123456789abcdef', type: 'image/png' });
  expect(uploads[1]).toMatchObject({ id: 'not-loaded', look: 'fedcba9876543210', type: 'image/png' });
  // A 192 px PNG with the avatar drawn in it (not blank).
  const drawn = await page.evaluate(async base64 => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let opaque = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 200) opaque++;
    return { width: image.width, height: image.height, share: opaque / (image.width * image.height) };
  }, uploads[0]!.body.toString('base64'));
  expect(drawn.width).toBe(192);
  expect(drawn.height).toBe(192);
  expect(drawn.share).toBeGreaterThan(0.3);
  expect(drawn.share).toBeLessThan(0.95);
});

test('signing out unsubscribes this browser, and its device goes with the session', async ({ page }) => {
  await fakePush(page);
  // A session of its own: signing out must not end the one the other tests share.
  await page.request.post('/api/auth/login', { data: { name: 'Admin', password: TEST_PASSWORD } });
  await page.goto('/settings');
  const card = page.getByRole('group', { name: 'Notifications' });
  await card.getByRole('button', { name: 'Turn on notifications on this device' }).click();
  await expect(card.getByText('On for this device.')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to Agent Swarm' })).toBeVisible();
  expect((await calls(page)).unsubscribed).toBe(1);
  // The backend dropped the device with the session (this spec's only device).
  await page.request.post('/api/auth/login', { data: { name: 'Admin', password: TEST_PASSWORD } });
  expect((await (await page.request.get('/api/push/subscriptions')).json()).devices).toEqual([]);
});
