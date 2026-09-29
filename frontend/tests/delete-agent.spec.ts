import { test, expect } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/model-endpoints', route => route.fulfill({ json: [] }));
});

const agent = {
  id: 'delete-agent',
  name: 'Delete me',
  endpointId: 'endpoint',
  model: 'test-model',
  thinkingLevel: 'off',
  channelId: 'delete-channel',
  createdAt: Date.now(),
  lastMessage: null,
};

test('requires exact typed confirmation, supports cancellation, and persists deletion', async ({ page }) => {
  let deleted = false;
  let attempts = 0;
  await page.route('**/api/agents', route =>
    route.fulfill({ json: { agents: deleted ? [] : [agent], nextCursor: null } }),
  );
  await page.route('**/api/channels/*/messages*', route => route.fulfill({ json: { messages: [], nextCursor: null } }));
  await page.route(`**/api/agents/${agent.id}`, async route => {
    attempts++;
    expect(route.request().method()).toBe('DELETE');
    expect(route.request().postDataJSON()).toEqual({ confirmation: agent.name });
    if (attempts === 1)
      return route.fulfill({ status: 409, json: { message: 'The agent is responding. Stop it before deleting.' } });
    deleted = true;
    return route.fulfill({ json: { deleted: true } });
  });
  await page.goto('/');
  const card = page.getByRole('button', { name: `Open settings for ${agent.name}`, exact: true });
  await card.click();
  await card.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete agent', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete agent', exact: true });
  const remove = dialog.getByRole('button', { name: 'Delete agent', exact: true });
  await expect(remove).toBeDisabled();
  await page.screenshot({ path: '../.scratch/agent-delete-dialog.png', animations: 'disabled' });
  await page.getByLabel('Confirm agent name').fill(`${agent.name} `);
  await expect(remove).toBeDisabled();
  await page.getByLabel('Confirm agent name').fill(agent.name);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(attempts).toBe(0);
  await expect(card).toBeFocused();
  await card.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Delete agent', exact: true }).click();
  await expect(page.getByLabel('Confirm agent name')).toHaveValue('');
  await page.getByLabel('Confirm agent name').fill(agent.name);
  await remove.click();
  await expect(dialog.getByRole('alert')).toContainText('Stop it');
  await expect(
    page.getByRole('button', { name: `Open settings for ${agent.name}`, exact: true, includeHidden: true }),
  ).toBeVisible();
  await remove.click();
  await expect(dialog).toHaveCount(0);
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Agents', exact: true })).toBeFocused();
  await expect(page.getByText('Select or create an agent to configure.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(card).toHaveCount(0);
  expect(attempts).toBe(2);
});

test('deleting an unselected saved agent does not change selection; last deletion shows an empty state', async ({
  page,
}) => {
  await page.goto('/');
  const cards = page.getByRole('button', { name: /^Open settings for / });
  await expect(cards.first()).toBeVisible();
  const names = await cards.evaluateAll(elements =>
    elements.map(element => element.getAttribute('aria-label')!.replace('Open settings for ', '')),
  );
  for (const name of [...names.slice(1), names[0]]) {
    await page.getByRole('button', { name: `Open settings for ${name}`, exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete agent', exact: true }).click();
    await page.getByLabel('Confirm agent name').fill(name);
    await page.getByRole('dialog').getByRole('button', { name: 'Delete agent', exact: true }).click();
    if (name !== names[0]) await expect(page.getByRole('region', { name: `Settings for ${names[0]}` })).toBeVisible();
  }
  await expect(cards).toHaveCount(0);
  await expect(page.getByText('Select or create an agent to configure.', { exact: true })).toBeVisible();
});

test('cancelling a delete keeps its own content while the dialog animates closed', async ({ page }) => {
  await page.route('**/api/agents', route => route.fulfill({ json: { agents: [agent], nextCursor: null } }));
  await page.route('**/api/channels/*/messages*', route => route.fulfill({ json: { messages: [], nextCursor: null } }));
  await page.goto('/');
  const card = page.getByRole('button', { name: `Open settings for ${agent.name}`, exact: true });
  await card.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete agent', exact: true }).click();
  await expect(page.getByLabel('Confirm agent name')).toBeVisible();
  // Watch every frame of the close: the other (Create agent) form must never show.
  await page.evaluate(() => {
    (window as unknown as { createSeen: boolean }).createSeen = false;
    const watch = () => {
      if (document.querySelector('[role="dialog"]')?.textContent?.includes('Create new agent'))
        (window as unknown as { createSeen: boolean }).createSeen = true;
      requestAnimationFrame(watch);
    };
    watch();
  });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { createSeen: boolean }).createSeen)).toBe(false);
});
