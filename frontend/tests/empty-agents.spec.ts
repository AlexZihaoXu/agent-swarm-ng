import { test, expect } from './fixtures';

test('an empty database shows no sample agents or conversations, including after refresh', async ({ page }) => {
  await page.route('**/api/agents', route => route.fulfill({ json: { agents: [], nextCursor: null } }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Open conversation with / })).toHaveCount(0);
  await expect(page.getByText('No agents yet. Use + to create one.', { exact: true })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Message composer' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('No agents yet. Use + to create one.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Open conversation with / })).toHaveCount(0);
  await page
    .getByRole('complementary', { name: 'Agents', exact: true })
    .click({ button: 'right', position: { x: 40, y: 200 } });
  await expect(page.getByRole('menuitem', { name: 'Create new agent' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete agent' })).toHaveCount(0);
});

test('phones show the same empty state under the picker bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/agents', route => route.fulfill({ json: { agents: [], nextCursor: null } }));
  await page.goto('/agents');
  const empty = page.getByRole('region', { name: 'No agent selected' });
  await expect(empty).toBeVisible();
  await expect(empty.getByText('Select or create an agent to configure.')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Agent' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Create new agent' })).toBeVisible();
  // The page's own empty state replaces the panel's note on phones.
  await expect(page.getByText('No agents yet. Use + to create one.', { exact: true })).toBeHidden();
  await expect(page.getByRole('tablist', { name: 'Main navigation' })).toBeVisible();
  await empty.getByRole('button', { name: 'Create agent' }).click();
  await expect(page).toHaveURL(/\/agents\/new$/);
  await expect(page.getByLabel('Agent name')).toBeVisible();
});
