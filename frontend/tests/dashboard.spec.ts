import { test, expect } from '@playwright/test';

test('preview follows the agents and chat layout', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab')).toHaveText(['Agents', 'Preferences']);
  await expect(page.getByRole('tab', { name: 'Agents', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Avery', exact: true })).toBeVisible();
  await expect(page.getByText('Your account', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await page.getByRole('button', { name: 'Open conversation with Morgan' }).click();
  await expect(page.getByRole('heading', { name: 'Morgan', exact: true })).toBeVisible();
  await expect(page.getByLabel('Message Morgan')).toBeVisible();
});

test('agent panel context menu opens only a creation placeholder', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('complementary', { name: 'Agents', exact: true }).click({ button: 'right', position: { x: 50, y: 350 } });
  const create = page.getByRole('menuitem', { name: 'Create new agent' });
  await expect(create).toBeVisible();
  await expect(create).toHaveCSS('cursor', 'pointer');
  await create.click();
  const dialog = page.getByRole('dialog', { name: 'Create new agent' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Agent creation will be available here. Nothing is created in this preview.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: /^Open conversation with/ })).toHaveCount(4);
});

test('agent context menu and placeholder support keyboard dismissal and focus return', async ({ page }) => {
  await page.goto('/');
  const panel = page.getByRole('complementary', { name: 'Agents', exact: true });
  await panel.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Create new agent' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Create new agent' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(panel).toBeFocused();
});

test('agent search filters names and handles no matches', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('searchbox', { name: 'Search agents' });
  await expect(search).toBeVisible();
  await search.fill('  MOR  ');
  await expect(page.getByRole('button', { name: /^Open conversation with/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Open conversation with Morgan' })).toBeVisible();
  await search.fill('unknown');
  await expect(page.getByText('No agents found.')).toBeVisible();
  await search.fill('');
  await expect(page.getByRole('button', { name: /^Open conversation with/ })).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Add attachment' })).toBeDisabled();
});

test('navigation is centered with a moving indicator and pointer cursors', async ({ page }) => {
  await page.goto('/');
  const indicator = page.getByTestId('tab-indicator');
  await expect(indicator).toBeVisible();
  const tabs = page.getByRole('tablist', { name: 'Main navigation' });
  const box = await tabs.boundingBox();
  const width = await page.evaluate(() => window.innerWidth);
  expect(Math.abs(box!.x + box!.width / 2 - width / 2)).toBeLessThan(2);
  await expect(page.getByRole('tab', { name: 'Preferences' })).toHaveCSS('cursor', 'pointer');
  await expect(page.getByRole('button', { name: 'Open conversation with Morgan' })).toHaveCSS('cursor', 'pointer');
  await expect(indicator).toHaveCSS('transition-property', /\btransform\b/);
  const initial = await indicator.boundingBox();
  await page.getByRole('tab', { name: 'Preferences' }).click();
  await expect.poll(async () => (await indicator.boundingBox())!.x).toBeGreaterThan(initial!.x + 50);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(indicator).toHaveCSS('transition-property', 'none');
});

test('preferences is a placeholder with keyboard-accessible tabs', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Agents', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Preferences' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible();
  await expect(page.getByText('Settings will live here.')).toBeVisible();
  await page.getByRole('tab', { name: 'Agents', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Avery', exact: true })).toBeVisible();
});

test('mobile can move between agent list and conversation without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open conversation with Riley' }).click();
  await expect(page.getByRole('heading', { name: 'Riley', exact: true })).toBeVisible();
  await expect(page.getByLabel('Message Riley')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Back to agents' }).click();
  await expect(page.getByRole('button', { name: 'Open conversation with Avery' })).toBeVisible();
  await expect(page.getByText('Your account', { exact: true })).toBeVisible();
});
