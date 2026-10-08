import { test, expect, type Page } from './fixtures';
import { sampleAgents } from './sample-agents';

const first = sampleAgents[0]!.models[0]!;
const backup = {
  endpointId: 'backup',
  model: 'gpt-5',
  thinkingLevel: 'off' as const,
  attempts: 3,
  tooBig: 'skip' as const,
  comeBack: 5,
};

async function mocks(page: Page, agent = sampleAgents[0]!) {
  await page.route('**/api/model-endpoints*', route =>
    route.fulfill({
      json: [
        { id: 'test-endpoint', name: 'Test endpoint', baseUrl: 'http://test.invalid/v1', hasApiKey: true },
        { id: 'backup', name: 'Backup', baseUrl: 'http://backup.invalid/v1', hasApiKey: true },
      ],
    }),
  );
  await page.route('**/api/model-endpoints/test', route =>
    route.fulfill({ json: { models: ['test-model', 'gpt-5'] } }),
  );
  await page.route('**/api/agents/model-capabilities?*', route =>
    route.fulfill({ json: { thinkingLevels: ['off'], reasoning: false } }),
  );
  await page.route(/\/api\/agents(?:\?.*)?$/, route =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: {
            agents: [agent, ...sampleAgents.slice(1)].map(item => ({ ...item, lastMessage: null })),
            nextCursor: null,
          },
        })
      : route.fallback(),
  );
}

test('ranks fallback models: add one, move it up with the grip, and save the list', async ({ page }) => {
  await mocks(page);
  const saves: { models?: unknown[] }[] = [];
  await page.route('**/api/agents/avery', route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const body = route.request().postDataJSON();
    saves.push(body);
    return route.fulfill({ json: { ...sampleAgents[0], models: body.models, activeModel: 0 } });
  });
  await page.goto('/agents/avery');
  const settings = page.getByRole('region', { name: 'Settings for Avery' });
  const section = settings.getByRole('region', { name: 'Model' });
  const rows = section.getByRole('list', { name: 'Models in order of use' }).getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('#1');
  await expect(rows.first()).toContainText('Test endpoint · test-model · Off');
  // The only model cannot be removed (an open row moves or removes it).
  await rows.first().getByRole('button', { name: /^#1/ }).click();
  await expect(section.getByRole('button', { name: 'Remove #1' })).toBeDisabled();

  await section.getByRole('button', { name: 'Add model' }).click();
  await expect(rows).toHaveCount(2);
  // The new row opens to choose its model.
  const added = rows.nth(1);
  await added.getByLabel('Endpoint', { exact: true }).click();
  await page.getByRole('option', { name: 'Backup', exact: true }).click();
  await added.getByLabel('Model', { exact: true }).click();
  await page.getByRole('option', { name: 'gpt-5', exact: true }).click();
  await expect(rows.nth(1)).toContainText('Backup · gpt-5 · Off');
  // A lower model offers what to do when the chat is too big for it; the last one has nothing to come back from.
  await expect(added.getByLabel('If the chat is too big for it')).toBeVisible();
  await expect(added.getByLabel('Come back to it after it fails')).toHaveCount(0);

  // Rank it first from the keyboard on its grip.
  await section.getByRole('button', { name: 'Move #2 (drag, or use the arrow keys)' }).focus();
  await page.keyboard.press('ArrowUp');
  await expect(rows.first()).toContainText('Backup · gpt-5');
  await expect(rows.nth(1)).toContainText('Test endpoint · test-model');

  await settings.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => saves).toEqual([{ models: [backup, first] }]);
});

test('ranks by dragging the grip', async ({ page }) => {
  await mocks(page, { ...sampleAgents[0]!, models: [first, backup] });
  await page.goto('/agents/avery');
  const section = page.getByRole('region', { name: 'Settings for Avery' }).getByRole('region', { name: 'Model' });
  const rows = section.getByRole('list', { name: 'Models in order of use' }).getByRole('listitem');
  await expect(rows).toHaveCount(2);
  // Hovering waits for the grip to settle (the settings page animates in).
  const grip = section.getByRole('button', { name: 'Move #1 (drag, or use the arrow keys)' });
  await grip.hover();
  await page.mouse.down();
  const box = (await grip.boundingBox())!;
  const second = (await rows.nth(1).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, second.y + second.height - 4, { steps: 8 });
  await page.mouse.up();
  await expect(rows.first()).toContainText('Backup · gpt-5');
  await expect(rows.nth(1)).toContainText('Test endpoint · test-model');
});

test('shows the model in use after a fallback and switches back to #1', async ({ page }) => {
  await mocks(page, { ...sampleAgents[0]!, models: [first, backup], activeModel: 1 });
  let reset = 0;
  await page.route('**/api/agents/avery/models/first', route => {
    reset++;
    return route.fulfill({ json: { ...sampleAgents[0], models: [first, backup], activeModel: 0 } });
  });
  await page.goto('/agents/avery');
  const section = page.getByRole('region', { name: 'Settings for Avery' }).getByRole('region', { name: 'Model' });
  await expect(section.getByRole('status')).toContainText('On #2 since #1 failed');
  await expect(section.getByRole('listitem').nth(1)).toContainText('In use');
  await section.getByRole('button', { name: 'Use #1 again' }).click();
  await expect.poll(() => reset).toBe(1);
  await expect(section.getByText('On #2 since #1 failed')).toHaveCount(0);
  await expect(section.getByText('In use')).toHaveCount(0);
});
