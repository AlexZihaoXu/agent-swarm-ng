import { test, expect } from '@playwright/test';

async function openEndpoint(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Preferences' }).click();
  await page.getByRole('button', { name: 'Add endpoint', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Local model server');
  await page.getByLabel('Base URL', { exact: true }).fill('http://localhost:11434/v1');
}

test('endpoint form tests models and keeps credentials only in memory', async ({ page }) => {
  await page.route('**/api/model-endpoints/test', async route => {
    expect(route.request().postDataJSON()).toEqual({ baseUrl: 'http://localhost:11434/v1', apiKey: 'test-only-key' });
    await route.fulfill({ json: { models: ['local-chat', 'local-code'] } });
  });
  await openEndpoint(page);
  const key = page.getByLabel('API key', { exact: true });
  await expect(key).toHaveAttribute('type', 'password');
  await key.fill('test-only-key');
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByRole('status')).toContainText('Connected');
  await expect(page.getByRole('status')).toContainText('2 models');
  await page.getByText('View models', { exact: true }).click();
  await expect(page.getByText('local-chat', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Agents', exact: true }).click();
  await page.getByRole('tab', { name: 'Preferences' }).click();
  await expect(key).toHaveValue('test-only-key');
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain('test-only-key');
  await page.reload();
  await page.getByRole('tab', { name: 'Preferences' }).click();
  await expect(page.getByText('No endpoints yet')).toBeVisible();
});

test('endpoint testing reports errors and config changes clear the result', async ({ page }) => {
  await page.route('**/api/model-endpoints/test', route => route.fulfill({ status: 502, json: { message: 'Endpoint returned HTTP 401. Check the base URL and API key.' } }));
  await openEndpoint(page);
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByRole('alert')).toContainText('401');
  await page.getByLabel('API key', { exact: true }).fill('replacement');
  await expect(page.getByRole('alert')).not.toBeVisible();
  await page.getByRole('button', { name: 'Remove endpoint' }).click();
  await expect(page.getByText('No endpoints yet')).toBeVisible();
});

test('endpoint test shows loading and supports a small viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/model-endpoints/test', async route => {
    await wait;
    await route.fulfill({ json: { models: [] } });
  });
  await openEndpoint(page);
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByRole('button', { name: 'Testing…' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  release();
  await expect(page.getByRole('status')).toContainText('Connected');
  await expect(page.getByRole('status')).toContainText('0 models');
});
