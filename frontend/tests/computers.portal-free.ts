import { test, expect } from './fixtures';

// Opt-in with VITE_COMPUTER_PORTAL_FREE=true against disposable development
// data only. The normal Wayland/browser suite retains portal consent tests.
test('portal-free computer opens directly into a live same-origin viewer', async ({ page }) => {
  const id = '7ad66d47-c09d-478b-96be-8c734ac555eb';
  await page.route(/\/api\/computers(?:\?.*)?$/, route => route.fulfill({ json: { controllerConnected: true, computers: [
    { id, name: 'Test X11 desk', state: 'running', createdAt: 0, cpuPercent: 0, memoryBytes: 0 },
  ] } }));
  await page.route(`**/computers/${id}/desktop/api/health`, route => route.fulfill({ json: { status: 'ok' } }));
  await page.route(`**/computers/${id}/desktop/`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Trusted desktop</title><canvas id="videoCanvas"></canvas>' }));
  await page.goto('/');
  const tabs = page.getByRole('tablist', { name: 'Main navigation' });
  await page.getByRole('tab', { name: 'Computers' }).click();
  await expect(tabs).toBeVisible();
  await page.getByRole('button', { name: 'Open Test X11 desk desktop' }).click();
  await expect(tabs).toHaveCount(0);
  const viewer = page.getByTestId('computer-viewer');
  await expect.poll(async () => (await viewer.boundingBox())?.y ?? 999).toBeLessThan(4);
  await expect(viewer.locator(`iframe[title="Test X11 desk desktop"]`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pan desktop right' })).toHaveCount(0);
  await expect(viewer.getByText('Permission preview: clicks only.')).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: 'Grant screen access' })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: 'Show live desktop' })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(tabs).toHaveCount(0);
  await expect.poll(async () => (await viewer.boundingBox())?.y ?? 999).toBeLessThan(4);
  await expect.poll(async () => (await viewer.locator('iframe').boundingBox())?.height ?? 0).toBeGreaterThan(540);
  await expect(page.getByRole('button', { name: 'Pan desktop right' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const back = viewer.getByRole('button', { name: 'Back to computers' });
  await expect(back).toBeVisible();
  await expect(viewer.getByRole('navigation', { name: 'Computer location' })).toContainText('Test X11 desk');
  await back.click();
  await expect(tabs).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Computers' })).toBeFocused();
});
