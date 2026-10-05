import { test, expect, type Page } from './fixtures';

// An 800×600 picture (served for every image in these tests): big enough to tap at a point.
const picture = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#2563eb"/><circle cx="280" cy="210" r="30" fill="#fff"/></svg>`;
const file = (id: string, name: string, kind: 'image' | 'text' | 'scratch', extra: object = {}) => ({
  id,
  channelKey: 'chat:avery',
  name,
  mime: kind === 'image' ? 'image/png' : 'text/plain',
  kind,
  size: 2048,
  status: 'available',
  uploader: { kind: 'agent', id: 'avery', name: 'Avery' },
  messageKind: 'chat',
  messageId: 'm',
  createdAt: '2026-10-05T12:00:00.000Z',
  ...extra,
});
const images = ['a.png', 'b.png', 'c.png'].map(name => file(`f-${name}`, name, 'image'));

async function showFiles(page: Page, files: object[]) {
  await page.route(/\/api\/files\/f-[^/]+\/content(\?.*)?$/, route =>
    route.fulfill({ body: picture, contentType: 'image/svg+xml' }),
  );
  await page.route(/\/api\/files\/[^/]+\/text(\?.*)?$/, route =>
    route.fulfill({
      json: {
        text: '<p>page</p>\n',
        offset: 1,
        lines: 1,
        totalLines: 1,
        truncated: false,
        partialLine: false,
        nextOffset: null,
        prevOffset: null,
        previewLimited: false,
      },
    }),
  );
  await page.route('**/api/channels/avery/messages*', route =>
    route.fulfill({
      json: {
        messages: [
          {
            id: 'm',
            channelId: 'avery',
            sequence: 1,
            role: 'assistant',
            text: 'Here they are.',
            timestamp: Date.now(),
            replyTo: null,
            files,
          },
        ],
        nextCursor: null,
      },
    }),
  );
  await page.goto('/chat/agents/avery');
}

/** Where the image's point at (fx, fy) — fractions of its width and height — is on the screen. */
const pointOf = (page: Page, fx: number, fy: number) =>
  page
    .getByRole('dialog')
    .getByRole('img')
    .evaluate(
      (element, [fx, fy]) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width * fx, y: rect.top + rect.height * fy, width: rect.width };
      },
      [fx, fy],
    );
const settled = async (page: Page) => {
  // The zoom eases for 200ms; wait until two reads agree.
  let previous = '';
  await expect
    .poll(async () => {
      const now = JSON.stringify(await pointOf(page, 0, 0));
      const same = now === previous;
      previous = now;
      return same;
    })
    .toBe(true);
};

test('an image opens in a viewer: tap zooms on that point, drag and scroll pan, tap zooms out, arrows page', async ({
  page,
}) => {
  await showFiles(page, images);
  await page.getByRole('button', { name: 'View b.png' }).click();
  const viewer = page.getByRole('dialog', { name: 'b.png' });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByLabel('Image 2 of 3')).toHaveText('2 / 3');
  const image = viewer.getByRole('img', { name: 'b.png' });
  await expect(image).toHaveJSProperty('complete', true);
  await expect(image).toHaveCSS('cursor', 'zoom-in');
  await settled(page); // The dialog's opening scale.
  // Nothing opened in a new tab.
  expect(page.context().pages()).toHaveLength(1);

  // A tap zooms 2.5× and brings the tapped point to the middle of the screen.
  const viewport = page.viewportSize()!;
  const before = await pointOf(page, 0.35, 0.35);
  await page.mouse.click(before.x, before.y);
  await settled(page);
  const zoomed = await pointOf(page, 0.35, 0.35);
  expect(zoomed.width / before.width).toBeCloseTo(2.5, 1);
  expect(Math.abs(zoomed.x - viewport.width / 2)).toBeLessThan(3);
  expect(Math.abs(zoomed.y - viewport.height / 2)).toBeLessThan(3);
  await expect(image).toHaveCSS('cursor', 'zoom-out');

  // Dragging pans (and is not a tap: it stays zoomed).
  await page.mouse.move(640, 360);
  await page.mouse.down();
  for (let step = 1; step <= 5; step++) await page.mouse.move(640 - step * 20, 360 - step * 10);
  await page.mouse.up();
  const panned = await pointOf(page, 0.35, 0.35);
  expect(panned.x - zoomed.x).toBeCloseTo(-100, 0);
  expect(panned.y - zoomed.y).toBeCloseTo(-50, 0);
  await expect(viewer).toBeVisible();
  // So does the scroll wheel.
  await page.mouse.wheel(0, 40);
  await expect.poll(async () => Math.round((await pointOf(page, 0.35, 0.35)).y - panned.y)).toBe(-40);

  // Another tap zooms back out.
  await page.mouse.click(640, 360);
  await settled(page);
  expect((await pointOf(page, 0.35, 0.35)).width).toBeCloseTo(before.width, 0);
  await expect(image).toHaveCSS('cursor', 'zoom-in');

  // The arrows and ←/→ page through the message's images, wrapping around.
  await viewer.getByRole('button', { name: 'Next image' }).click();
  await expect(page.getByRole('dialog', { name: 'c.png' }).getByLabel('Image 3 of 3')).toHaveText('3 / 3');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog', { name: 'a.png' })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('dialog', { name: 'c.png' })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Download c.png' })).toHaveAttribute(
    'href',
    '/api/files/f-c.png/content?download=1',
  );

  // The × closes it, and focus returns to the thumbnail of the image last shown.
  await page.getByRole('button', { name: 'Close image viewer' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View c.png' })).toBeFocused();

  // A tap beside the image closes it.
  await page.getByRole('button', { name: 'View a.png' }).click();
  await expect(page.getByRole('dialog', { name: 'a.png' }).getByRole('img')).toHaveJSProperty('complete', true);
  await page.mouse.click(20, viewport.height - 20);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // So does Escape, also while zoomed.
  await page.getByRole('button', { name: 'View a.png' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Zoom out' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View a.png' })).toBeFocused();
});

