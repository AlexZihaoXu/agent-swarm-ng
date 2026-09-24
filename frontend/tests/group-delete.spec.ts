import { test, expect } from './fixtures';
import { sampleAgents } from './sample-agents';

test('a deletion in another session closes the selected group without losing the chat list', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const group = { id: 'remote', name: 'Remote', createdAt: Date.now(), members: [], lastMessage: null };
  let exists = true;
  await page.route(/\/api\/groups(?:\?.*)?$/, route => route.fulfill({ json: { groups: exists ? [group] : [], nextCursor: null } }));
  await page.route('**/api/groups/remote', route => exists ? route.fulfill({ json: group }) : route.fulfill({ status: 404, json: { message: 'Group not found.' } }));
  await page.route('**/api/groups/remote/messages*', route => route.fulfill({ json: { messages: [], nextCursor: null } }));
  await page.goto('/');
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.getByRole('button', { name: 'Open group chat Remote' }).click();
  exists = false;
  await page.evaluate(() => (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent({ type: 'group_deleted', groupId: 'remote', eventId: 'remote-deleted' }));
  await expect(page.getByRole('button', { name: 'Open group chat Remote' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open conversation with Avery' })).toBeVisible();
});

for (const width of [320, 1280]) test(`chat-list edit and delete actions are both reachable at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  const group = { id: 'context-team', name: 'Context team', createdAt: Date.now(), members: [], lastMessage: null };
  let exists = true;
  await page.route(/\/api\/groups(?:\?.*)?$/, route => route.fulfill({ json: { groups: exists ? [group] : [], nextCursor: null } }));
  await page.route('**/api/groups/context-team', route => {
    if (route.request().method() === 'DELETE') {
      if (route.request().postDataJSON().confirmation !== group.name) return route.fulfill({ status: 400, json: { message: 'Wrong name.' } });
      exists = false; return route.fulfill({ json: { deleted: true } });
    }
    return route.fulfill({ json: group });
  });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  const row = page.getByRole('button', { name: 'Open group chat Context team' });
  await row.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Delete group chat' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Edit group chat' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete group chat' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Delete group chat' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(row).toBeVisible();
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete group chat' }).click();
  await dialog.getByRole('textbox', { name: 'Confirm group name' }).fill(group.name);
  await dialog.getByRole('button', { name: 'Delete group chat' }).click();
  await expect(row).toHaveCount(0);
});

for (const width of [280, 320, 1280]) test(`delete group chat requires confirmation, handles active agents, and returns to chats at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  const members = [{ id: sampleAgents[0].id, name: sampleAgents[0].name, avatar: null, channelId: sampleAgents[0].channelId }];
  let group: { id: string; name: string; createdAt: number; members: typeof members; lastMessage: null } | null = { id: 'research', name: 'Research', createdAt: Date.now(), members, lastMessage: null };
  let busy = true, requests = 0;
  await page.route(/\/api\/groups(?:\?.*)?$/, route => route.fulfill({ json: { groups: group ? [group] : [], nextCursor: null } }));
  await page.route('**/api/groups/research', route => {
    if (route.request().method() === 'DELETE') {
      requests++;
      if (route.request().postDataJSON().confirmation !== 'Research') return route.fulfill({ status: 400, json: { message: 'Wrong confirmation.' } });
      if (busy) return route.fulfill({ status: 409, json: { message: 'Group agents are responding. Stop or wait for their turns before deleting.' } });
      group = null;
      return route.fulfill({ json: { deleted: true } });
    }
    return group ? route.fulfill({ json: group }) : route.fulfill({ status: 404, json: { message: 'Group not found.' } });
  });
  await page.route('**/api/groups/research/messages*', route => route.fulfill({ json: { messages: [], nextCursor: null } }));
  await page.goto('/');
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.getByRole('button', { name: 'Open group chat Research' }).click();
  await page.getByRole('button', { name: 'Edit group chat', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete group chat', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByText('This permanently deletes the group', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(requests).toBe(0);
  await page.getByRole('button', { name: 'Edit group chat', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete group chat', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Confirm group name' }).fill('research');
  await expect(dialog.getByRole('button', { name: 'Delete group chat' })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Confirm group name' }).fill('Research');
  await dialog.getByRole('button', { name: 'Delete group chat' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Group agents are responding');
  await expect(dialog).toBeVisible();
  busy = false;
  await dialog.getByRole('button', { name: 'Delete group chat' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open group chat Research' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open conversation with Avery' })).toBeVisible();
  expect(requests).toBe(2);
});
