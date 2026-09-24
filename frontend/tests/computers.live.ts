import { test, expect } from '@playwright/test';

// Opt-in destructive E2E: run only against a uniquely named isolated dev Compose
// project. The default browser suite does not include *.live.ts.
test.skip(process.env.COMPUTER_E2E_ALLOW !== '1', 'Requires an isolated computer-enabled dev stack.');
test.setTimeout(150_000);

test('creates, previews, persists and permanently deletes a real computer through the dashboard', async ({ page, request }) => {
  const name = `E2E desktop ${Date.now()}`;
  let id: string | undefined;
  try {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Computers' }).click();
    await expect(page.getByRole('heading', { name: 'Computers' })).toBeVisible();
    await page.getByRole('button', { name: 'Create computer' }).click();
    const create = page.getByRole('dialog', { name: 'Create computer' });
    await create.getByLabel('Computer name').fill(name);
    await create.getByRole('button', { name: 'Create computer' }).click();
    const card = page.getByRole('article', { name });
    await expect(card).toBeVisible({ timeout: 110_000 });
    await expect.poll(async () => {
      const response = await request.get('/api/computers');
      const data = await response.json();
      id = data.computers.find((item: { name: string }) => item.name === name)?.id;
      return Boolean(id);
    }).toBe(true);
    await expect.poll(() => card.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth), { timeout: 35_000 }).toBeGreaterThan(0);
    await expect(card).toContainText('CPU');
    await expect(card).toContainText('Memory');
    await page.screenshot({ path: '../.scratch/computers-live-desktop.png', animations: 'disabled' });
    await page.setViewportSize({ width: 320, height: 700 });
    await expect(card).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '../.scratch/computers-live-phone.png', animations: 'disabled' });
    await card.getByRole('button', { name: `Delete ${name}` }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete computer' });
    const confirm = dialog.getByLabel('Confirm computer name');
    await confirm.fill(name.toLowerCase());
    await expect(dialog.getByRole('button', { name: 'Delete computer' })).toBeDisabled();
    await confirm.fill(name);
    await dialog.getByRole('button', { name: 'Delete computer' }).click();
    await expect(card).toHaveCount(0, { timeout: 60_000 });
    // The browser cache and API poll can cross the in-flight Docker teardown;
    // wait for the database's committed deletion rather than one immediate read.
    await expect.poll(async () => {
      const after = await (await request.get('/api/computers')).json();
      return after.computers.some((item: { id: string }) => item.id === id);
    }, { timeout: 60_000 }).toBe(false);
  } finally {
    // Best effort if the UI fails halfway; the surrounding dev-project harness
    // also removes only this test namespace's labelled resources.
    const response = await request.get('/api/computers').catch(() => null);
    if (response?.ok()) {
      const data = await response.json();
      for (const row of data.computers as { id: string; name: string }[]) {
        if (row.name === name) await request.delete(`/api/computers/${encodeURIComponent(row.id)}`, { data: { confirmation: name } }).catch(() => {});
      }
    }
  }
});
