import { test, expect } from './fixtures';
import { sampleAgents } from './sample-agents';

const rename = async (page: import('@playwright/test').Page, menu: string, label: string, name: string) => {
  await page.getByRole('menuitem', { name: menu, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: menu });
  await expect(dialog.getByLabel(label)).toBeFocused();
  await dialog.getByLabel(label).fill(name);
  await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(dialog).toHaveCount(0);
};

test('renames an agent from its menu, and the settings follow', async ({ page }) => {
  const patches: unknown[] = [];
  await page.route('**/api/agents/avery', route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    patches.push(route.request().postDataJSON());
    return route.fulfill({ json: { ...sampleAgents[0], name: 'Avery Prime' } });
  });
  await page.goto('/agents/avery');
  await page.locator('aside[aria-label="Agents"] [data-agent-id="avery"]').first().click({ button: 'right' });
  await rename(page, 'Rename agent', 'Agent name', 'Avery Prime');
  expect(patches).toEqual([{ name: 'Avery Prime' }]);
  await expect(page.getByRole('region', { name: 'Model' }).getByLabel('Name')).toHaveValue('Avery Prime');
});

test('a taken computer name is explained in the dialog; a free one renames it', async ({ page }) => {
  let computer = { id: 'desk', name: 'Desk', state: 'running', createdAt: 0, cpuPercent: 0, memoryBytes: 0 };
  const puts: unknown[] = [];
  await page.route(/\/api\/computers(?:\?.*)?$/, route =>
    route.fulfill({ json: { controllerConnected: true, computers: [computer] } }),
  );
  await page.route('**/api/computers/desk/name', route => {
    const body = route.request().postDataJSON();
    puts.push(body);
    if (body.name === 'Lab')
      return route.fulfill({
        status: 409,
        json: { message: 'That computer name is already in use. Choose another name.' },
      });
    computer = { ...computer, name: body.name };
    return route.fulfill({ json: computer });
  });
  await page.goto('/computers');
  await page.getByRole('article', { name: 'Desk' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename computer' });
  await dialog.getByLabel('Computer name').fill('Lab');
  await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('already in use');
  await dialog.getByLabel('Computer name').fill('Studio');
  await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(puts).toEqual([{ name: 'Lab' }, { name: 'Studio' }]);
  await expect(page.getByRole('article', { name: 'Studio' })).toBeVisible();
});

test('renames a group chat from the chat list, keeping its members', async ({ page }) => {
  const members = sampleAgents
    .slice(0, 2)
    .map(agent => ({ id: agent.id, name: agent.name, avatar: null, channelId: agent.channelId }));
  const group = { id: 'team', name: 'Research team', createdAt: Date.now(), members, lastMessage: null };
  const patches: unknown[] = [];
  await page.route(/\/api\/groups(?:\?.*)?$/, route => route.fulfill({ json: { groups: [group], nextCursor: null } }));
  await page.route('**/api/groups/team', route => {
    if (route.request().method() !== 'PATCH') return route.fulfill({ json: group });
    patches.push(route.request().postDataJSON());
    return route.fulfill({ json: { ...group, name: 'Launch crew' } });
  });
  await page.goto('/chat');
  await page.locator('[data-chat-kind="group"][data-chat-id="team"]').first().click({ button: 'right' });
  await rename(page, 'Rename group chat', 'Group name', 'Launch crew');
  expect(patches).toEqual([{ name: 'Launch crew', agentIds: ['avery', 'morgan'] }]);
});
