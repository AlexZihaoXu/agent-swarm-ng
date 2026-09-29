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
  // A successful save folds the card to its summary; the key itself is never shown.
  await expect(page.getByLabel('API key', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'API endpoints' })).toContainText('key saved');
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveAttribute('aria-expanded', 'false');
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
    await expect(page.getByLabel('API key', { exact: true })).toHaveCount(0);
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

test('saved endpoints rest collapsed; Edit expands, and Cancel reverts unsaved changes', async ({ page }) => {
  const saved = { id: 'kept', name: 'Kept server', baseUrl: 'http://127.0.0.1:9000/v1', hasApiKey: false };
  await page.route('**/api/model-endpoints', route => route.fulfill({ json: [saved] }));
  await page.goto('/settings');
  const card = page.getByRole('region', { name: 'Kept server' });
  await expect(card).toContainText('http://127.0.0.1:9000/v1');
  await expect(card.getByLabel('Base URL', { exact: true })).toHaveCount(0);
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(card.getByLabel('Base URL', { exact: true })).toHaveValue('http://127.0.0.1:9000/v1');
  await expect(card.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await card.getByLabel('Name', { exact: true }).fill('Renamed');
  await page.getByRole('region', { name: 'Renamed' }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(card.getByLabel('Base URL', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Kept server' })).toBeVisible();
});

test('Settings → Swarm edits limits within their bounds, saves only changes, and discards drafts', async ({ page }) => {
  const bounds = {
    maxComputers: { min: 1, max: 100, default: 4, label: 'Computers', unit: '' },
    uploadMaxMb: { min: 1, max: 1024, default: 100, label: 'Largest chat file', unit: 'MB' },
    scratchFileMaxKb: { min: 16, max: 16384, default: 1024, label: 'Largest scratch file', unit: 'KB' },
    scratchMaxFiles: { min: 10, max: 10000, default: 500, label: 'Scratch files per agent', unit: '' },
    scratchTotalMb: { min: 1, max: 10240, default: 50, label: 'Scratch space per agent', unit: 'MB' },
    storageBudgetGb: { min: 1, max: 10000, default: 10, label: 'Total file storage', unit: 'GB' },
  };
  // In-memory settings: the shared test backend's real settings stay untouched.
  let settings = Object.fromEntries(Object.entries(bounds).map(([key, bound]) => [key, bound.default]));
  const patches: object[] = [];
  await page.route('**/api/settings/swarm', async route => {
    if (route.request().method() === 'PATCH') {
      patches.push(route.request().postDataJSON());
      settings = { ...settings, ...route.request().postDataJSON() };
    }
    await route.fulfill({ json: { settings, bounds } });
  });
  await page.goto('/settings');
  const swarm = page.getByRole('region', { name: 'Swarm' });
  const computers = swarm.getByLabel('Computers', { exact: true });
  await expect(computers).toHaveValue('4');
  const save = swarm.getByRole('button', { name: 'Save changes' });
  await expect(save).toBeDisabled();
  await swarm.getByRole('button', { name: 'Increase Computers' }).click();
  await swarm.getByLabel('Largest chat file (MB)', { exact: true }).fill('0');
  await expect(swarm.getByRole('alert')).toContainText('Largest chat file must be a whole number from 1 to 1024.');
  await expect(save).toBeDisabled();
  await swarm.getByLabel('Largest chat file (MB)', { exact: true }).fill('250');
  await save.click();
  await expect(swarm.getByRole('status')).toHaveText('Saved.');
  expect(patches).toEqual([{ maxComputers: 5, uploadMaxMb: 250 }]);
  await swarm.getByLabel('Total file storage (GB)', { exact: true }).fill('20');
  await swarm.getByRole('button', { name: 'Discard changes' }).click();
  await expect(swarm.getByLabel('Total file storage (GB)', { exact: true })).toHaveValue('10');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Swarm' }).getByLabel('Computers', { exact: true })).toHaveValue('5');
});
