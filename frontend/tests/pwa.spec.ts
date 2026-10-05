import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from './fixtures';
import { signedInState } from './sign-in.setup';

// The app must be installable before anyone signs in (Chrome/Edge/Android install, iOS Add to Home Screen).
// Full Chromium: the headless shell answers installability checks with no errors even when there is no manifest.
test.use({ storageState: { cookies: [], origins: [] }, channel: 'chromium' });

const frontend = fileURLToPath(new URL('..', import.meta.url));
const icons = [
  { src: '/icon-192.png?v=2', size: 192, purpose: 'any' },
  { src: '/icon-512.png?v=2', size: 512, purpose: 'any' },
  { src: '/icon-maskable-192.png?v=2', size: 192, purpose: 'maskable' },
  { src: '/icon-maskable-512.png?v=2', size: 512, purpose: 'maskable' },
];

/** The natural size of an image as the browser decodes it. */
const imageSize = (page: Page, src: string) =>
  page.evaluate(async url => {
    const image = new Image();
    image.src = url;
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  }, src);

test('the sign-in page links the favicon and home-screen icons', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to Agent Swarm' })).toBeVisible();
  // The splash shows the icon until the gate knows what to show, then dissolves and is removed.
  await expect(page.locator('#splash')).toHaveCount(0);
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/favicon.svg?v=2');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png?v=2');
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Agent Swarm');
  for (const [src, size] of [
    ['/favicon-32.png', 32],
    ['/apple-touch-icon.png', 180],
  ] as const) {
    expect((await page.request.get(src)).status(), src).toBe(200);
    expect(await imageSize(page, src), src).toEqual([size, size]);
  }
  for (const src of ['/favicon.svg', '/icon.svg', '/icon-maskable.svg']) {
    const response = await page.request.get(src);
    expect(response.headers()['content-type'], src).toContain('image/svg+xml');
    const [width, height] = await imageSize(page, src);
    expect(width, src).toBeGreaterThan(0);
    expect(width, src).toBe(height);
  }
});

