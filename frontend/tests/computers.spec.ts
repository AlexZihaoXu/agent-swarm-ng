import { test, expect, type Page } from './fixtures';

type Computer = { id: string; name: string; state: string; createdAt: number; cpuPercent: number | null; memoryBytes: number | null };
async function expectCentered(page: Page, dialog: ReturnType<Page['getByRole']>) {
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport).toBeTruthy();
  expect(Math.abs(box!.x + box!.width / 2 - viewport!.width / 2)).toBeLessThan(3);
  expect(Math.abs(box!.y + box!.height / 2 - viewport!.height / 2)).toBeLessThan(3);
}
async function mockComputers(page: Page, initial: Computer[] = []) {
  const computers = [...initial];
  let previews = 0;
  await page.route(/\/api\/computers(?:\?.*)?$/, route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { computers, controllerConnected: true } });
    if (route.request().method() !== 'POST') return route.fulfill({ status: 405 });
    const { name } = route.request().postDataJSON();
    const row: Computer = { id: crypto.randomUUID(), name, state: 'running', createdAt: Date.now(), cpuPercent: 1.5, memoryBytes: 209715200 };
    computers.push(row);
    return route.fulfill({ status: 201, json: row });
  });
  await page.route('**/api/computers/**', route => {
    const path = new URL(route.request().url()).pathname.split('/');
    const id = path[3];
    if (path[4] === 'preview') { previews++; return route.fulfill({ status: 503, json: { message: 'Preview warming up.' } }); }
    if (route.request().method() !== 'DELETE') return route.fulfill({ status: 405 });
    const index = computers.findIndex(item => item.id === id);
    if (index === -1) return route.fulfill({ status: 404, json: { message: 'Not found.' } });
    if (route.request().postDataJSON().confirmation !== computers[index].name) return route.fulfill({ status: 400, json: { message: 'Type the name exactly.' } });
    computers.splice(index, 1);
    return route.fulfill({ json: { deleted: true } });
  });
  return { computers, previewCount: () => previews };
}

test('Computers shows a responsive screenshot-first grid with name and CPU/memory below', async ({ page }) => {
  const { previewCount } = await mockComputers(page, [
    { id: 'alpha', name: 'Research', state: 'running', createdAt: 0, cpuPercent: 12.5, memoryBytes: 268435456 },
    { id: 'beta', name: 'Offline', state: 'exited', createdAt: 0, cpuPercent: null, memoryBytes: null },
  ]);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Computers' }).click();
  await expect(page.getByRole('heading', { name: 'Computers' })).toBeVisible();
  const card = page.getByRole('article', { name: 'Research' });
  await expect(card.getByTestId('computer-preview')).toBeVisible();
  await expect(card).toContainText('CPU 12.5%');
  await expect(card).toContainText('Memory 256 MiB');
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
  await card.getByRole('button', { name: /Delete Very long/ }).click();
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
  await page.getByRole('tab', { name: 'Computers' }).click();
  await page.getByRole('article', { name: 'Work desk' }).getByRole('button', { name: 'Open Work desk desktop' }).click();
  await expect(page.getByRole('navigation', { name: 'Computer location' })).toContainText('Work desk');
  await expect(page.locator('iframe[title="Work desk desktop"]')).toHaveAttribute('src', `/computers/${id}/desktop/`);
  const preview = page.getByRole('button', { name: /Click the permission dialog/ });
  await expect(preview).toBeVisible();
  await preview.click({ position: { x: 200, y: 100 } });
  await expect.poll(() => clicks.length).toBe(1);
  expect(clicks[0].x).toBeGreaterThan(0);
  expect(clicks[0].x).toBeLessThan(1);
  expect(clicks[0].y).toBeGreaterThan(0);
  expect(clicks[0].y).toBeLessThan(1);
  await page.screenshot({ path: '../.scratch/computers-viewer-consent-desktop.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Back to computers' }).click();
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
  await expect(page.getByRole('tab', { name: 'Computers' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByTestId('computer-viewer')).toHaveCSS('animation-name', 'none');
  await page.screenshot({ path: '../.scratch/computers-viewer-consent-phone.png', animations: 'disabled' });
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

test('keeps saved computers visible but controls disabled when their controller is offline', async ({ page }) => {
  await mockComputers(page);
  await page.route(/\/api\/computers(?:\?.*)?$/, route => route.fulfill({ json: { controllerConnected: false, computers: [{ id: 'saved', name: 'Saved computer', state: 'unavailable', createdAt: 0, cpuPercent: null, memoryBytes: null }] } }));
  await page.goto('/');
  await page.getByRole('tab', { name: 'Computers' }).click();
  await expect(page.getByRole('article', { name: 'Saved computer' })).toBeVisible();
  await expect(page.getByText('Computer management is offline.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create computer' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Delete Saved computer' })).toBeDisabled();
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
  await page.getByRole('article', { name: 'Test machine' }).getByRole('button', { name: 'Delete Test machine' }).click();
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
