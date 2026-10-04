import { test, expect } from './fixtures';
import { TEST_PASSWORD } from './sign-in.setup';

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the dashboard asks to sign in, refuses a wrong password, and opens after the right one', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Sign in to Agent Swarm' })).toBeVisible();
    await expect(page.getByLabel('Name')).toHaveValue('Admin');
    await page.getByRole('button', { name: 'Forgot your password?' }).click();
    await expect(page.getByText('scripts/reset-password.ts')).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill('not the password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Wrong name or password.');
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
    await expect(page.getByText('Signed in as')).toContainText('Admin');
    // Signing out returns to the card, and the API refuses this browser again.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to Agent Swarm' })).toBeVisible();
    expect((await page.request.get('/api/agents')).status()).toBe(401);
  });

  test('the first visit sets the Admin password', async ({ page }) => {
    // This suite's backend already has its password, so the first-visit answers are simulated.
    let signedIn = false;
    await page.route('**/api/auth/session', route =>
      route.fulfill({
        json: signedIn
          ? { signedIn: true, name: 'Admin', admin: true }
          : { signedIn: false, setupRequired: true, name: 'Admin' },
      }),
    );
    await page.route('**/api/auth/setup', async route => {
      expect(route.request().postDataJSON()).toEqual({ name: 'Admin', password: 'a brand new password' });
      signedIn = true;
      await route.fulfill({ json: { signedIn: true, name: 'Admin', admin: true } });
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Set the Admin password' })).toBeVisible();
    await expect(page.getByLabel('Name')).toHaveAttribute('readonly', '');
    await page.getByLabel('New password').fill('short');
    await page.getByLabel('Repeat the password').fill('short');
    await page.getByRole('button', { name: 'Set password and sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Use at least 8 characters.');
    await page.getByLabel('New password').fill('a brand new password');
    await page.getByLabel('Repeat the password').fill('a different one!');
    await page.getByRole('button', { name: 'Set password and sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('The two passwords differ.');
    await page.getByLabel('Repeat the password').fill('a brand new password');
    await page.getByRole('button', { name: 'Set password and sign in' }).click();
    await expect(page.getByRole('heading', { name: /Set the Admin password/ })).toBeHidden();
  });
});

test('a session ended elsewhere brings back the sign-in card', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
  await page.route('**/api/**', route =>
    route.request().url().includes('/api/auth/session')
      ? route.fulfill({ json: { signedIn: false, setupRequired: false } })
      : route.fulfill({ status: 401, json: { message: 'Sign in first.' } }),
  );
  // Any API call answered with 401 (here a plain fetch, as many panels use) signs the dashboard out.
  await page.evaluate(() => fetch('/api/agents'));
  await expect(page.getByRole('heading', { name: 'Sign in to Agent Swarm' })).toBeVisible();
});
