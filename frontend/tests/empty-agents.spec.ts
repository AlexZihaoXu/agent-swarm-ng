import { test, expect } from './fixtures';

test('an empty database shows no sample agents or conversations, including after refresh', async ({ page }) => {
  await page.route('**/api/agents', route => route.fulfill({ json: { agents: [], nextCursor: null } }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Open conversation with / })).toHaveCount(0);
  await expect(page.getByText('No agents yet. Right-click here to create one.', { exact: true })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Message composer' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('No agents yet. Right-click here to create one.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Open conversation with / })).toHaveCount(0);
  await page.getByRole('complementary', { name: 'Agents', exact: true }).click({ button: 'right', position: { x: 40, y: 200 } });
  await expect(page.getByRole('menuitem', { name: 'Create new agent' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete agent' })).toHaveCount(0);
});
