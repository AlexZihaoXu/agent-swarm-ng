import { test, expect } from './fixtures';

test('the audit log shows sign-in attempts and changes, filtered by category, to the millisecond', async ({
  page,
  playwright,
  baseURL,
}) => {
  // A stranger's wrong password, from a browser that is not signed in.
  const stranger = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  expect(
    (await stranger.post('/api/auth/login', { data: { name: 'Mallory', password: 'guess guess' } })).status(),
  ).toBe(401);
  await stranger.dispose();
  const name = `Audit org ${Date.now()}`;
  expect((await page.request.post('/api/organizations', { data: { name } })).ok()).toBe(true);

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Open the audit log' }).click();
  await expect(page).toHaveURL(/\/settings\/audit$/);
  const log = page.getByRole('region', { name: 'Audit log' });
  const failed = log.getByRole('row').filter({ hasText: 'Mallory' }).first();
  await expect(failed).toContainText('Sign-in');
  await expect(failed).toContainText('wrong name or password');
  await expect(failed).toContainText('Failed');
  // Time to the millisecond, with the exact instant in the title.
  await expect(failed.locator('time')).toHaveText(/\d\d:\d\d:\d\d[.,]\d{3}/);
  await expect(failed.locator('time')).toHaveAttribute('title', /\.\d{3}Z$/);
  await expect(log.getByRole('row').filter({ hasText: name })).toContainText('Organization created');

  await log.getByRole('radio', { name: 'Sign-in' }).click();
  await expect(log.getByRole('row').filter({ hasText: name })).toHaveCount(0);
  await expect(log.getByRole('row').filter({ hasText: 'Mallory' }).first()).toBeVisible();
  await log.getByRole('radio', { name: 'Organizations' }).click();
  await expect(log.getByRole('row').filter({ hasText: 'Mallory' })).toHaveCount(0);
  await expect(log.getByRole('row').filter({ hasText: name })).toBeVisible();

  await log.getByRole('button', { name: 'Back to settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
});

test('the audit log page fits a phone without sideways page scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/settings/audit');
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
