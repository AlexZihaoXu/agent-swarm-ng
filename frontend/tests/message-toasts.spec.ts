import { test, expect } from './fixtures';

const emit = (page: import('@playwright/test').Page, event: object) =>
  page.evaluate(
    event => (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent(event),
    event,
  );

test('a message from another agent shows a toast that fades away and opens its chat; the open chat gets none', async ({
  page,
}) => {
  await page.goto('/chat/agents/avery');
  await expect(page.getByLabel('Message Avery')).toBeVisible();
  // The chat already open: no toast.
  await emit(page, {
    type: 'channel_message',
    agentId: 'avery',
    channelId: 'avery',
    runId: 'r1',
    id: 'm-avery',
    text: 'Right here',
    timestamp: Date.now(),
  });
  await expect(page.getByRole('list', { name: 'Messages' })).toContainText('Right here');
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  // Another agent: a toast with its name and the message, which opens its chat.
  await emit(page, {
    type: 'channel_message',
    agentId: 'morgan',
    channelId: 'morgan',
    runId: 'r2',
    id: 'm-morgan',
    text: 'The build is green.',
    timestamp: Date.now(),
  });
  const toast = page.getByRole('button', { name: /Morgan.*The build is green\./ });
  await expect(toast).toBeVisible();
  const box = (await toast.boundingBox())!;
  expect(box.y).toBeLessThan(140); // at the top, under the header
  await toast.click();
  await expect(page).toHaveURL(/\/chat\/agents\/morgan$/);
  await expect(toast).toHaveCount(0);
  // It fades away on its own.
  await emit(page, {
    type: 'channel_message',
    agentId: 'riley',
    channelId: 'riley',
    runId: 'r3',
    id: 'm-riley',
    text: 'Done for today.',
    timestamp: Date.now(),
  });
  const later = page.locator('[data-sonner-toast]').filter({ hasText: 'Done for today.' });
  await expect(later).toBeVisible();
  // Hovering pauses it; away from it, it goes after a few seconds.
  await page.mouse.move(600, 600);
  await expect(later).toHaveCount(0, { timeout: 10_000 });
});

test('a group message toasts with its group, unless that group is open', async ({ page }) => {
  const group = { id: 'team', name: 'Research', createdAt: Date.now(), lastMessage: null, members: [] };
  await page.route(/\/api\/groups(?:\?.*)?$/, route => route.fulfill({ json: { groups: [group], nextCursor: null } }));
  await page.route('**/api/groups/team', route => route.fulfill({ json: group }));
  await page.route('**/api/groups/team/messages*', route =>
    route.fulfill({ json: { messages: [], nextCursor: null } }),
  );
  await page.goto('/chat/agents/avery');
  await expect(page.getByRole('button', { name: 'Open group chat Research' })).toBeVisible();
  const message = (id: string, text: string) => ({
    type: 'group_updated',
    groupId: 'team',
    publication: true,
    message: { id, sequence: 1, groupId: 'team', role: 'assistant', authorId: 'quinn', authorName: 'Quinn', text },
  });
  await emit(page, message('g1', 'Notes are up.'));
  const toast = page.getByRole('button', { name: /Quinn.*in Research.*Notes are up\./ });
  await expect(toast).toBeVisible();
  await toast.click();
  await expect(page).toHaveURL(/\/chat\/groups\/team$/);
  await emit(page, message('g2', 'Second note.'));
  await page.waitForTimeout(500);
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Second note.' })).toHaveCount(0);
});

test('a floating chat with the agent counts as viewing it: no toast', async ({ page }) => {
  await page.goto('/chat/agents/avery');
  await expect(page.getByRole('button', { name: 'Open Portal' })).toBeVisible();
  await page.keyboard.press('Control+k');
  const portal = page.getByRole('dialog', { name: 'Portal' });
  await portal.getByRole('combobox').fill('@morg');
  await expect(portal.getByRole('option', { name: /Morgan/, selected: true })).toBeVisible();
  await portal.getByRole('combobox').press('Enter');
  await expect(page.getByRole('region', { name: 'Chat with Morgan' })).toBeVisible();
  await emit(page, {
    type: 'channel_message',
    agentId: 'morgan',
    channelId: 'morgan',
    runId: 'r9',
    id: 'm-floating',
    text: 'Seen in the window.',
    timestamp: Date.now(),
  });
  await expect(page.getByRole('region', { name: 'Chat with Morgan' })).toContainText('Seen in the window.');
  await page.waitForTimeout(500);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
});
