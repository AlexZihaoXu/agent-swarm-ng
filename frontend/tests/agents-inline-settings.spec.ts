import { test, expect } from './fixtures';

test('Agents opens selected agent settings directly, keeps Avatar inline, and has no Edit context action', async ({ page }) => {
  await page.goto('/agents/avery');
  const settings = page.getByRole('region', { name: 'Settings for Avery' });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('tab', { name: 'Settings', exact: true })).toHaveAttribute('data-state', 'active');
  await expect(settings.getByRole('button', { name: /Swarm App/ })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('agents-settings-desktop.png'), animations: 'disabled' });
  await expect(page.getByRole('form', { name: 'Message composer' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Edit agent' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open settings for Avery' }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Edit agent' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Delete agent' })).toBeVisible();
  await page.keyboard.press('Escape');
  await settings.getByRole('tab', { name: 'Avatar' }).click();
  await expect(page).toHaveURL(/\/agents\/avery\/edit\/avatar$/);
  await expect(settings.getByRole('button', { name: 'Preview Triangle' })).toBeVisible();
  await page.reload();
  await expect(settings.getByRole('tab', { name: 'Avatar' })).toHaveAttribute('data-state', 'active');
  await settings.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(settings.getByRole('button', { name: /Swarm App/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Message composer' })).toBeVisible();
});

test('inline avatar and DM grants save together, and Discard restores unsaved changes without leaving Agents', async ({ page }) => {
  const updates: Array<{ avatar: { shape: string }; allowedDmAgentIds: string[] }> = [];
  await page.route('**/api/agents/avery/settings', route => {
    if (route.request().method() === 'PATCH') updates.push(route.request().postDataJSON());
    return route.fallback();
  });
  await page.goto('/agents/avery');
  const settings = page.getByRole('region', { name: 'Settings for Avery' });
  await settings.getByRole('button', { name: /Swarm App/ }).click();
  await settings.getByRole('checkbox', { name: 'Morgan' }).check();
  await settings.getByRole('tab', { name: 'Avatar' }).click();
  await settings.getByRole('button', { name: 'Preview Triangle' }).click();
  await settings.getByRole('button', { name: 'Save changes' }).click();
  await expect(settings.getByRole('status')).toContainText('Saved');
  expect(updates).toHaveLength(1);
  expect(updates[0].allowedDmAgentIds).toContain('morgan');
  expect(updates[0].avatar.shape).toBe('triangle');
  await settings.getByRole('button', { name: 'Preview Bean' }).click();
  await settings.getByRole('button', { name: 'Discard changes' }).click();
  await expect(settings.getByRole('button', { name: 'Preview Triangle' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/\/agents\/avery\/edit\/avatar$/);
});

test('phone Agents list opens inline settings with Back, while legacy peer links move to Chat', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/agents');
  await page.getByRole('button', { name: 'Open settings for Avery' }).click();
  const settings = page.getByRole('region', { name: 'Settings for Avery' });
  await expect(settings).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Agents' })).toBeHidden();
  await expect(settings.getByRole('button', { name: 'Back to agents' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('agents-settings-phone.png'), animations: 'disabled' });
  await settings.getByRole('button', { name: 'Back to agents' }).click();
  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByRole('complementary', { name: 'Agents' })).toBeVisible();
  await page.goto('/agents/avery/dm/morgan');
  await expect(page).toHaveURL(/\/chat\/agents\/avery\/dm\/morgan$/);
  await expect(page.getByRole('button', { name: 'Back to chats' })).toBeVisible();
});
