import { test, expect } from './fixtures';

const desk = {
  id: 'c20ed85c-52d4-4f92-a8bb-e2bbb7975470',
  name: 'Shared desktop',
  state: 'running',
  createdAt: 0,
  cpuPercent: 0,
  memoryBytes: 0,
  memoryLimitBytes: 4294967296,
  cpuCount: 2,
};

test('sidebars carry no placeholder account row, and the composer has no dead attachment button', async ({ page }) => {
  await page.goto('/agents/avery');
  await expect(page.getByText('Your account')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add attachment' })).toHaveCount(0);
  await page.goto('/chat/agents/avery');
  await expect(page.getByText('Your account')).toHaveCount(0);
});

test('both sidebars label a conversation the same way, and an old conversation is dated instead of looking like today', async ({
  page,
}) => {
  // The Agents list (with its time labels) is a phone screen; wide screens pick agents from a select.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/agents');
  const agentsRow = page.getByRole('button', { name: 'Open settings for Avery' });
  const agentsLabel = (await agentsRow.locator('[data-slot="swap-text"]').first().innerText()).trim();
  expect(agentsLabel).toBe('Jan 1, 2030'); // sample history is not from today
  await page.goto('/chat');
  const chatLabel = (
    await page
      .getByRole('button', { name: 'Open conversation with Avery' })
      .locator('[data-slot="swap-text"]')
      .first()
      .innerText()
  ).trim();
  expect(chatLabel).toBe(agentsLabel);
});

test('creating an agent shows a backend failure with Retry instead of a misleading setup hint', async ({ page }) => {
  let failing = true;
  await page.route('**/api/model-endpoints*', route =>
    failing
      ? route.fulfill({ status: 500, json: { message: 'boom' } })
      : route.fulfill({
          json: [{ id: 'ep-1', name: 'Local server', baseUrl: 'http://127.0.0.1:1/v1', hasApiKey: false }],
        }),
  );
  await page.goto('/agents/new');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('Could not load endpoints.');
  await expect(dialog.getByText('Connect ChatGPT or save an API endpoint')).toHaveCount(0);
  failing = false;
  await dialog.getByRole('button', { name: 'Retry' }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('combobox', { name: 'Endpoint' }).click();
  await expect(page.getByRole('option', { name: 'Local server' })).toBeVisible();
});

test('on a touch keyboard Enter writes a new line and only the Send button sends', async ({ page }) => {
  const posts: unknown[] = [];
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = query =>
      query === '(pointer: coarse)' ? ({ ...original(query), matches: true } as MediaQueryList) : original(query);
  });
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/chat')
      posts.push(request.postDataJSON());
  });
  await page.goto('/chat/agents/avery');
  const box = page.getByLabel('Message Avery');
  await box.fill('first line');
  await box.press('Enter');
  await box.pressSequentially('second line');
  expect(posts).toHaveLength(0);
  await expect(box).toHaveValue('first line\nsecond line');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect((posts[0] as { message: string }).message).toBe('first line\nsecond line');
  await expect(page.locator('[data-message-id]').filter({ hasText: 'second line' })).toBeVisible(); // let the mocked send finish
});

test('with a mouse, Enter still sends and Shift+Enter writes a new line', async ({ page }) => {
  const posts: unknown[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/chat')
      posts.push(request.postDataJSON());
  });
  await page.goto('/chat/agents/avery');
  const box = page.getByLabel('Message Avery');
  await box.fill('one');
  await box.press('Shift+Enter');
  await box.pressSequentially('two');
  await expect(box).toHaveValue('one\ntwo');
  await box.press('Enter');
  await expect.poll(() => posts.length).toBe(1);
  await expect(page.locator('[data-message-id]').filter({ hasText: 'two' })).toBeVisible(); // let the mocked send finish
});

