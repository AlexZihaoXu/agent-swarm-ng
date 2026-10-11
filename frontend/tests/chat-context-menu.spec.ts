import { test, expect } from './fixtures';
import { sampleAgents } from './sample-agents';

test('Chat sidebar context menu creates and edits groups, and opens an agent’s settings', async ({ page }) => {
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
  await expect(page.getByRole('menuitem', { name: 'Agent settings' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Agent settings' }).locator('svg')).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Edit group chat' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Agent settings' }).click();
  await expect(page).toHaveURL(/\/agents\/morgan$/);
  await expect(page.getByRole('region', { name: 'Settings for Morgan' })).toBeVisible();
  // Closing it returns focus to the agent's row.
  await page.keyboard.press('Escape');
  await expect(dm).toBeFocused();
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

test('a long press on a chat row (phones) opens its menu with Agent settings, not the chat', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/chat');
  // By its element: once the menu is open, the list is hidden from the accessibility tree.
  const row = page.locator('[data-chat-kind="dm"][data-chat-id="morgan"]');
  // A touch device keeps the press from selecting text or opening the browser's callout.
  await expect(row).toHaveClass(/touch-menu-target/);
  const box = (await row.boundingBox())!;
  const at = { pointerType: 'touch', isPrimary: true, button: 0, clientX: box.x + 40, clientY: box.y + 20 };
  await row.dispatchEvent('pointerdown', at);
  // The finger drifts a little: still a hold, not a scroll.
  await row.dispatchEvent('pointermove', { ...at, clientX: at.clientX + 5 });
  await expect(page.getByRole('menuitem', { name: 'Agent settings' })).toBeVisible();
  await row.dispatchEvent('pointerup', at);
  await row.dispatchEvent('click', at);
  await expect(page).toHaveURL(/\/chat$/); // the press did not also open the chat
  await page.getByRole('menuitem', { name: 'Agent settings' }).click();
  await expect(page.getByRole('region', { name: 'Settings for Morgan' })).toBeVisible();
});

test('avatars in the chat list survive opening a chat and coming back (no masks by page reference)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/chat');
  const face = page
    .getByRole('button', { name: 'Open conversation with Morgan' })
    .locator('[data-slot="avatar-face"]')
    .first();
  await expect(face).toHaveCSS('mask-image', /^url\("data:image\/svg\+xml/);
  await page.getByRole('button', { name: 'Open conversation with Morgan' }).click();
  await page.getByRole('button', { name: 'Back to chats' }).click();
  await expect(face).toHaveCSS('mask-image', /^url\("data:image\/svg\+xml/);
});
