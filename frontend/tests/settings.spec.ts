import { test, expect } from './fixtures';

test.beforeEach(async ({ page }) => {
  // Never load or modify the developer's actual saved endpoint settings.
  await page.route('**/api/model-endpoints', route => route.fulfill({ json: [] }));
});

async function openEndpoint(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Add endpoint', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Local model server');
  await page.getByLabel('Base URL', { exact: true }).fill('http://localhost:11434/v1');
}

test('unsaved endpoint form tests models and clears on refresh', async ({ page }) => {
  await page.route('**/api/model-endpoints/test', async route => {
    expect(route.request().postDataJSON()).toEqual({ baseUrl: 'http://localhost:11434/v1', apiKey: 'test-only-key' });
    await route.fulfill({ json: { models: ['local-chat', 'local-code'] } });
  });
  await openEndpoint(page);
  const key = page.getByLabel('API key', { exact: true });
  await expect(key).toHaveAttribute('type', 'password');
  await key.fill('test-only-key');
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByRole('region', { name: 'API endpoints' }).getByRole('status')).toContainText('Connected');
  await expect(page.getByRole('region', { name: 'API endpoints' }).getByRole('status')).toContainText('2 models');
  await page.getByText('View models', { exact: true }).click();
  await expect(page.getByText('local-chat', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Agents', exact: true }).click();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(key).toHaveValue('test-only-key');
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain('test-only-key');
  await page.reload();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByText('No endpoints yet')).toBeVisible();
});

test('saving restores endpoint metadata after refresh without exposing its key', async ({ page }) => {
  let saved: { id: string; name: string; baseUrl: string; hasApiKey: boolean } | undefined;
  await page.route('**/api/model-endpoints', async route => {
    if (route.request().method() === 'POST') {
      const { id, name, baseUrl, apiKey } = route.request().postDataJSON();
      expect(apiKey).toBe('saved-test-key');
      saved = { id, name, baseUrl, hasApiKey: true };
      await route.fulfill({ json: saved });
    } else await route.fulfill({ json: saved ? [saved] : [] });
  });
  await openEndpoint(page);
  await page.getByLabel('API key', { exact: true }).fill('saved-test-key');
  await page.getByRole('button', { name: 'Save endpoint' }).click();
  await expect(page.getByRole('region', { name: 'API endpoints' }).getByRole('status')).toHaveText('Saved locally.');
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue('');
  await page.reload();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Local model server');
  await expect(page.getByLabel('API key', { exact: true })).toHaveAttribute(
    'placeholder',
    'Saved key — enter to replace',
  );
  await page.route('**/api/model-endpoints/test', async route => {
    expect(route.request().postDataJSON()).toEqual({ endpointId: saved!.id, baseUrl: saved!.baseUrl });
    await route.fulfill({ json: { models: ['example'] } });
  });
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByRole('region', { name: 'API endpoints' }).getByRole('status')).toContainText('Connected');
});

for (const width of [390, 1280])
  test(`OpenRouter preset uses existing secure endpoint flow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let saved: { id: string; name: string; baseUrl: string; hasApiKey: boolean } | undefined;
    await page.route('**/api/model-endpoints', async route => {
      if (route.request().method() === 'POST') {
        const { id, name, baseUrl, apiKey } = route.request().postDataJSON();
        expect(apiKey).toBe('sk-or-test-only');
        expect(baseUrl).toBe('https://openrouter.ai/api/v1');
        saved = { id, name, baseUrl, hasApiKey: true };
        await route.fulfill({ json: saved });
      } else await route.fulfill({ json: saved ? [saved] : [] });
    });
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Add OpenRouter', exact: true }).click();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('OpenRouter');
    await expect(page.getByLabel('Base URL', { exact: true })).toHaveValue('https://openrouter.ai/api/v1');
    await expect(page.getByText('OpenRouter · API credits')).toBeVisible();
    await page.getByLabel('API key', { exact: true }).fill('sk-or-test-only');
    await page.getByRole('button', { name: 'Save endpoint' }).click();
    await expect(page.getByLabel('API key', { exact: true })).toHaveValue('');
    await page.reload();
    await expect(page.getByLabel('API key', { exact: true })).toHaveAttribute(
      'placeholder',
      'Saved key — enter to replace',
    );
    expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain('sk-or-test-only');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

test('endpoint testing reports errors and config changes clear the result', async ({ page }) => {
  await page.route('**/api/model-endpoints/test', route =>
    route.fulfill({ status: 502, json: { message: 'Endpoint returned HTTP 401. Check the base URL and API key.' } }),
  );
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
  const wait = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route('**/api/model-endpoints/test', async route => {
    await wait;
    await route.fulfill({ json: { models: [] } });
  });
  await openEndpoint(page);
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByRole('button', { name: 'Testing…' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  release();
  await expect(page.getByRole('region', { name: 'API endpoints' }).getByRole('status')).toContainText('Connected');
  await expect(page.getByRole('region', { name: 'API endpoints' }).getByRole('status')).toContainText('0 models');
});