test('the reaction menu says an agent may respond', async ({ page }) => {
  await page.goto('/chat/agents/avery');
  await page.locator('[data-message-id="avery-0"]').click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'Message actions' })).toContainText('An agent may respond to a reaction');
});

test('the Computers page shows the cap and blocks Create at the limit', async ({ page }) => {
  let computers = [desk, { ...desk, id: 'second', name: 'Second' }];
  await page.route(/\/api\/computers(?:\?.*)?$/, route =>
    route.fulfill({ json: { computers, controllerConnected: true } }),
  );
  await page.route('**/api/computers/settings-limits', route =>
    route.fulfill({
      json: {
        cpuCores: { min: 1, max: 8, default: 2 },
        memoryGiB: { min: 1, max: 16, default: 4 },
        timezoneDefault: 'UTC',
        maxComputers: 2,
      },
    }),
  );
  await page.goto('/computers');
  await expect(page.getByTestId('computer-cap')).toHaveText('2 of 2');
  const create = page.getByRole('button', { name: 'Create computer' });
  await expect(create).toBeDisabled();
  await expect(create).toHaveAttribute('title', /Limit reached \(2\)/);
  computers = [desk];
  await page.reload();
  await expect(page.getByTestId('computer-cap')).toHaveText('1 of 2');
  await expect(page.getByRole('button', { name: 'Create computer' })).toBeEnabled();
});

for (const portalFree of [true, false])
  test(`each computer decides whether the screen-share consent step applies (portalFree: ${portalFree})`, async ({
    page,
  }) => {
    await page.route(/\/api\/computers(?:\?.*)?$/, route =>
      route.fulfill({ json: { computers: [{ ...desk, portalFree }], controllerConnected: true } }),
    );
    await page.route('**/api/computers/control', route => route.fulfill({ json: { holders: [] } }));
    await page.route(`**/computers/${desk.id}/desktop/**`, route =>
      route.request().url().endsWith('/api/health')
        ? route.fulfill({ json: { status: 'ok' } })
        : route.fulfill({ contentType: 'text/html', body: '<html><body>Desktop fixture</body></html>' }),
    );
    await page.route('**/api/computers/*/preview*', route =>
      route.fulfill({ contentType: 'image/jpeg', body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }),
    );
    await page.goto(`/computers/${desk.id}`);
    const viewer = page.getByTestId('computer-viewer');
    if (portalFree) {
      await expect(viewer.getByRole('button', { name: /human desktop input/ })).toBeVisible();
      await expect(viewer.getByRole('heading', { name: 'Grant screen access' })).toHaveCount(0);
    } else {
      await expect(viewer.getByRole('heading', { name: 'Grant screen access' })).toBeVisible(); // Wayland: consent first
    }
  });

test('the icon-only input toggle names its state', async ({ page }) => {
  await page.route(/\/api\/computers(?:\?.*)?$/, route =>
    route.fulfill({ json: { computers: [{ ...desk, portalFree: true }], controllerConnected: true } }),
  );
  await page.route('**/api/computers/control', route => route.fulfill({ json: { holders: [] } }));
  await page.route(`**/computers/${desk.id}/desktop/**`, route =>
    route.request().url().endsWith('/api/health')
      ? route.fulfill({ json: { status: 'ok' } })
      : route.fulfill({ contentType: 'text/html', body: '<html><body>Desktop fixture</body></html>' }),
  );
  await page.goto(`/computers/${desk.id}`);
  const toggle = page.getByRole('button', { name: /human desktop input/ });
  await expect(toggle).toHaveAccessibleName(/^Input locked/);
  await expect(toggle).toHaveAttribute('title', 'Input locked: control the desktop');
  await toggle.click();
  await expect(toggle).toHaveAccessibleName(/^Input live/);
});

