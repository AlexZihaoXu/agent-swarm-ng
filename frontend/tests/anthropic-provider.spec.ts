import { test, expect } from './fixtures';
import { sampleAgents } from './sample-agents';

const KEY = 'sk-ant-api03-test-only';
const MODELS = ['claude-opus-4-8', 'claude-haiku-4-5'];

test('adds an Anthropic connection with an API key and lists its models', async ({ page }) => {
  let saved: Record<string, unknown> | undefined;
  const tests: Record<string, unknown>[] = [];
  await page.route('**/api/model-endpoints*', async route => {
    if (route.request().method() === 'POST') {
      const { id, name, baseUrl, kind, apiKey } = route.request().postDataJSON();
      expect(apiKey).toBe(KEY);
      saved = { id, name, baseUrl, kind, hasApiKey: true };
      await route.fulfill({ json: saved });
    } else await route.fulfill({ json: saved ? [saved] : [] });
  });
  await page.route('**/api/model-endpoints/test', async route => {
    tests.push(route.request().postDataJSON());
    await route.fulfill({ json: { models: MODELS } });
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Add Anthropic', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Anthropic');
  await expect(page.getByLabel('Base URL', { exact: true })).toHaveValue('https://api.anthropic.com');
  await expect(page.getByText('Anthropic · API key')).toBeVisible();
  // Anthropic's model metadata sets the limits: no endpoint-wide fields (each agent's row can still cap them).
  await expect(page.getByLabel('Context window (tokens)')).toHaveCount(0);
  await page.getByLabel('API key', { exact: true }).fill(KEY);
  await page.getByRole('button', { name: 'Test connection' }).click();
  const endpoints = page.getByRole('region', { name: 'API endpoints' });
  await expect(endpoints.getByRole('status')).toContainText('2 models');
  expect(tests).toEqual([{ baseUrl: 'https://api.anthropic.com', kind: 'anthropic', apiKey: KEY }]);
  await page.getByRole('button', { name: 'Save endpoint' }).click();
  await expect(page.getByLabel('API key', { exact: true })).toHaveCount(0);
  expect(saved).toMatchObject({ name: 'Anthropic', baseUrl: 'https://api.anthropic.com', kind: 'anthropic' });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Anthropic' })).toContainText('Anthropic · API key');
  await expect(page.getByLabel('API key', { exact: true })).toHaveAttribute(
    'placeholder',
    'Saved key — enter to replace',
  );
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(KEY);
});

test("an agent picks a model on its owner's Anthropic connection", async ({ page }) => {
  const agent = sampleAgents[0]!;
  const lists: Record<string, unknown>[] = [];
  await page.route('**/api/model-endpoints*', route =>
    route.fulfill({
      json: [
        {
          id: 'test-endpoint',
          name: 'Test endpoint',
          baseUrl: 'http://test.invalid/v1',
          kind: 'openai',
          hasApiKey: true,
        },
        { id: 'claude', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', kind: 'anthropic', hasApiKey: true },
      ],
    }),
  );
  await page.route('**/api/model-endpoints/test', route => {
    const body = route.request().postDataJSON();
    lists.push(body);
    return route.fulfill({ json: { models: body.endpointId === 'claude' ? MODELS : ['test-model'] } });
  });
  await page.route('**/api/agents/model-capabilities?*', route =>
    route.fulfill({
      json:
        new URL(route.request().url()).searchParams.get('endpointId') === 'claude'
          ? { thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], reasoning: true }
          : { thinkingLevels: ['off'], reasoning: false },
    }),
  );
  await page.route(/\/api\/agents(?:\?.*)?$/, route =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: { agents: sampleAgents.map(item => ({ ...item, lastMessage: null })), nextCursor: null },
        })
      : route.fallback(),
  );
  const saves: { models?: { endpointId: string; model: string; thinkingLevel: string }[] }[] = [];
  await page.route(`**/api/agents/${agent.id}`, route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const body = route.request().postDataJSON();
    saves.push(body);
    return route.fulfill({ json: { ...agent, models: body.models, activeModel: 0 } });
  });
  await page.goto(`/agents/${agent.id}`);
  const section = page
    .getByRole('region', { name: `Settings for ${agent.name}` })
    .getByRole('region', { name: 'Model' });
  const rows = section.getByRole('list', { name: 'Models in order of use' }).getByRole('listitem');
  await section.getByRole('button', { name: 'Add model' }).click();
  const added = rows.nth(1);
  await added.getByLabel('Endpoint', { exact: true }).click();
  await page.getByRole('option', { name: 'Anthropic', exact: true }).click();
  await added.getByLabel('Model', { exact: true }).click();
  await page.getByRole('option', { name: 'claude-opus-4-8', exact: true }).click();
  await added.getByLabel('Thinking level', { exact: true }).click();
  await page.getByRole('option', { name: 'High', exact: true }).click();
  await expect(added).toContainText('Anthropic · claude-opus-4-8 · High');
  expect(lists).toContainEqual(expect.objectContaining({ endpointId: 'claude', baseUrl: 'https://api.anthropic.com' }));
  await page
    .getByRole('region', { name: `Settings for ${agent.name}` })
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  await expect
    .poll(() => saves.at(-1)?.models?.[1])
    .toMatchObject({ endpointId: 'claude', model: 'claude-opus-4-8', thinkingLevel: 'high' });
});