// The dev server serves no manifest or service worker, so these run against a production build in `vite preview`
// (proxying /api to the suite's backend like Caddy does in production).
test.describe('production build', () => {
  const port = 4317;
  const origin = `http://127.0.0.1:${port}`;
  let preview: ChildProcess | undefined;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    const outDir = '../.scratch/pwa-dist';
    const build = spawnSync('bun', ['x', 'vite', 'build', '--outDir', outDir, '--emptyOutDir'], { cwd: frontend });
    expect(build.status, String(build.stderr)).toBe(0);
    preview = spawn(
      'bun',
      ['x', 'vite', 'preview', '--outDir', outDir, '--host', '127.0.0.1', '--port', `${port}`, '--strictPort'],
      {
        cwd: frontend,
        stdio: 'ignore',
      },
    );
    await expect
      .poll(
        () =>
          fetch(origin).then(
            response => response.status,
            () => 0,
          ),
        { timeout: 30_000 },
      )
      .toBe(200);
  });

  test.afterAll(() => {
    preview?.kill();
  });

  test('the manifest describes an installable app with every icon', async ({ page }) => {
    const response = await page.request.get(`${origin}/manifest.webmanifest`);
    expect(response.status()).toBe(200);
    const manifest = await response.json();
    expect(manifest).toMatchObject({
      id: '/',
      name: 'Agent Swarm NG',
      short_name: 'Agent Swarm',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      theme_color: '#151515',
      background_color: '#242424',
    });
    expect(manifest.description).toBeTruthy();
    for (const icon of icons)
      expect(manifest.icons).toContainEqual({
        src: icon.src,
        sizes: `${icon.size}x${icon.size}`,
        type: 'image/png',
        purpose: icon.purpose,
      });
    expect(manifest.icons).toContainEqual(expect.objectContaining({ src: '/icon.svg?v=2', type: 'image/svg+xml' }));
    await page.goto(`${origin}/`);
    for (const icon of icons) {
      expect((await page.request.get(`${origin}${icon.src}`)).status(), icon.src).toBe(200);
      expect(await imageSize(page, icon.src), icon.src).toEqual([icon.size, icon.size]);
    }
  });

  test('a signed-out visitor gets the service worker and Chromium finds no installability errors', async ({ page }) => {
    await page.goto(`${origin}/`);
    await expect(page.getByRole('heading', { name: 'Sign in to Agent Swarm' })).toBeVisible();
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(scope).toBe(`${origin}/`);
    const cdp = await page.context().newCDPSession(page);
    expect((await cdp.send('Page.getAppManifest')).errors).toEqual([]);
    // Every Playwright context is incognito, which alone blocks installing; nothing else may.
    const blockers = async () =>
      (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors
        .map(error => error.errorId)
        .filter(id => id !== 'in-incognito');
    await expect.poll(blockers, { timeout: 15_000 }).toEqual([]);
    // The worker never answers the API or the desktop viewer with the cached app shell.
    await page.reload();
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    for (const path of ['/api/health', '/computers/00000000-0000-4000-8000-000000000000/desktop/']) {
      const response = await page.goto(`${origin}${path}`);
      expect(response?.fromServiceWorker(), path).toBe(false);
    }
    const shell = await page.goto(`${origin}/settings`);
    expect(shell?.fromServiceWorker()).toBe(true);
    // With the network gone, the precached shell still opens; it says the dashboard is unreachable.
    await page.context().setOffline(true);
    await page.reload();
    await expect(page.getByRole('alert')).toHaveText('Could not reach the dashboard. Reload to try again.');
    await page.context().setOffline(false);
  });

  test('the service worker shows a pushed notification, with the agent’s avatar, and a tap opens its page', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: signedInState });
    try {
      await context.grantPermissions(['notifications'], { origin });
      // The agent's avatar, as the backend would serve it (the suite's backend has no agents).
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      );
      await context.route('**/api/agents/aether/avatar.png', route =>
        route.fulfill({ contentType: 'image/png', body: png }),
      );
      const page = await context.newPage();
      await page.goto(`${origin}/dashboard`);
      await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state);
      const cdp = await context.newCDPSession(page);
      const registrationId = new Promise<string>(resolve =>
        cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
          const found = registrations.find(item => item.scopeURL === `${origin}/` && !item.isDeleted);
          if (found) resolve(found.registrationId);
        }),
      );
      await cdp.send('ServiceWorker.enable');
      const push = async (data: object) =>
        cdp.send('ServiceWorker.deliverPushMessage', {
          origin,
          registrationId: await registrationId,
          data: JSON.stringify(data),
        });
      const shown = () =>
        page.evaluate(async () =>
          (await (await navigator.serviceWorker.ready).getNotifications()).map(item => ({
            title: item.title,
            body: item.body,
            tag: item.tag,
            icon: item.icon.startsWith('data:image/png;base64,') ? 'avatar' : item.icon,
            badge: item.badge,
            url: (item.data as { url: string }).url,
          })),
        );
      await push({
        title: 'Aether',
        body: 'The report is ready.',
        tag: 'agent:aether',
        url: '/chat/agents/aether',
        icon: '/api/agents/aether/avatar.png',
        timestamp: Date.now(),
        renotify: true,
      });
      await expect.poll(shown, { timeout: 10_000 }).toEqual([
        {
          title: 'Aether',
          body: 'The report is ready.',
          tag: 'agent:aether',
          icon: 'avatar',
          badge: `${origin}/badge-96.png?v=1`,
          url: `${origin}/chat/agents/aether`,
        },
      ]);
      // System notifications (and agents without an avatar image yet) use the app icon; a burst replaces by tag;
      // a link elsewhere is kept on the dashboard.
      await push({ title: 'Aether · 2 new messages', body: 'Second', tag: 'agent:aether', url: '/chat/agents/aether' });
      await push({ title: 'Sign-in is locked down', body: '…', tag: 'alert:lockdown', url: 'https://evil.example/' });
      await push({
        title: 'Bo',
        body: 'Hi',
        tag: 'agent:bo',
        url: '/chat/agents/bo',
        icon: '/api/agents/bo/avatar.png',
      });
      await expect
        .poll(async () => (await shown()).map(item => [item.title, item.icon, item.url]).sort(), { timeout: 10_000 })
        .toEqual([
          ['Aether · 2 new messages', `${origin}/icon-192.png?v=2`, `${origin}/chat/agents/aether`],
          ['Bo', `${origin}/icon-192.png?v=2`, `${origin}/chat/agents/bo`],
          ['Sign-in is locked down', `${origin}/icon-192.png?v=2`, `${origin}/`],
        ]);
      // A tap: the open app goes to the notification's page without reloading.
      await page.evaluate(() => Object.assign(window, { notReloaded: true }));
      const worker = context.serviceWorkers().find(item => item.url().startsWith(origin))!;
      await worker.evaluate(() =>
        (self as unknown as { openApp: (path: string) => Promise<unknown> }).openApp('/settings'),
      );
      await expect(page).toHaveURL(`${origin}/settings`);
      await expect(page.getByRole('heading', { name: 'Settings', level: 2 })).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { notReloaded?: boolean }).notReloaded)).toBe(true);
    } finally {
      await context.close();
    }
  });
});
