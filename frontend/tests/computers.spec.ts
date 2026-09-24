import { test, expect, type Page } from './fixtures';

type Computer = { id: string; name: string; state: string; createdAt: number; cpuPercent: number | null; memoryBytes: number | null };
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
  await expect(dialog).toHaveCSS('animation-name', 'none');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await card.getByRole('button', { name: /Delete Very long/ }).click();
  await expect(page.getByRole('dialog', { name: 'Delete computer' }).getByLabel('Confirm computer name')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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
  await create.getByLabel('Computer name').fill('Test machine');
  await create.getByRole('button', { name: 'Create computer' }).click();
  await expect(page.getByRole('article', { name: 'Test machine' })).toBeVisible();
  expect(computers).toHaveLength(1);
  await page.getByRole('article', { name: 'Test machine' }).getByRole('button', { name: 'Delete Test machine' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete computer' });
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
