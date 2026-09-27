import { test, expect, type Page } from './fixtures';

type Computer = { id: string; name: string; state: string; createdAt: number; cpuPercent: number | null; memoryBytes: number | null; memoryLimitBytes?: number | null; cpuCount?: number | null; cpuCores?: number | null; memoryGiB?: number | null; timezone?: string | null };
async function expectCentered(page: Page, dialog: ReturnType<Page['getByRole']>) {
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport).toBeTruthy();
  expect(Math.abs(box!.x + box!.width / 2 - viewport!.width / 2)).toBeLessThan(3);
  expect(Math.abs(box!.y + box!.height / 2 - viewport!.height / 2)).toBeLessThan(3);
}
async function mockComputers(page: Page, initial: Computer[] = []) {
  const computers = [...initial];
  const createdSettings: Array<{ cpuCores?: number; memoryGiB?: number; timezone?: string }> = [];
  let previews = 0;
  await page.route(/\/api\/computers(?:\?.*)?$/, route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { computers, controllerConnected: true } });
    if (route.request().method() !== 'POST') return route.fulfill({ status: 405 });
    const { name, cpuCores, memoryGiB, timezone } = route.request().postDataJSON();
    createdSettings.push({ cpuCores, memoryGiB, timezone });
    const row: Computer = { id: crypto.randomUUID(), name, state: 'running', createdAt: Date.now(), cpuPercent: 1.5, memoryBytes: 209715200, memoryLimitBytes: memoryGiB * 1024 ** 3, cpuCount: cpuCores, cpuCores, memoryGiB, timezone };
    computers.push(row);
    return route.fulfill({ status: 201, json: row });
  });
  await page.route('**/api/computers/**', route => {
    const path = new URL(route.request().url()).pathname.split('/');
    const id = path[3];
    if (id === 'control') return route.fulfill({ json: { holders: [] } });
    if (id === 'settings-limits') return route.fulfill({ json: { cpuCores: { min: 1, max: 8, default: 4 }, memoryGiB: { min: 1, max: 16, default: 4 }, timezoneDefault: 'America/Toronto' } });
    if (path[4] === 'preview') { previews++; return route.fulfill({ status: 503, json: { message: 'Preview warming up.' } }); }
    if (path[4] === 'settings' && path[5] === 'replacement' && route.request().method() === 'POST') {
      const row = computers.find(item => item.id === id);
      if (!row) return route.fulfill({ status: 404 });
      const { cpuCores, memoryGiB, timezone, confirmReplacement } = route.request().postDataJSON();
      if (!confirmReplacement || row.state !== 'exited') return route.fulfill({ status: 409 });
      Object.assign(row, { cpuCores, memoryGiB, timezone, memoryLimitBytes: memoryGiB * 1024 ** 3, cpuCount: cpuCores });
      return route.fulfill({ json: row });
    }
    if (path[4] === 'settings' && route.request().method() === 'PATCH') {
      const row = computers.find(item => item.id === id);
      if (!row) return route.fulfill({ status: 404 });
      const { cpuCores, memoryGiB, timezone } = route.request().postDataJSON();
      if (timezone !== row.timezone) return route.fulfill({ status: 409, json: { message: 'Changing timezone requires container replacement and a desktop restart.' } });
      Object.assign(row, { cpuCores, memoryGiB, memoryLimitBytes: memoryGiB * 1024 ** 3, cpuCount: cpuCores });
      return route.fulfill({ json: row });
    }
    if (route.request().method() !== 'DELETE') return route.fulfill({ status: 405 });
    const index = computers.findIndex(item => item.id === id);
    if (index === -1) return route.fulfill({ status: 404, json: { message: 'Not found.' } });
    if (route.request().postDataJSON().confirmation !== computers[index].name) return route.fulfill({ status: 400, json: { message: 'Type the name exactly.' } });
    computers.splice(index, 1);
    return route.fulfill({ json: { deleted: true } });
  });
  return { computers, previewCount: () => previews, createdSettings };
}

