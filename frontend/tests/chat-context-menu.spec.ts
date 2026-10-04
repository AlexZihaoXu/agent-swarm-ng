import { test, expect } from './fixtures';
import { sampleAgents } from './sample-agents';

test('agent cards keep the same avatar and presence sizes in Chat and Agents', async ({ page }) => {
  // Agent cards are the phone Agents list; wide screens choose agents from a picker.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/agents');
  const agentCard = page
    .getByRole('complementary', { name: 'Agents' })
    .getByRole('button', { name: 'Open settings for Avery' });
  const agentFace = await agentCard.locator('span.relative').first().boundingBox();
  const agentDot = await agentCard.locator('[data-slot="online-indicator"]').boundingBox();
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  const chatCard = page
    .getByRole('complementary', { name: 'Chats' })
    .getByRole('button', { name: 'Open conversation with Avery' });
  const chatFace = await chatCard.getByTestId('chat-avatar').boundingBox();
  const chatDot = await chatCard.locator('[data-slot="online-indicator"]').boundingBox();
  // Sub-pixel noise is possible while the tab entrance animation settles.
  expect(chatFace!.width).toBeCloseTo(agentFace!.width, 1);
  expect(chatFace!.height).toBeCloseTo(agentFace!.height, 1);
  expect(chatDot!.width).toBeCloseTo(agentDot!.width, 1);
  expect(chatDot!.height).toBeCloseTo(agentDot!.height, 1);
});

test('Chat sidebar context menu creates and edits groups, and navigates from agent DMs', async ({ page }) => {
  let group = {
    id: 'team',
    name: 'Research',
    createdAt: Date.now(),
    lastMessage: null,
    members: sampleAgents
      .slice(0, 1)
      .map(agent => ({ id: agent.id, name: agent.name, avatar: null, channelId: agent.channelId })),
  };
  await page.route(/\/api\/groups(?:\?.*)?$/, route => route.fulfill({ json: { groups: [group], nextCursor: null } }));
  await page.route('**/api/groups/team', route => {
    if (route.request().method() === 'PATCH') group = { ...group, name: route.request().postDataJSON().name };
    return route.fulfill({ json: group });
  });
  await page.route('**/api/groups/team/messages*', route =>
    route.fulfill({ json: { messages: [], nextCursor: null } }),
  );
  await page.goto('/');
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  const sidebar = page.getByRole('complementary', { name: 'Chats' });
  await expect(page.getByRole('button', { name: 'Open group chat Research' })).toBeVisible();

  await sidebar.click({ button: 'right', position: { x: 40, y: 350 } });
  await expect(page.getByRole('menuitem', { name: 'Create group chat' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Edit group chat' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Create group chat' }).click();
  await expect(page.getByRole('dialog', { name: 'Create group chat' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  const groupRow = page.getByRole('button', { name: 'Open group chat Research' });
  await groupRow.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Edit group chat' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Edit group chat' }).locator('svg')).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Open chat' }).locator('svg')).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath('chat-context-menu.png') });
  await page.getByRole('menuitem', { name: 'Open chat' }).click();
  await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible();
  await groupRow.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit group chat' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit group chat' });
  await expect(dialog.getByLabel('Group name')).toHaveValue('Research');
  await dialog.getByLabel('Group name').fill('Updated research');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Open group chat Updated research' })).toBeVisible();

  const dm = page.getByRole('button', { name: 'Open conversation with Morgan' });
  await dm.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'View in Agents' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'View in Agents' }).locator('svg')).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Edit group chat' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'View in Agents' }).click();
  await expect(page.getByRole('tab', { name: 'Agents' })).toHaveAttribute('data-state', 'active');
  await expect(page.getByRole('region', { name: 'Settings for Morgan' })).toBeVisible();
});

test('Chat sidebar context menu can create a group from an empty list', async ({ page }) => {
  let group: any = null;
  await page.route(/\/api\/groups(?:\?.*)?$/, route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      group = {
        id: 'new-group',
        name: body.name,
        createdAt: Date.now(),
        lastMessage: null,
        members: sampleAgents
          .filter(agent => body.agentIds.includes(agent.id))
          .map(agent => ({ id: agent.id, name: agent.name, avatar: null, channelId: agent.channelId })),
      };
      return route.fulfill({ json: group });
    }
    return route.fulfill({ json: { groups: group ? [group] : [], nextCursor: null } });
  });
  await page.route('**/api/groups/new-group', route => route.fulfill({ json: group }));
  await page.route('**/api/groups/new-group/messages*', route =>
    route.fulfill({ json: { messages: [], nextCursor: null } }),
  );
  await page.goto('/');
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.getByRole('complementary', { name: 'Chats' }).click({ button: 'right', position: { x: 40, y: 350 } });
  await page.getByRole('menuitem', { name: 'Create group chat' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create group chat' });
  await dialog.getByLabel('Group name').fill('Planning');
  await dialog.getByRole('button', { name: 'Add agents' }).click();
  await page.getByRole('dialog', { name: 'Add agents' }).getByRole('option', { name: 'Avery', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add agents' }).getByRole('button', { name: 'Done' }).click();
  await dialog.getByRole('button', { name: 'Create group' }).click();
  await expect(page.getByRole('button', { name: 'Open group chat Planning' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Planning', exact: true })).toBeVisible();
});