test.describe('image viewer on a phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('fills the screen with 44px controls; tap zooms, swipe pages only unzoomed', async ({ page }) => {
    await showFiles(page, images);
    await page.getByRole('button', { name: 'View a.png' }).tap();
    const viewer = page.getByRole('dialog', { name: 'a.png' });
    await expect(viewer.getByRole('img')).toHaveJSProperty('complete', true);
    await expect.poll(() => viewer.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    for (const name of ['Close image viewer', 'Next image', 'Previous image', 'Zoom in', 'Download a.png']) {
      const box = (await viewer.getByRole(name.startsWith('Download') ? 'link' : 'button', { name }).boundingBox())!;
      expect(Math.min(box.width, box.height), name).toBeGreaterThanOrEqual(44);
    }

    const swipe = async (fromX: number, toX: number, y: number) => {
      const client = await page.context().newCDPSession(page);
      try {
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y, id: 1 }] });
        for (let step = 1; step <= 6; step++)
          await client.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: fromX + ((toX - fromX) * step) / 6, y, id: 1 }],
          });
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } finally {
        await client.detach();
      }
    };
    // Swipe left: the next image.
    await swipe(300, 120, 420);
    await expect(page.getByRole('dialog', { name: 'b.png' })).toBeVisible();

    // A tap zooms; a swipe then pans instead of paging; another tap zooms out.
    await settled(page);
    const fitted = await pointOf(page, 0.5, 0.5);
    await page.touchscreen.tap(fitted.x, fitted.y);
    await settled(page);
    expect((await pointOf(page, 0.5, 0.5)).width / fitted.width).toBeCloseTo(2.5, 1);
    await swipe(300, 200, 420);
    await expect(page.getByRole('dialog', { name: 'b.png' })).toBeVisible();
    await page.touchscreen.tap(195, 420);
    await settled(page);
    expect((await pointOf(page, 0.5, 0.5)).width).toBeCloseTo(fitted.width, 0);

    // A tap outside the image closes the viewer.
    await page.touchscreen.tap(195, 800);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test('reduced motion: the zoom applies at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await showFiles(page, images.slice(0, 1));
  await page.getByRole('button', { name: 'View a.png' }).click();
  const image = page.getByRole('dialog').getByRole('img');
  await expect(image).toHaveJSProperty('complete', true);
  // One image: no arrows or counter.
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Next image' })).toHaveCount(0);
  await expect(image).toHaveCSS('transition-duration', '0s');
  await page.getByRole('dialog').getByRole('button', { name: 'Zoom in' }).click();
  await expect(image).toHaveCSS('transform', /matrix\(2\.5, 0, 0, 2\.5/);
});

