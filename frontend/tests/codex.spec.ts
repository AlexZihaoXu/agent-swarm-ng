import { test, expect, codexAccounts, openCreateAgent } from './fixtures';

test('Settings supports ChatGPT device sign-in, cancellation, connection, and disconnect', async ({ page }) => {
  await page.route('**/api/model-endpoints*', route => route.fulfill({ json: [] }));
  let state = 'idle';
  let connected = false;
  const status = () => ({
    connected,
    models: connected ? ['test-codex'] : [],
    login:
      state === 'waiting'
        ? { state, userCode: 'TEST-CODE', verificationUri: 'https://auth.openai.com/codex/device' }
        : { state },
  });
  await page.route(/\/api\/providers\/openai-codex(?:\/login)?$/, route => {
    if (route.request().method() === 'POST') state = 'waiting';
    if (route.request().method() === 'DELETE') {
      state = 'idle';
      connected = false;
    }
    return route.fulfill({ json: status() });
  });
  await page.route(/\/api\/providers\/openai-codex\/accounts$/, route =>
    route.fulfill({ json: codexAccounts([status()]) }),
  );
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
  await page.route(/\/api\/providers\/openai-codex\/accounts(?:\?.*)?$/, route =>
    route.fulfill({ json: codexAccounts([{ connected: true, models: ['test-codex'] }]) }),
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
  await openCreateAgent(page);
  await page.getByLabel('Agent name', { exact: true }).fill('Codex agent');
  await page.getByLabel('Endpoint', { exact: true }).click();
  await page.getByRole('option', { name: 'OpenAI Codex (ChatGPT)' }).click();
  await page.getByLabel('Model', { exact: true }).click();
  await page.getByRole('option', { name: 'test-codex', exact: true }).click();
  await expect(page.getByLabel('Thinking level')).toContainText('Medium');
  await page.getByRole('button', { name: 'Create agent', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Conversation with Codex agent' })).toBeVisible();
});

test('each ChatGPT account is its own card and its own connection for agents', async ({ page }) => {
  await page.route('**/api/model-endpoints*', route => route.fulfill({ json: [] }));
  const accounts = [
    { connected: true, models: ['test-codex'], email: 'first@example.com', plan: 'plus' },
  ] as Parameters<typeof codexAccounts>[0];
  let removed = '';
  await page.route(/\/api\/providers\/openai-codex\/accounts(?:\/[0-9a-f]+)?(?:\?.*)?$/, route => {
    const method = route.request().method();
    if (method === 'POST') accounts.push({ connected: false, models: [] });
    if (method === 'DELETE') {
      removed = new URL(route.request().url()).pathname.split('/').pop()!;
      accounts.pop();
    }
    return route.fulfill({ json: codexAccounts(accounts) });
  });
  await page.route(/\/api\/providers\/openai-codex\/login\?account=a0000001$/, route => {
    accounts[1] = { connected: true, models: ['test-codex-mini'], email: 'second@example.com' };
    return route.fulfill({ json: { connected: true, models: [], login: { state: 'connected' } } });
  });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByText('first@example.com · Plus plan')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add ChatGPT account' }).click();
  const second = page.getByRole('group', { name: 'ChatGPT account 2' });
  await second.getByRole('button', { name: 'Connect ChatGPT' }).click();
  await expect(second.getByText('second@example.com')).toBeVisible();

  // Both accounts are offered for an agent's model, each with its own models.
  await page.route('**/api/agents/model-capabilities?*', route =>
    route.fulfill({ json: { thinkingLevels: ['low', 'medium'], reasoning: true } }),
  );
  await page.goto('/');
  await openCreateAgent(page);
  await page.getByLabel('Endpoint', { exact: true }).click();
  await expect(page.getByRole('option', { name: 'OpenAI Codex (ChatGPT) · first@example.com' })).toBeVisible();
  await page.getByRole('option', { name: 'OpenAI Codex (ChatGPT) · second@example.com' }).click();
  await page.getByLabel('Model', { exact: true }).click();
  await expect(page.getByRole('option', { name: 'test-codex-mini', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'test-codex', exact: true })).toHaveCount(0);

  await page.goto('/');
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('group', { name: 'ChatGPT account 2' }).getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('button', { name: 'Remove account' }).click();
  await expect(page.getByRole('group', { name: 'ChatGPT account 2' })).toHaveCount(0);
  expect(removed).toBe('a0000001');
});