test('Computers shows a responsive screenshot-first grid with name and CPU/memory below', async ({ page }) => {
  const { previewCount } = await mockComputers(page, [
    { id: 'alpha', name: 'Research', state: 'running', createdAt: 0, cpuPercent: 12.5, memoryBytes: 268435456, memoryLimitBytes: 4294967296, cpuCount: 4 },
    { id: 'beta', name: 'Offline', state: 'exited', createdAt: 0, cpuPercent: null, memoryBytes: null, memoryLimitBytes: null, cpuCount: null },
  ]);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Computers' }).click();
  await expect(page.getByRole('heading', { name: 'Computers' })).toBeVisible();
  const card = page.getByRole('article', { name: 'Research' });
  await expect(card.getByTestId('computer-preview')).toBeVisible();
  // Circular dials: CPU at the left, memory starting at the card's centre.
  const dials = card.getByTestId('usage-dial');
  await expect(dials).toHaveCount(2);
  await expect(dials.nth(0)).toContainText('CPU');
  await expect(dials.nth(0)).toContainText('12.5%');
  await expect(dials.nth(1)).toContainText('Memory');
  await expect(dials.nth(1)).toContainText('256 MB');
  await expect(dials.nth(1)).toContainText('of 4096 MB');
  await expect(page.getByRole('article', { name: 'Offline' })).toContainText('Stopped');
  await expect.poll(previewCount).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../.scratch/computers-grid-phone.png', animations: 'disabled' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: '../.scratch/computers-grid-desktop.png', animations: 'disabled' });
  await page.getByRole('tab', { name: 'Agents' }).click();
  const before = previewCount();
  await page.waitForTimeout(2200);
  expect(previewCount()).toBe(before);
});

