import { test, expect } from './fixtures';

test('an agent link opens its settings in one scroll, Avatar included, over its chat', async ({ page }) => {
  await page.goto('/agents/avery');
  const settings = page.getByRole('region', { name: 'Settings for Avery' });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('tablist', { name: 'Agent editor sections' })).toHaveCount(0);
  await expect(settings.getByRole('heading', { name: 'Channels' })).toBeVisible();
  await expect(settings.getByRole('checkbox', { name: 'Morgan' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('agents-settings-desktop.png'), animations: 'disabled' });
  // The chat behind the modal is out of reach until it closes.
  await expect(page.getByRole('form', { name: 'Message composer' })).toHaveCount(0);
  await settings.getByRole('region', { name: 'Agent editor' }).evaluate(element => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(settings.getByRole('heading', { name: 'Avatar' })).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Preview Triangle' })).toBeVisible();
  await page.reload();
  await expect(settings.getByRole('heading', { name: 'Channels' })).toBeVisible();
  await expect(settings.getByRole('heading', { name: 'Avatar' })).toBeVisible();
  await page.getByRole('button', { name: 'Close agent settings' }).click();
  await expect(page.getByRole('form', { name: 'Message composer' })).toBeVisible();
});

test('Save and Discard appear only while avatar or permission changes are unsaved', async ({ page }) => {
  await page.goto('/agents/avery');
  const settings = page.getByRole('region', { name: 'Settings for Avery' });
  const morgan = settings.getByRole('checkbox', { name: 'Morgan' });
  await expect(morgan).toBeVisible();
  const save = settings.getByRole('button', { name: 'Save changes' });
  const discard = settings.getByRole('button', { name: 'Discard changes' });
  await expect(save).toHaveCount(0);
  await expect(discard).toHaveCount(0);
  await morgan.check();
  await expect(save).toBeVisible();
  await expect(discard).toBeVisible();
  await morgan.uncheck();
  await expect(save).toHaveCount(0);
  await expect(discard).toHaveCount(0);
  const shapes = settings.getByRole('group', { name: 'Avatar shape' });
  const original = await shapes.locator('[aria-pressed="true"]').getAttribute('aria-label');
  await shapes.getByRole('button', { name: 'Preview Triangle' }).click();
  await expect(save).toBeVisible();
  await shapes.getByRole('button', { name: original! }).click();
  await expect(save).toHaveCount(0);
  await shapes.getByRole('button', { name: 'Preview Bean' }).click();
  await discard.click();
  await expect(save).toHaveCount(0);
  await expect(discard).toHaveCount(0);
});

test('inline avatar and DM grants save together, and Discard restores unsaved changes without leaving the settings', async ({
  page,
}) => {
  const updates: Array<{ avatar: { shape: string }; allowedDmAgentIds: string[] }> = [];
  await page.route('**/api/agents/avery/settings', route => {
    if (route.request().method() === 'PATCH') updates.push(route.request().postDataJSON());
    return route.fallback();
  });
  await page.goto('/agents/avery');
  const settings = page.getByRole('region', { name: 'Settings for Avery' });
  await expect(settings.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  await settings.getByRole('checkbox', { name: 'Morgan' }).check();
  await settings.getByRole('region', { name: 'Agent editor' }).evaluate(element => {
    element.scrollTop = element.scrollHeight;
  });
  await settings.getByRole('button', { name: 'Preview Triangle' }).click();
  await settings.getByRole('button', { name: 'Save changes' }).click();
  await expect(settings.getByRole('status')).toContainText('Saved');
  await expect(settings.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  expect(updates).toHaveLength(1);
  expect(updates[0].allowedDmAgentIds).toContain('morgan');
  expect(updates[0].avatar.shape).toBe('triangle');
  await settings.getByRole('button', { name: 'Preview Bean' }).click();
  await settings.getByRole('button', { name: 'Discard changes' }).click();
  await expect(settings.getByRole('button', { name: 'Preview Triangle' })).toHaveAttribute('aria-pressed', 'true');
  await expect(settings.getByRole('button', { name: 'Discard changes' })).toHaveCount(0);
  await expect(page).toHaveURL(/\/agents\/avery$/);
});

test('phones show agent settings full screen, while legacy peer links move to Chat', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/agents/avery');
  const settings = page.getByRole('region', { name: 'Settings for Avery' });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('checkbox', { name: 'Morgan' })).toBeVisible();
  const dialog = page.getByRole('dialog').filter({ has: settings });
  expect((await dialog.boundingBox())!.width).toBe(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('agents-settings-phone.png'), animations: 'disabled' });
  await page.goto('/agents/avery/dm/morgan');
  await expect(page).toHaveURL(/\/chat\/agents\/avery\/dm\/morgan$/);
  await expect(page.getByRole('button', { name: 'Back to chats' })).toBeVisible();
});
