import { test, expect } from './fixtures';
import { sampleAgents } from './sample-agents';

test('reaction loading failures are visible and retry without losing conversation text', async ({ page }) => {
  let failing = true;
  await page.route('**/api/chats/*/reactions*', route => failing
    ? route.fulfill({ status: 503, json: { message: 'Temporary failure' } })
    : route.fulfill({ json: { messages: new URL(route.request().url()).searchParams.getAll('ids').map(id => ({ id, reactions: [] })) } }));
  await page.goto('/');
  await expect(page.getByText('Could not load reactions.', { exact: false })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('list', { name: 'Messages', exact: true })).toBeVisible();
  failing = false;
  await page.getByRole('button', { name: 'Retry reactions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry reactions', exact: true })).toHaveCount(0);
});

for (const mobile of [false, true]) test(`Chat groups preserve Agents, group timestamps and persist reactions${mobile ? ' on mobile' : ''}`, async ({ page }) => {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  const stamp = new Date(2026, 8, 24, 13).getTime();
  let group: any = null;
  const messages: any[] = [];
  const reactions = new Map<string, { emoji: string; count: number; mine: boolean }[]>();
  let grants = 0;
  page.on('request', request => { if (request.method() === 'PATCH' && request.url().includes('/settings')) grants++; });
  await page.route(/\/api\/groups(?:\?.*)?$/, async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      group = { id: 'team', name: body.name, createdAt: stamp, members: sampleAgents.filter(agent => body.agentIds.includes(agent.id)).map(agent => ({ id: agent.id, name: agent.name, channelId: agent.channelId, avatar: null })), lastMessage: null };
      messages.push(...[0, 4, 10].map((minute, index) => ({ id: `group-${index}`, sequence: index + 1, groupId: 'team', role: 'assistant', authorId: sampleAgents[0].id, authorName: sampleAgents[0].name, authorAvatar: null, text: ['First finding', 'Related detail', 'Later finding'][index], timestamp: stamp + minute * 60000 })));
      return route.fulfill({ json: group });
    }
    return route.fulfill({ json: { groups: group ? [group] : [], nextCursor: null } });
  });
  await page.route('**/api/groups/team', route => route.fulfill({ json: group }));
  await page.route('**/api/groups/team/messages*', route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      const message = { id: body.clientMessageId, sequence: messages.length + 1, groupId: 'team', role: 'user', authorId: null, authorName: 'You', authorAvatar: null, text: body.message, timestamp: stamp + 12 * 60000 };
      messages.push(message); group.lastMessage = message; return route.fulfill({ status: 202, json: { message, duplicate: false } });
    }
    return route.fulfill({ json: { messages, nextCursor: null } });
  });
  await page.route('**/api/chats/*/reactions*', route => route.fulfill({ json: { messages: new URL(route.request().url()).searchParams.getAll('ids').map(id => ({ id, reactions: reactions.get(id) ?? [] })) } }));
  await page.route('**/api/chats/*/messages/*/reaction', route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
    const { emoji, active } = route.request().postDataJSON();
    reactions.set(id, active ? [{ emoji, count: 1, mine: true }] : []);
    return route.fulfill({ json: { reactions: reactions.get(id) } });
  });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await expect(page.getByLabel('Search chats', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open conversation with Avery', exact: true }).click();
  await expect(page.getByLabel('Message Avery')).toBeVisible();
  await expect(page.getByText('Chat with', { exact: true })).toHaveCount(0);
  if (mobile) await page.getByRole('button', { name: 'Back to chats' }).click();
  await page.getByRole('button', { name: 'Create group chat', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Group name').fill('Research');
  await dialog.getByRole('checkbox', { name: 'Avery', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'Morgan', exact: true }).check();
  await dialog.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible();
  await expect(page.locator('[data-message-id="group-1"]')).toHaveAttribute('data-grouped', 'true');
  await expect(page.locator('[data-message-id="group-2"]')).not.toHaveAttribute('data-grouped', 'true');
  const detail = page.locator('[data-message-id="group-1"]');
  await detail.focus();
  await expect(detail.locator('time').first()).toHaveCSS('opacity', '1');
  await detail.getByRole('combobox', { name: 'React to message' }).click();
  await page.getByRole('option', { name: 'Thumbs up', exact: true }).click();
  await expect(detail.getByRole('button', { name: 'Thumbs up: 1 reaction', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Message Research').fill('Human message');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Human message', { exact: true })).toBeVisible();
  const human = await page.getByText('Human message', { exact: true }).boundingBox();
  const agent = await page.getByText('First finding', { exact: true }).boundingBox();
  expect(human!.x).toBeGreaterThan(agent!.x);
  if (mobile) await page.getByRole('button', { name: 'Back to chats' }).click();
  await expect(page.getByRole('button', { name: 'Open group chat Research', exact: true })).toContainText('Human message');
  if (mobile) await page.getByRole('button', { name: 'Open group chat Research', exact: true }).click();
  expect(grants).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`chat-group-${mobile ? 'mobile' : 'desktop'}.png`), fullPage: true });
  await page.getByRole('tab', { name: 'Agents', exact: true }).click();
  await expect(page.getByText('Chat with', { exact: true })).toBeVisible();
});
