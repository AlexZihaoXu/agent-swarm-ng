import { test, expect } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/model-endpoints*', route => route.fulfill({ json: [] }));
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
  // Wide screens: the picker's area carries the selected agent, and its context menu deletes that one.
  const picker = page.getByRole('combobox', { name: 'Agent' });
  const card = page.locator(`aside[aria-label="Agents"] [data-agent-id="${agent.id}"]`).first();
  await expect(picker).toContainText(agent.name);
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
  await expect(picker).toBeFocused();
  await picker.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Delete agent', exact: true }).click();
  await expect(page.getByLabel('Confirm agent name')).toHaveValue('');
  await page.getByLabel('Confirm agent name').fill(agent.name);
  await remove.click();
  await expect(dialog.getByRole('alert')).toContainText('Stop it');
  await expect(page.getByRole('combobox', { name: 'Agent', includeHidden: true })).toContainText(agent.name);
  await remove.click();
  await expect(dialog).toHaveCount(0);
  await expect(card).toHaveCount(0);
  await expect(picker).toBeDisabled();
  await expect(page.getByRole('complementary', { name: 'Agents', exact: true })).toBeFocused();
  await expect(page.getByText('Select or create an agent to configure.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(card).toHaveCount(0);
  await expect(picker).toBeDisabled();
  expect(attempts).toBe(2);
});

test('deleting an unselected saved agent does not change selection; last deletion shows an empty state', async ({
  page,
}) => {
  // Only the phone list offers every agent's own menu; wide screens act on the selected agent.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/agents');
  const cards = page.getByRole('button', { name: /^Open settings for / });
  await expect(cards.first()).toBeVisible();
  const names = await cards.evaluateAll(elements =>
    elements.map(element => element.getAttribute('aria-label')!.replace('Open settings for ', '')),
  );
  for (const name of names.slice(1)) {
    await page.getByRole('button', { name: `Open settings for ${name}`, exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete agent', exact: true }).click();
    await page.getByLabel('Confirm agent name').fill(name);
    await page.getByRole('dialog').getByRole('button', { name: 'Delete agent', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Open settings for ${name}`, exact: true })).toHaveCount(0);
  }
  await expect(cards).toHaveCount(1);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/agents');
  const settings = page.getByRole('region', { name: `Settings for ${names[0]}` });
  await expect(settings).toBeVisible();
  await page.locator('aside[aria-label="Agents"] [data-agent-id]').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete agent', exact: true }).click();
  await page.getByLabel('Confirm agent name').fill(names[0]);
  await page.getByRole('dialog').getByRole('button', { name: 'Delete agent', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Agent' })).toBeDisabled();
  await expect(page.getByText('Select or create an agent to configure.', { exact: true })).toBeVisible();
});

test('cancelling a delete keeps its own content while the dialog animates closed', async ({ page }) => {
  await page.route('**/api/agents', route => route.fulfill({ json: { agents: [agent], nextCursor: null } }));
  await page.route('**/api/channels/*/messages*', route => route.fulfill({ json: { messages: [], nextCursor: null } }));
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: 'Agent' })).toContainText(agent.name);
  // The panel's section list belongs to the selected agent too: its menu offers that agent's delete.
  await page
    .getByRole('navigation', { name: 'Jump to section' })
    .getByRole('link', { name: 'Model' })
    .click({ button: 'right' });
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
