import { test, expect } from './fixtures';

test('Settings supports ChatGPT device sign-in, cancellation, connection, and disconnect', async ({ page }) => {
  await page.route('**/api/model-endpoints*', route => route.fulfill({ json: [] }));
  let state = 'idle';
  let connected = false;
  await page.route(/\/api\/providers\/openai-codex(?:\/login)?$/, route => {
    if (route.request().method() === 'POST') state = 'waiting';
    if (route.request().method() === 'DELETE') {
      state = 'idle';
      connected = false;
    }
    return route.fulfill({
      json: {
        connected,
        models: connected ? ['test-codex'] : [],
        login:
          state === 'waiting'
            ? { state, userCode: 'TEST-CODE', verificationUri: 'https://auth.openai.com/codex/device' }
            : { state },
      },
    });
  });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Connect ChatGPT' }).click();
  await expect(page.getByLabel('One-time sign-in code')).toHaveValue('TEST-CODE');
  await expect(page.getByRole('link', { name: 'Open OpenAI sign-in' })).toHaveAttribute(
    'href',
    'https://auth.openai.com/codex/device',
  );
  await page.getByRole('button', { name: 'Cancel sign-in' }).click();
  await expect(page.getByLabel('One-time sign-in code')).toHaveCount(0);
  await page.getByRole('button', { name: 'Connect ChatGPT' }).click();
  await expect(page.getByLabel('One-time sign-in code')).toBeVisible();
  connected = true;
  state = 'connected';
  await expect(page.getByText('Connected to ChatGPT', { exact: true })).toBeVisible();
  await expect(page.getByLabel('One-time sign-in code')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain('TEST-CODE');
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect ChatGPT' })).toBeVisible();
});

test('connected Codex is available for agent creation without an API endpoint', async ({ page }) => {
  await page.route('**/api/model-endpoints*', route => route.fulfill({ json: [] }));
  await page.route('**/api/providers/openai-codex*', route =>
    route.fulfill({ json: { connected: true, models: ['test-codex'], login: { state: 'connected' } } }),
  );
  await page.route('**/api/agents/model-capabilities?*', route => {
    expect(new URL(route.request().url()).searchParams.get('endpointId')).toBe('provider:openai-codex');
    return route.fulfill({ json: { thinkingLevels: ['low', 'medium', 'high'], reasoning: true } });
  });
  await page.route('**/api/agents', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { agents: [], nextCursor: null } });
    expect(route.request().postDataJSON()).toMatchObject({
      endpointId: 'provider:openai-codex',
      model: 'test-codex',
      thinkingLevel: 'medium',
    });
    return route.fulfill({
      json: {
        ...route.request().postDataJSON(),
        id: 'codex-agent',
        channelId: 'codex-channel',
        createdAt: Date.now(),
        lastMessage: null,
      },
    });
  });
  await page.goto('/');
  await page
    .getByRole('complementary', { name: 'Agents', exact: true })
    .click({ button: 'right', position: { x: 40, y: 360 } });
  await page.getByRole('menuitem', { name: 'Create new agent' }).click();
  await page.getByLabel('Agent name', { exact: true }).fill('Codex agent');
  await page.getByLabel('Endpoint', { exact: true }).click();
  await page.getByRole('option', { name: 'OpenAI Codex (ChatGPT)' }).click();
  await page.getByLabel('Model', { exact: true }).click();
  await page.getByRole('option', { name: 'test-codex', exact: true }).click();
  await expect(page.getByLabel('Thinking level')).toContainText('Medium');
  await page.getByRole('button', { name: 'Create agent', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Settings for Codex agent' })).toBeVisible();
});