test('an upright phone turns the contained desktop and keeps it view-only; sideways restores control', async ({
  page,
}) => {
  await page.route(/\/api\/computers(?:\?.*)?$/, route =>
    route.fulfill({ json: { computers: [{ ...desk, portalFree: true }], controllerConnected: true } }),
  );
  await page.route('**/api/computers/control', route => route.fulfill({ json: { holders: [] } }));
  await page.route(`**/computers/${desk.id}/desktop/**`, route =>
    route.request().url().endsWith('/api/health')
      ? route.fulfill({ json: { status: 'ok' } })
      : route.fulfill({ contentType: 'text/html', body: '<html><body>Desktop fixture</body></html>' }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/computers/${desk.id}`);
  const frame = page.locator('iframe[title$="desktop"]');
  const toggle = page.getByRole('button', { name: /human desktop input/ });
  await expect(frame).toHaveAttribute('data-rotated', '');
  await expect(toggle).toBeDisabled();
  await expect(page.getByText('Pan desktop')).toHaveCount(0);
  // Turned, the 16:9 picture runs along the screen's height and stays inside the viewer.
  const box = (await frame.boundingBox())!;
  expect(box.height).toBeGreaterThan(box.width * 1.7);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(391);
  await page.setViewportSize({ width: 740, height: 360 });
  await expect(frame).not.toHaveAttribute('data-rotated');
  await expect(toggle).toBeEnabled();
  const wide = (await frame.boundingBox())!;
  expect(wide.x + wide.width).toBeLessThanOrEqual(741);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('on iPhone Safari the desktop frame is never transformed; a new size reconnects the stream instead', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'userAgent', {
      get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    }),
  );
  await page.route(/\/api\/computers(?:\?.*)?$/, route =>
    route.fulfill({ json: { computers: [{ ...desk, portalFree: true }], controllerConnected: true } }),
  );
  await page.route('**/api/computers/control', route => route.fulfill({ json: { holders: [] } }));
  let loads = 0;
  await page.route(`**/computers/${desk.id}/desktop/**`, route => {
    if (route.request().url().endsWith('/api/health')) return route.fulfill({ json: { status: 'ok' } });
    loads++;
    return route.fulfill({ contentType: 'text/html', body: '<html><body>Desktop fixture</body></html>' });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/computers/${desk.id}`);
  const frame = page.locator('iframe[title$="desktop"]');
  // Upright, the picture is contained but not turned, so input stays available.
  await expect(frame).not.toHaveAttribute('data-rotated');
  await expect(frame).toHaveCSS('transform', 'none');
  await expect(page.getByRole('button', { name: /human desktop input/ })).toBeEnabled();
  await expect.poll(() => loads).toBe(1);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(() => loads).toBe(2);
  await expect(frame).toHaveCSS('transform', 'none');
  const box = (await frame.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(845);
});

test('an unknown page offers an in-app link back', async ({ page }) => {
  await page.goto('/nowhere');
  const loads: string[] = [];
  page.on('load', () => loads.push('reload'));
  await page.getByRole('link', { name: 'Return to agents' }).click();
  await expect(page).toHaveURL(/\/agents/);
  expect(loads).toHaveLength(0); // client-side navigation, not a full reload
});

test('Settings, Computers and Knowledge load on demand and still work', async ({ page }) => {
  const scripts: string[] = [];
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (/\/src\/components\/(settings|computers-panel|knowledge-browser)\.tsx/.test(path)) scripts.push(path);
  });
  await page.goto('/agents/avery');
  await expect(page.getByRole('combobox', { name: 'Agent' })).toContainText('Avery');
  expect(scripts).toEqual([]); // nothing from the other tabs was fetched for the first screen
  const initial = scripts.length;
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'API endpoints' })).toBeVisible();
  await page.getByRole('tab', { name: 'Computers' }).click();
  await expect(page.getByRole('heading', { name: 'Computers', exact: true })).toBeVisible();
  expect(scripts.length).toBeGreaterThan(initial); // extra chunks arrived only after the tabs were opened
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'API endpoints' })).toBeVisible();
});