test('280px phone keeps the grid, tabs and dialogs reachable without reduced-motion animation', async ({ page }) => {
  await mockComputers(page, [{ id: 'narrow', name: 'Very long computer name that must be bounded', state: 'running', createdAt: 0, cpuPercent: 0, memoryBytes: 0 }]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 280, height: 640 });
  await page.goto('/');
  const tab = page.getByRole('tab', { name: 'Computers' });
  await expect(tab).toBeVisible();
  await tab.click();
  const card = page.getByRole('article', { name: 'Very long computer name that must be bounded' });
  await expect(card).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../.scratch/computers-grid-280.png', animations: 'disabled' });
  await expect(page.getByRole('region', { name: 'Computers' })).toHaveCSS('animation-name', 'none');
  await page.getByRole('button', { name: 'Create computer' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create computer' });
  await expect(dialog.getByLabel('Computer name')).toBeVisible();
  await expectCentered(page, dialog);
  await expect(dialog).toHaveCSS('animation-name', 'none');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await card.getByRole('button', { name: /Actions for Very long/ }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: /Remove/ }).click();
  await expect(page.getByRole('dialog', { name: 'Delete computer' }).getByLabel('Confirm computer name')).toBeVisible();
  await expectCentered(page, page.getByRole('dialog', { name: 'Delete computer' }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('opens a computer on the dashboard port, lets a person click its consent preview, then returns to the grid', async ({ page }) => {
  const id = '83b9e248-6bf5-427a-bd85-9799b1b89eb5';
  const { computers } = await mockComputers(page, [{ id, name: 'Work desk', state: 'running', createdAt: 0, cpuPercent: 3, memoryBytes: 104857600 }]);
  const clicks: Array<{ x: number; y: number }> = [];
  await page.route(new RegExp(`/api/computers/${id}/preview\\?full=1`), route => route.fulfill({
    status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#523348"/></svg>',
  }));
  await page.route(`**/api/computers/${id}/desktop/input`, route => {
    clicks.push(route.request().postDataJSON());
    return route.fulfill({ status: 202, json: { accepted: true } });
  });
  await page.route(url => new URL(url).pathname.startsWith(`/computers/${id}/desktop/`), route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Selkies</title><video></video>' }));
  await page.goto('/');
  const tabs = page.getByRole('tablist', { name: 'Main navigation' });
  await page.getByRole('tab', { name: 'Computers' }).click();
  await expect(tabs).toBeVisible();
  await page.getByRole('article', { name: 'Work desk' }).getByRole('button', { name: 'Open Work desk desktop' }).click();
  await expect(tabs).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Computer location' })).toContainText('Work desk');
  await expect(page.locator('iframe[title="Work desk desktop"]')).toHaveAttribute('src', `/computers/${id}/desktop/`);
  const preview = page.getByRole('button', { name: /Click the permission dialog/ });
  await expect(preview).toBeVisible();
  await expect(preview).toBeDisabled();
  await page.getByRole('button', { name: 'Enable human desktop input' }).click();
  await expect(page.getByTestId('computer-keyboard-target')).toHaveCount(0);
  const previewImage = preview.locator('img');
  await previewImage.evaluate(image => {
    (window as Window & { previewDragStarts?: number }).previewDragStarts = 0;
    image.addEventListener('dragstart', () => {
      const state = window as Window & { previewDragStarts?: number };
      state.previewDragStarts = (state.previewDragStarts ?? 0) + 1;
    });
  });
  const imageBox = await previewImage.boundingBox();
  expect(imageBox).toBeTruthy();
  await page.mouse.move(imageBox!.x + imageBox!.width * .4, imageBox!.y + imageBox!.height * .4);
  await page.mouse.down();
  await page.mouse.move(imageBox!.x + imageBox!.width * .6, imageBox!.y + imageBox!.height * .6, { steps: 12 });
  await page.mouse.up();
  expect(await page.evaluate(() => (window as Window & { previewDragStarts?: number }).previewDragStarts)).toBe(0);
  expect(clicks).toHaveLength(0);
  await expect(page.getByText('Permission preview: clicks only.')).toBeVisible();
  await preview.click({ position: { x: 200, y: 100 } });
  await expect.poll(() => clicks.length).toBe(1);
  expect(clicks[0].x).toBeGreaterThan(0);
  expect(clicks[0].x).toBeLessThan(1);
  expect(clicks[0].y).toBeGreaterThan(0);
  expect(clicks[0].y).toBeLessThan(1);
  await expect(preview).toBeEnabled();
  await preview.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('computer-keyboard-target')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect.poll(() => clicks.length).toBe(2);
  await page.screenshot({ path: '../.scratch/computers-viewer-consent-desktop.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Show live desktop' }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Grant screen access' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to computers' }).click();
  await expect(tabs).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Computers' })).toBeFocused();
  await expect(page.getByRole('article', { name: 'Work desk' })).toBeVisible();
  await expect(page.locator('iframe[title="Work desk desktop"]')).toHaveCount(0);
  expect(computers).toHaveLength(1);
});

test('280px computer viewer keeps consent controls reachable with reduced motion', async ({ page }) => {
  const id = '4e99510e-dd0a-4751-bda3-c4679715a0ee';
  await mockComputers(page, [{ id, name: 'Phone desk', state: 'running', createdAt: 0, cpuPercent: 2, memoryBytes: 104857600 }]);
  await page.route(new RegExp(`/api/computers/${id}/preview\\?full=1`), route => route.fulfill({
    status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#523348"/></svg>',
  }));
  await page.route(url => new URL(url).pathname.startsWith(`/computers/${id}/desktop/`), route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Selkies</title><video></video>' }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 280, height: 640 });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Computers' }).click();
  await page.getByRole('button', { name: 'Open Phone desk desktop' }).click();
  await expect(page.getByRole('button', { name: 'Back to computers' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Click the permission dialog/ })).toBeVisible();
  await expect(page.getByText('Permission preview: clicks only.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Click the permission dialog/ }).locator('img')).toHaveAttribute('draggable', 'false');
  await expect(page.getByRole('tablist', { name: 'Main navigation' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Computer location' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByTestId('computer-viewer')).toHaveCSS('animation-name', 'none');
  await page.screenshot({ path: '../.scratch/computers-viewer-consent-phone.png', animations: 'disabled' });
});

test('320px viewer with a long name keeps the back control clear of its action buttons', async ({ page }) => {
  const id = 'b0ab6a5e-1a1b-4a12-9d5f-0f3a5b6c7d8e';
  const name = 'E2E desktop 1790379814000';
  await mockComputers(page, [{ id, name, state: 'running', createdAt: 0, cpuPercent: 2, memoryBytes: 104857600 }]);
  await page.route(new RegExp(`/api/computers/${id}/preview\\?full=1`), route => route.fulfill({
    status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#523348"/></svg>',
  }));
  await page.route(url => new URL(url).pathname.startsWith(`/computers/${id}/desktop/`), route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Selkies</title><video></video>' }));
  // Consent already granted, so the header renders its live action buttons.
  await page.addInitScript(key => localStorage.setItem(key, 'yes'), `computer-consent:${id}`);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Computers' }).click();
  await page.getByRole('button', { name: `Open ${name} desktop` }).click();
  const back = page.getByRole('button', { name: 'Back to computers' });
  await expect(back).toBeVisible();
  const box = await back.boundingBox();
  // Every header action must clear the back control, whatever the viewer state renders.
  let checked = 0;
  for (const action of await page.getByTestId('computer-viewer').locator('header button').all()) {
    if (await action.getAttribute('aria-label') === 'Back to computers') continue;
    await expect(action).toBeVisible();
    const rect = await action.boundingBox();
    const clear = Boolean(box && rect && (rect.x >= box.x + box.width || box.x >= rect.x + rect.width || rect.y >= box.y + box.height || box.y >= rect.y + rect.height));
    expect(clear, `a header action overlaps the back control: ${JSON.stringify({ box, rect })}`).toBe(true);
    checked += 1;
  }
  expect(checked).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../.scratch/computers-viewer-phone-header.png', animations: 'disabled' });
  await back.click();
  await expect(page.getByRole('button', { name: `Open ${name} desktop` })).toBeVisible();
});

test('resizing the window re-fits the desktop without a reload', async ({ page }) => {
  // The guest resolution is operator-locked, so only the display may change.
  // The iframe box must always be the exact contain fit of its container at
  // 16:9, never a stretched or stale size.
  const id = '2f0bd2e2-2f1b-4a55-9b1d-6c2f6b9a1c77';
  await mockComputers(page, [{ id, name: 'Resizable desk', state: 'running', createdAt: 0, cpuPercent: 2, memoryBytes: 104857600 }]);
  await page.route(new RegExp(`/api/computers/${id}/preview\\?full=1`), route => route.fulfill({
    status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#523348"/></svg>',
  }));
  await page.route(url => new URL(url).pathname.startsWith(`/computers/${id}/desktop/`), route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Selkies</title><video></video>' }));
  await page.addInitScript(key => localStorage.setItem(key, 'yes'), `computer-consent:${id}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Computers' }).click();
  await page.getByRole('button', { name: 'Open Resizable desk desktop' }).click();
  const stream = page.getByTestId('computer-viewer').locator('iframe[title="Resizable desk desktop"]');
  await expect(stream).toBeVisible();
  const measure = () => page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="computer-viewer"] .overflow-x-auto');
    const frame = document.querySelector('iframe[title="Resizable desk desktop"]');
    if (!scroller || !frame) throw Error('viewer stream elements missing');
    const box = frame.getBoundingClientRect();
    return { container: [scroller.clientWidth, scroller.clientHeight], iframe: [Math.round(box.width), Math.round(box.height)] };
  });
  const seen: number[][] = [];
  for (const [width, height] of [[1440, 900], [1100, 900], [1100, 500], [900, 700], [768, 900]] as const) {
    await page.setViewportSize({ width, height });
    // The container ResizeObserver feeds React state, so the re-fit lands a
    // frame or two after the viewport change rather than synchronously.
    let last = await measure();
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const container = last.container[0] * 16 / 9;
      const wanted = Math.round(Math.min(last.container[1], container));
      if (Math.abs(last.iframe[1] - wanted) <= 1) break;
      await page.waitForTimeout(120);
      last = await measure();
    }
    const [cw, ch] = last.container, [fw, fh] = last.iframe;
    // Exact contain fit: fill whichever dimension binds, keep 16:9, never overflow.
    const expectedHeight = Math.round(Math.min(ch, cw * 9 / 16));
    expect(fh, `${width}x${height}: height ${fh} in container ${cw}x${ch}`).toBeCloseTo(expectedHeight, 0);
    expect(fw / fh, `${width}x${height}: aspect at ${cw}x${ch}`).toBeCloseTo(16 / 9, 1);
    expect(fw).toBeLessThanOrEqual(cw);
    expect(fh).toBeLessThanOrEqual(ch);
    seen.push([fw, fh]);
  }
  // Genuine re-layout: the smallest and largest viewports must differ.
  expect(new Set(seen.map(box => box.join('x'))).size).toBeGreaterThan(3);
});

test('computer card offers a shared context menu and power control', async ({ page }) => {
  const id = '9c1f2a6e-3b4d-4c8a-9e11-2d5f7a9b0c13';
  // CPU is summed across cores by Docker (257.8% of 4 cores = 64% of capacity),
  // so the dial fraction must divide by the container's own CPU count.
  const { computers } = await mockComputers(page, [{ id, name: 'Menu desk', state: 'running', createdAt: 0, cpuPercent: 257.8, memoryBytes: 1908874320, memoryLimitBytes: 4294967296, cpuCount: 4, cpuCores: 4, memoryGiB: 4, timezone: 'America/Toronto' } as unknown as Computer]);
  await page.route(new RegExp(`/api/computers/${id}/preview\\?full=1`), route => route.fulfill({
    status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#523348"/></svg>',
  }));
  await page.route(/\/api\/computers\/(?:[^/]+)\/power$/, route => {
    const body = route.request().postDataJSON();
    const row = computers.find(item => item.id === id)!;
    row.state = body.action === 'stop' ? 'exited' : 'running';
    row.cpuPercent = body.action === 'stop' ? null : 11.1;
    row.memoryBytes = body.action === 'stop' ? null : 1908874320;
    row.memoryLimitBytes = body.action === 'stop' ? null : 4294967296;
    return route.fulfill({ status: 202, json: { accepted: true, action: body.action, desiredState: body.action === 'stop' ? 'stopped' : 'running' } });
  });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Computers' }).click();
  const card = page.getByRole('article', { name: 'Menu desk' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: /^(Start|Stop)$/ })).toHaveCount(0);

  // Dials first: while a menu is open Radix aria-hides the rest of the app.
  const dials = card.getByTestId('usage-dial');
  await expect(dials).toHaveCount(2);
  await expect(dials.nth(0)).toContainText('257.8%');
  const cpuRatio = await dials.nth(0).evaluate(node => {
    const arc = node.querySelectorAll('circle')[1];
    const dash = Number(arc.getAttribute('stroke-dasharray'));
    return 1 - Number(arc.getAttribute('stroke-dashoffset')) / dash;
  });
  // 257.8% across four cores is 64.5% of capacity, not a saturated ring.
  expect(cpuRatio).toBeCloseTo(0.6445, 2);
  await expect(dials.nth(1)).toContainText('1820 MB');
  await expect(dials.nth(1)).toContainText('of 4096 MB');
  // The "..." alone is visible at rest; hover reveals its border and surface.
  const actions = card.getByRole('button', { name: 'Actions for Menu desk' });
  const rest = await actions.evaluate(node => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, border: style.borderTopColor };
  });
  expect(rest.background).toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
  expect(rest.border).toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
  await actions.hover();
  await expect.poll(() => actions.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(rest.background);
  await expect.poll(() => actions.evaluate(node => getComputedStyle(node).borderTopColor)).not.toBe(rest.border);
  // The "..." trigger opens the same menu as a right click.
  await actions.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Open' })).toBeEnabled();
  await expect(menu.getByRole('menuitem', { name: /Power off/ })).toBeEnabled();
  await expect(menu.getByRole('menuitem', { name: /File browser/ })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: /Settings/ })).toBeEnabled();
  // "Gray this out" means visibly dimmed, not merely non-interactive.
  for (const name of [/File browser/]) {
    const opacity = await menu.getByRole('menuitem', { name }).evaluate(node => Number(getComputedStyle(node).opacity));
    expect(opacity, `${name} must be dimmed`).toBeLessThan(0.6);
  }
  const enabledOpacity = await menu.getByRole('menuitem', { name: 'Open' }).evaluate(node => Number(getComputedStyle(node).opacity));
  expect(enabledOpacity).toBe(1);
  await expect(menu).toContainText('Danger zone');
  await expect(menu.getByRole('menuitem', { name: /Remove/ })).toBeEnabled();
  await page.keyboard.press('Escape');

  // Right click reaches the identical menu.
  await card.click({ button: 'right' });
  await expect(page.getByRole('menu').getByRole('menuitem', { name: /Power off/ })).toBeEnabled();

  // Power off from the menu stops the desktop and flips the card.
  await page.getByRole('menu').getByRole('menuitem', { name: /Power off/ }).click();
  await expect(card.getByRole('button', { name: 'Open Menu desk desktop' })).toBeDisabled();
  await expect(card.getByText('Stopped')).toBeVisible();
  await expect(card.getByRole('button', { name: /^(Start|Stop)$/ })).toHaveCount(0);
  // Power on remains available through the same "..."/right-click menu.
  await card.getByRole('button', { name: 'Actions for Menu desk' }).click();
  await expect(page.getByRole('menu').getByRole('menuitem', { name: /Power on/ })).toBeEnabled();
  await page.getByRole('menu').getByRole('menuitem', { name: /Power on/ }).click();
  await expect(card.getByText('Running')).toBeVisible();
  await expect(card.getByRole('button', { name: /^(Start|Stop)$/ })).toHaveCount(0);
});

test('computer Settings from the shared menu edits live limits and warns before timezone replacement', async ({ page }) => {
  const id = '9c1f2a6e-3b4d-4c8a-9e11-2d5f7a9b0c13';
  const { computers } = await mockComputers(page, [{ id, name: 'Settings desk', state: 'running', createdAt: 0,
    cpuPercent: 1, memoryBytes: 1_073_741_824, memoryLimitBytes: 4 * 1024 ** 3, cpuCount: 4,
    cpuCores: 4, memoryGiB: 4, timezone: 'America/Toronto' }]);
  await page.goto('/computers');
  const card = page.getByRole('article', { name: 'Settings desk' });
  await card.getByRole('button', { name: 'Actions for Settings desk' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page).toHaveURL(new RegExp(`/computers/${id}/settings$`));
  const dialog = page.getByRole('dialog', { name: 'Settings for Settings desk' });
  await expect(dialog.getByLabel('CPU cores', { exact: true })).toHaveValue('4');
  await expect(dialog.getByLabel('Memory (GiB RAM)', { exact: true })).toHaveValue('4');
  await expect(dialog.getByLabel('Timezone', { exact: true })).toHaveValue('America/Toronto');
  await dialog.getByLabel('CPU cores', { exact: true }).fill('2');
  await dialog.getByLabel('Memory (GiB RAM)', { exact: true }).fill('6');
  await dialog.getByRole('button', { name: 'Save settings' }).click();
  await expect(dialog).toBeHidden();
  expect(computers[0]).toMatchObject({ cpuCores: 2, memoryGiB: 6, timezone: 'America/Toronto' });
  await expect(card.getByTestId('usage-dial').nth(1)).toContainText('of 6144 MB');
  await card.getByRole('button', { name: 'Actions for Settings desk' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  const reopened = page.getByRole('dialog', { name: 'Settings for Settings desk' });
  await expect(reopened.getByLabel('CPU cores', { exact: true })).toHaveValue('2');
  await reopened.getByLabel('Timezone', { exact: true }).fill('Etc/UTC');
  await expect(reopened.getByRole('alert')).toContainText('Power off the computer');
  await expect(reopened.getByRole('button', { name: 'Power off first' })).toBeDisabled();
  await reopened.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/computers$/);
});

test('a stopped computer can change timezone only after explicit replacement confirmation', async ({ page }) => {
  const id = '9c1f2a6e-3b4d-4c8a-9e11-2d5f7a9b0c13';
  const { computers } = await mockComputers(page, [{ id, name: 'Stopped desk', state: 'exited', createdAt: 0,
    cpuPercent: null, memoryBytes: null, memoryLimitBytes: null, cpuCount: null,
    cpuCores: 4, memoryGiB: 4, timezone: 'America/Toronto' }]);
  await page.goto('/computers');
  await page.getByRole('button', { name: 'Actions for Stopped desk' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings for Stopped desk' });
  await dialog.getByLabel('Timezone', { exact: true }).fill('Etc/UTC');
  await expect(dialog.getByRole('alert')).toContainText('home/workspace volumes stay intact');
  const replace = dialog.getByRole('button', { name: 'Replace stopped computer' });
  await expect(replace).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /I understand this will replace/ }).check();
  await expect(replace).toBeEnabled();
  await replace.click();
  await expect(dialog).toBeHidden();
  expect(computers[0]).toMatchObject({ timezone: 'Etc/UTC', state: 'exited' });
});

test('preview dissolves without the breathing brightness dip', async ({ page }) => {
  // Measures the user-visible fault directly: two frames of identical mean
  // luminance dissolve into each other, so any dip in rendered brightness comes
  // from the compositing, not the content. A sum-to-one crossfade over the
  // black card backdrop yields t*new + (1-t)^2*old, a 25% dip at t=0.5 (the
  // "breathing light"); an opaque floor yields a true (1-t)*old + t*new blend
  // with no dip at all.
  const id = 'b7d0c4e2-6a19-4b3e-8f2c-1a9e5d3c7b64';
  await mockComputers(page, [{ id, name: 'Fade desk', state: 'running', createdAt: 0, cpuPercent: 2, memoryBytes: 104857600, memoryLimitBytes: 4294967296, cpuCount: 4 } as unknown as Computer]);
  let requests = 0;
  await page.route(new RegExp(`/api/computers/${id}/preview\\?at=`), route => {
    requests += 1;
    // Same luminance in both frames; only the 2px mark differs, so the two are
    // distinguishable as separate frames without changing the mean brightness.
    return route.fulfill({
      status: 200, contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#808080"/><rect x="${requests % 2 ? 4 : 8}" y="4" width="2" height="2" fill="#000"/></svg>`,
    });
  });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Computers' }).click();
  const card = page.getByRole('article', { name: 'Fade desk' });
  const layers = card.getByTestId('computer-preview-layer');
  await expect(layers.first()).toBeVisible();
  const preview = card.getByTestId('computer-preview');
  const box = await preview.boundingBox();
  expect(box).toBeTruthy();
  const luminance = async () => {
    const png = await page.screenshot({ clip: { x: box!.x + 4, y: box!.y + 4, width: 200, height: 100 }, animations: 'disabled' });
    return page.evaluate(async data => {
      const image = await createImageBitmap(await(await fetch(`data:image/png;base64,${data}`)).blob());
      const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
      const ctx = c.getContext('2d');
      if (!ctx) throw Error('no 2d context for the brightness sample');
      ctx.drawImage(image, 0, 0); image.close();
      const { data: rgba } = ctx.getImageData(0, 0, c.width, c.height);
      let total = 0, count = 0;
      for (let p = 0; p < rgba.length; p += 4) { total += 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]; count += 1; }
      return Math.round((total / count) * 100) / 100;
    }, Buffer.from(png).toString('base64'));
  };
  const readings: number[] = [];
  const opacities: Array<{ count: number; floor: number; top: number }> = [];
  for (let sample = 0; sample < 40; sample += 1) {
    readings.push(await luminance());
    const states = await layers.evaluateAll(nodes => [{
      count: nodes.length,
      floor: Number(nodes[0]?.style.opacity ?? 1),
      top: Number(nodes[nodes.length - 1]?.style.opacity ?? 1),
    }]);
    if (states.length) opacities.push(states[0]);
    await page.waitForTimeout(60);
  }
  // 1. Brightness never dips: the darkest sample stays within 3% of the
  //    settled (brightest) reading. 128 grey is the expected plateau.
  const plateau = Math.max(...readings);
  const dip = (plateau - Math.min(...readings)) / plateau;
  expect(dip, `brightness dipped ${(dip * 100).toFixed(1)}%: ${JSON.stringify(readings)}`).toBeLessThan(0.03);
  expect(plateau, `grey plateau measured ${plateau}, expected ~128`).toBeGreaterThan(120);
  // 2. The floor layer stays fully opaque throughout, and at most two exist.
  for (const state of opacities) {
    expect(state.count, 'never more than two layers').toBeLessThanOrEqual(2);
    expect(state.floor, `floor dimmed to ${state.floor}: ${JSON.stringify(opacities)}`).toBe(1);
    expect(state.top).toBeGreaterThanOrEqual(0);
  }
  // 3. Frames really were exchanged at ~2 fps.
  expect(requests).toBeGreaterThanOrEqual(4);
});

test('viewer reports an offline stream and retries its iframe without erasing the computer', async ({ page }) => {
  const id = 'da02f137-8a73-4e93-9d22-95886ca9f9fa';
  const { computers } = await mockComputers(page, [{ id, name: 'Recoverable desk', state: 'running', createdAt: 0, cpuPercent: 2, memoryBytes: 104857600 }]);
  let healthy = false;
  let loads = 0;
  await page.addInitScript(computerId => localStorage.setItem(`computer-consent:${computerId}`, 'yes'), id);
  await page.route(`**/computers/${id}/desktop/api/health`, route => route.fulfill({ status: healthy ? 200 : 503, json: { status: healthy ? 'ok' : 'unavailable' } }));
  await page.route(`**/computers/${id}/desktop/`, route => {
    loads++;
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Trusted desktop</title><video></video>' });
  });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Computers' }).click();
  await page.getByRole('button', { name: 'Open Recoverable desk desktop' }).click();
  const viewer = page.getByTestId('computer-viewer');
  await expect(viewer.getByRole('alert')).toContainText('Desktop stream unavailable.');
  healthy = true;
  await viewer.getByRole('button', { name: 'Retry connection' }).click();
  await expect(viewer.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => loads).toBeGreaterThan(1);
  expect(computers).toHaveLength(1);
});

test('trusted desktop frame smooths a downscaled stream despite upstream pixelated sink styles', async ({ page }) => {
  // The pinned Selkies client sets crisp-edges inline even when its 1920px
  // canvas is displayed at 1280px. Exercise the exact trusted frame HTML;
  // mock only unused upstream bundles, not the frame's own CSS.
  await page.route('**/assets/index-CPWh3fQ6.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('**/assets/index-D97fjY6g.css', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.goto('/desktop-frame.html');
  await page.evaluate(() => {
    for (const id of ['videoCanvas', 'videoWorkerCanvas']) {
      const canvas = document.createElement('canvas');
      canvas.id = id;
      canvas.width = 1920;
      canvas.height = 1080;
      canvas.style.width = '1280px';
      canvas.style.height = '720px';
      canvas.style.imageRendering = 'pixelated';
      canvas.style.setProperty('image-rendering', 'crisp-edges');
      document.body.appendChild(canvas);
    }
    // The WebCodecs H.264 path presents through this page-level video element;
    // upstream marks it crisp inline for 1:1 display even while downscaled.
    const video = document.createElement('video');
    video.id = 'videoStream';
    video.style.width = '1280px';
    video.style.height = '720px';
    video.style.imageRendering = 'pixelated';
    video.style.setProperty('image-rendering', 'crisp-edges');
    document.body.appendChild(video);
  });
  for (const id of ['videoCanvas', 'videoWorkerCanvas', 'videoStream']) {
    await expect(page.locator(`#${id}`)).toHaveCSS('image-rendering', 'auto');
  }
});

test('keeps saved computers visible but controls disabled when their controller is offline', async ({ page }) => {
  await mockComputers(page);
  await page.route(/\/api\/computers(?:\?.*)?$/, route => route.fulfill({ json: { controllerConnected: false, computers: [{ id: 'saved', name: 'Saved computer', state: 'unavailable', createdAt: 0, cpuPercent: null, memoryBytes: null }] } }));
  await page.goto('/');
  await page.getByRole('tab', { name: 'Computers' }).click();
  await expect(page.getByRole('article', { name: 'Saved computer' })).toBeVisible();
  await expect(page.getByText('Computer management is offline.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create computer' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Actions for Saved computer' })).toBeDisabled();
});

test('new computer offers detected CPU/memory controls with today’s defaults and Toronto time', async ({ page }) => {
  const { createdSettings } = await mockComputers(page);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Computers' }).click();
  await page.getByRole('button', { name: 'Create computer' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create computer' });
  const cpu = dialog.getByLabel('CPU cores', { exact: true });
  const memory = dialog.getByLabel('Memory (GiB RAM)', { exact: true });
  const timezone = dialog.getByLabel('Timezone', { exact: true });
  await expect(cpu).toHaveValue('4');
  await expect(memory).toHaveValue('4');
  await expect(timezone).toHaveValue('America/Toronto');
  await expect(dialog).toContainText('additional host swap');
  await dialog.getByRole('button', { name: 'Increase CPU cores' }).click();
  await memory.fill('6');
  await timezone.fill('Etc/UTC');
  await dialog.getByLabel('Computer name').fill('Custom resources');
  await dialog.getByRole('button', { name: 'Create computer' }).click();
  await expect(page.getByRole('article', { name: 'Custom resources' })).toBeVisible();
  expect(createdSettings).toEqual([{ cpuCores: 5, memoryGiB: 6, timezone: 'Etc/UTC' }]);
});

test('suggests a non-duplicate Workspace-NG default name and keeps an edited name', async ({ page }) => {
  const { computers } = await mockComputers(page, [{ id: 'taken', name: 'Workspace-NGAAAA', state: 'running', createdAt: 0, cpuPercent: 0, memoryBytes: 0 }]);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Computers' }).click();
  const trigger = page.getByRole('button', { name: 'Create computer' });
  await trigger.click();
  const create = page.getByRole('dialog', { name: 'Create computer' });
  const field = create.getByLabel('Computer name');
  await expect(field).toHaveValue(/^Workspace-NG[A-Z]{4}$/);
  const suggested = await field.inputValue();
  expect(suggested).not.toBe('Workspace-NGAAAA');
  await create.getByRole('button', { name: 'Create computer' }).click();
  await expect(page.getByRole('article', { name: suggested })).toBeVisible();
  expect(computers.map(computer => computer.name)).toContain(suggested);
  // The dialog stays mounted through its exit animation while Radix keeps the
  // rest of the page aria-hidden; a reopen click before it hides would land on
  // the exiting submit button instead of the header trigger.
  await expect(create).toBeHidden();
  await trigger.click();
  const next = await field.inputValue();
  expect(next).toMatch(/^Workspace-NG[A-Z]{4}$/);
  expect(computers.map(computer => computer.name)).not.toContain(next);
  await field.fill('Desk prime');
  await create.getByRole('button', { name: 'Cancel' }).click();
  await expect(create).toBeHidden();
  await trigger.click();
  await expect(field).toHaveValue('Desk prime');
});

test('creates a computer and requires an exact typed name before destructive deletion', async ({ page }) => {
  const { computers } = await mockComputers(page);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Computers' }).click();
  await page.getByRole('button', { name: 'Create computer' }).click();
  const create = page.getByRole('dialog', { name: 'Create computer' });
  await expectCentered(page, create);
  await create.getByLabel('Computer name').fill('Test machine');
  await create.getByRole('button', { name: 'Create computer' }).click();
  await expect(page.getByRole('article', { name: 'Test machine' })).toBeVisible();
  expect(computers).toHaveLength(1);
  await page.getByRole('article', { name: 'Test machine' }).getByRole('button', { name: 'Actions for Test machine' }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: /Remove/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete computer' });
  await expectCentered(page, dialog);
  await expect(dialog).toContainText('home');
  await expect(dialog).toContainText('workspace');
  const confirm = dialog.getByLabel('Confirm computer name');
  await confirm.fill('test machine');
  await expect(dialog.getByRole('button', { name: 'Delete computer' })).toBeDisabled();
  await confirm.fill('Test machine');
  await dialog.getByRole('button', { name: 'Delete computer' }).click();
  await expect(page.getByRole('article', { name: 'Test machine' })).toHaveCount(0);
  expect(computers).toHaveLength(0);
});
