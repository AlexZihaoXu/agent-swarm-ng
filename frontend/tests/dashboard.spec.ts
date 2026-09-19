import { test, expect } from '@playwright/test';

test('dashboard connects to the backend', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Agent Swarm v2' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Backend connected');
  await expect(page.getByText('Container management and optional desktop streaming are not implemented yet.')).toBeVisible();
});

test('dashboard reports an unavailable backend', async ({ page }) => {
  await page.route('**/api/health', route => route.abort());
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('Disconnected');
});
