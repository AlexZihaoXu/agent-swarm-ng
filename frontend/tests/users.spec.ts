import { test, expect } from './fixtures';

test('admin adds a user with their organization, caps their RAM, and deletes them', async ({ page }) => {
  await page.goto('/settings');
  const users = page.getByRole('region', { name: 'Users' });
  await users.getByLabel('New user’s name').fill('Sam Test');
  await users.getByLabel('Password', { exact: true }).fill('a long password');
  await users.getByLabel('RAM cap (GiB)').fill('8');
  await users.getByRole('button', { name: 'Add user' }).click();
  const row = users.getByRole('row').filter({ hasText: 'Sam Test' });
  await expect(row).toContainText("Sam Test's Organization");
  await expect(row.getByLabel('RAM cap of Sam Test (GiB, empty for none)')).toHaveValue('8');
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  // The password field is not a login form: password managers must not fill it.
  await expect(users.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await row.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete user' }).click();
  await expect(users.getByRole('row').filter({ hasText: 'Sam Test' })).toHaveCount(0);
  await expect(users.getByRole('status')).toContainText('their organizations are yours');
});

test("admin's switcher lists everyone's organizations in sections", async ({ page }) => {
  const org = (id: string, name: string, ownerName: string) => ({
    id,
    name,
    ownerId: ownerName,
    ownerName,
    createdAt: '2026-10-04T00:00:00.000Z',
    agents: 0,
    computers: 0,
    groups: 0,
  });
  await page.route('**/api/organizations', route =>
    route.fulfill({
      json: { organizations: [org('personal', 'Personal', 'Admin'), org('sam', "Sam's Organization", 'Sam')] },
    }),
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/agents');
  await page.getByRole('button', { name: /^Organization:/ }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByText('Your organizations')).toBeVisible();
  await expect(menu.getByText("Sam's organizations")).toBeVisible();
  await expect(menu.getByRole('group', { name: "Sam's organizations" }).getByRole('menuitem')).toHaveText(
    /Sam's Organization/,
  );
});

test("a user's Settings show only their own account, connections, organizations and Knowledge", async ({ page }) => {
  await page.route('**/api/auth/session', route =>
    route.fulfill({ json: { signedIn: true, name: 'Sam', admin: false, timeZone: 'UTC' } }),
  );
  await page.goto('/settings');
  for (const title of ['Account', 'API endpoints', 'Swarm Knowledge'])
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  for (const title of ['Users', 'Security', 'Audit log', 'Swarm', 'Computer storage'])
    await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
});
