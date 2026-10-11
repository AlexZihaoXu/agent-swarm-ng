import { test, expect } from './fixtures';

test('an empty database shows no sample agents or conversations, including after refresh', async ({ page }) => {
  await page.route('**/api/agents', route => route.fulfill({ json: { agents: [], nextCursor: null } }));
  await page.goto('/');
  await expect(page).toHaveURL(/\/chat$/);
  const empty = page.getByText('No agents yet. Create one here, or right-click the list for agents and group chats.');
  await expect(page.getByRole('button', { name: /^Open conversation with / })).toHaveCount(0);
  await expect(empty).toBeVisible();
  await expect(page.getByRole('form', { name: 'Message composer' })).toHaveCount(0);
  await page.reload();
  await expect(empty).toBeVisible();
  await expect(page.getByRole('button', { name: /^Open conversation with / })).toHaveCount(0);
  await page
    .getByRole('complementary', { name: 'Chats', exact: true })
    .click({ button: 'right', position: { x: 40, y: 300 } });
  await expect(page.getByRole('menuitem', { name: 'Create new agent' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete agent' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Agent settings' })).toHaveCount(0);
});

test('phones offer creating the first agent from the empty chat list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/agents', route => route.fulfill({ json: { agents: [], nextCursor: null } }));
  await page.goto('/agents');
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole('tablist', { name: 'Main navigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Create agent', exact: true }).click();
  await expect(page).toHaveURL(/\/agents\/new$/);
  await expect(page.getByLabel('Agent name')).toBeVisible();
});
