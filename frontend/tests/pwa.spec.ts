import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from './fixtures';

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
});
