import { test, expect } from './fixtures';

test('agent configuration is left-aligned, sectioned, and discoverable in one scroll without tabs', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto('/agents/avery');
  const pane = page.getByRole('region', { name: 'Settings for Avery' });
  const editor = pane.getByRole('region', { name: 'Agent editor' });
  const channels = pane.getByRole('heading', { name: 'Channels', exact: true });
  const avatar = pane.getByRole('heading', { name: 'Avatar', exact: true });
  await expect(pane.getByRole('tablist', { name: 'Agent editor sections' })).toHaveCount(0);
  await expect(channels).toBeVisible();
  await expect(pane.getByRole('checkbox', { name: 'Morgan' })).toBeVisible();
  await expect(avatar).toBeVisible();
  expect((await channels.boundingBox())!.x - (await pane.boundingBox())!.x).toBeLessThan(40);
  expect((await avatar.boundingBox())!.y).toBeGreaterThan((await channels.boundingBox())!.y);
  await page.screenshot({ path: test.info().outputPath('agent-scroll-desktop-top.png'), animations: 'disabled' });
  await editor.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => editor.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  await expect(pane.getByRole('button', { name: 'Preview Triangle' })).toBeVisible();
  await expect(pane.getByRole('button', { name: 'Save changes' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('agent-scroll-desktop-avatar.png'), animations: 'disabled' });
});

test('legacy avatar links land at the scroll section and phone controls remain reachable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/agents/avery/edit/avatar');
  const pane = page.getByRole('region', { name: 'Settings for Avery' });
  const editor = pane.getByRole('region', { name: 'Agent editor' });
  await expect(pane.getByRole('heading', { name: 'Avatar', exact: true })).toBeVisible();
  await expect.poll(() => editor.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  await expect(pane.getByRole('button', { name: 'Preview Triangle' })).toBeVisible();
  await expect(pane.getByRole('button', { name: 'Back to agents' })).toBeVisible();
  await expect(pane.getByRole('button', { name: 'Save changes' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('agent-scroll-phone-avatar.png'), animations: 'disabled' });
  await page.reload();
  await expect.poll(() => editor.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  await page.goto('/agents/avery/edit/settings/channels/swarm');
  await expect(pane.getByRole('checkbox', { name: 'Morgan' })).toBeVisible();
});