// Tries everything a hostile page would: read the dashboard, its cookies and API, and navigate it.
const probe = `<!doctype html><title>Probe</title>
<p id="ran">no</p><p id="origin"></p><p id="cookie"></p><p id="parent"></p><p id="top"></p><p id="fetch">pending</p>
<script>
const say = (id, text) => (document.getElementById(id).textContent = text);
say('ran', 'yes');
say('origin', String(window.origin));
try { say('cookie', 'read:' + document.cookie); } catch { say('cookie', 'blocked'); }
try { say('parent', 'read:' + parent.document.title); } catch { say('parent', 'blocked'); }
if (window !== top) try { top.location.href = '/escaped'; say('top', 'tried'); } catch { say('top', 'blocked'); }
fetch('/api/agents', { credentials: 'include' }).then(
  response => say('fetch', 'read:' + response.status),
  () => say('fetch', 'blocked'),
);
</script>`;

test('an HTML file renders in a sandbox: its script runs, but it cannot reach the dashboard, the API or the top window', async ({
  page,
}) => {
  // A real file through the real backend (only the message listing is mocked).
  const endpoint = await page.request.post('/api/model-endpoints', {
    data: { id: 'viewer-test', name: 'Viewer test', baseUrl: 'http://localhost:1234/v1', apiKey: 'unused' },
  });
  expect(endpoint.ok(), await endpoint.text()).toBe(true);
  const created = await page.request.post('/api/agents', {
    data: { name: `Pager ${Date.now()}`, endpointId: 'viewer-test', model: 'm', thinkingLevel: 'off' },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const channelKey = `chat:${(await created.json()).channelId}`;
  const uploaded = await page.request.post(`/api/files?channelKey=${encodeURIComponent(channelKey)}&name=probe.html`, {
    headers: { 'content-type': 'application/octet-stream' },
    data: Buffer.from(probe),
  });
  expect(uploaded.status()).toBe(201);
  const html = await uploaded.json();
  expect(html).toMatchObject({ kind: 'text', mime: 'text/html' });

  const apiCalls: string[] = [];
  page.on('request', request => {
    try {
      if (request.frame() !== page.mainFrame()) apiCalls.push(new URL(request.url()).pathname);
    } catch {
      // A service worker's request has no frame.
    }
  });
  await showFiles(page, [html, file('f-notes', 'notes.txt', 'text'), file('f-live', 'index.html', 'scratch')]);
  // Only HTML (also a live scratch preview of it) offers View.
  await expect(page.getByRole('button', { name: 'View notes.txt' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View index.html' })).toBeVisible();

  await page.getByRole('button', { name: 'View probe.html' }).click();
  const viewer = page.getByRole('dialog', { name: 'probe.html' });
  await expect(viewer.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  const frame = page.frameLocator('iframe[title="probe.html"]');
  await expect(frame.locator('#ran')).toHaveText('yes');
  await expect(frame.locator('#origin')).toHaveText('null');
  await expect(frame.locator('#cookie')).toHaveText('blocked');
  await expect(frame.locator('#parent')).toHaveText('blocked');
  await expect(frame.locator('#fetch')).toHaveText('blocked');
  await expect(frame.locator('#top')).not.toBeEmpty();
  await page.waitForTimeout(300);
  expect(new URL(page.url()).pathname).toBe('/chat/agents/avery');
  // The frame loaded its page and nothing else.
  expect(apiCalls).toEqual([`/api/files/${html.id}/view`]);

  await viewer.getByRole('button', { name: 'Close page viewer' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View probe.html' })).toBeFocused();

  // A page that navigates itself (no browser rule stops that) is closed, never left showing something else.
  const leaving = await page.request.post(`/api/files?channelKey=${encodeURIComponent(channelKey)}&name=leave.html`, {
    headers: { 'content-type': 'application/octet-stream' },
    data: Buffer.from(
      '<!doctype html><p>here</p><script>setTimeout(() => { location.href = "/api/health"; }, 150)</script>',
    ),
  });
  expect(leaving.status()).toBe(201);
  await showFiles(page, [await leaving.json()]);
  await page.getByRole('button', { name: 'View leave.html' }).click();
  const left = page.getByRole('dialog', { name: 'leave.html' });
  await expect(left.getByRole('status')).toContainText('tried to open another address');
  await expect(left.locator('iframe')).toHaveCount(0);
  await left.getByRole('button', { name: 'Close page viewer' }).click();

  // Opened as a page (a link to it), the view route refuses: an agent's page never shows under the dashboard's address.
  const direct = await page.goto(`/api/files/${html.id}/view`);
  expect(direct?.status()).toBe(400);
});
