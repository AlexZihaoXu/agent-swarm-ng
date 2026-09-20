import { test, expect } from '@playwright/test';

test('dashboard connects to the backend', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Agent Swarm v2' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Backend connected');
  await expect(page.getByRole('heading')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Check connection' })).toHaveCount(0);
});

test('dashboard reports an unavailable backend', async ({ page }) => {
  await page.route('**/api/health', route => route.abort());
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('Disconnected');
});
