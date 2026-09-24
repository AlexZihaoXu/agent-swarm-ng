import { test, expect } from './fixtures';
import { sampleAgents } from './sample-agents';

test('private replies retain their draft, follow the selected message and clear only after acknowledgment', async ({ page }) => {
  await page.goto('/');
  const bubble = page.locator('[data-message-id="avery-0"]');
  await bubble.focus(); await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Reply' }).click();
  const composer = page.getByRole('form', { name: 'Message composer' });
  await expect(composer.getByLabel('Replying to Avery')).toContainText('Hey! What would you like to work on?');
  await expect(page.getByLabel('Message Avery')).toBeFocused();
  await page.getByLabel('Message Avery').fill('I will keep this draft');
  await composer.getByRole('button', { name: 'Cancel reply' }).click();
  await expect(page.getByLabel('Message Avery')).toHaveValue('I will keep this draft');
  await expect(composer.getByLabel('Replying to Avery')).toHaveCount(0);
  await bubble.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reply' }).click();
  const request = page.waitForRequest(req => req.url().endsWith('/api/chat') && req.method() === 'POST');
  await page.getByRole('button', { name: 'Send message' }).click();
  expect((await request).postDataJSON().replyToMessageId).toBe('avery-0');
  const sent = page.getByRole('list', { name: 'Messages' }).getByText('I will keep this draft', { exact: true });
  await expect(sent).toBeVisible();
  await expect(sent.locator('xpath=ancestor::*[@data-message-id][1]').getByLabel('In reply to Avery')).toContainText('Hey! What would you like to work on?');
  await expect(composer.getByLabel('Replying to Avery')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open conversation with Morgan' }).click();
  await expect(page.getByRole('form', { name: 'Message composer' }).getByLabel('Replying to Avery')).toHaveCount(0);
});

test('unsent reply targets stay with their conversation rather than leaking to another chat', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-message-id="avery-0"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reply' }).click();
  await page.getByRole('button', { name: 'Open conversation with Morgan' }).click();
  await expect(page.getByLabel('Replying to Avery')).toHaveCount(0);
  const request = page.waitForRequest(req => req.url().endsWith('/api/chat') && req.method() === 'POST');
  await page.getByLabel('Message Morgan').fill('Separate conversation');
  await page.getByRole('button', { name: 'Send message' }).click();
  expect((await request).postDataJSON().replyToMessageId).toBeUndefined();
  await page.getByRole('button', { name: 'Open conversation with Avery' }).click();
  await expect(page.getByLabel('Replying to Avery')).toContainText('Hey!');
});

test('group reply preview and target survive a failed send, then publish exactly once', async ({ page }) => {
  const group = { id: 'team', name: 'Team', createdAt: Date.now(), members: [{ id: sampleAgents[0].id, name: 'Avery', avatar: null, channelId: sampleAgents[0].channelId }], lastMessage: null as any };
  const messages: any[] = [{ id: 'group-parent', sequence: 1, groupId: 'team', role: 'assistant', authorId: 'avery', authorName: 'Avery', authorAvatar: null, text: 'Earlier group topic', timestamp: Date.now(), replyTo: null }];
  let fail = true; const posted: any[] = [];
  await page.route(/\/api\/groups(?:\?.*)?$/, route => route.fulfill({ json: { groups: [group], nextCursor: null } }));
  await page.route('**/api/groups/team', route => route.fulfill({ json: group }));
  await page.route('**/api/groups/team/messages*', route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { messages, nextCursor: null } });
    const body = route.request().postDataJSON(); posted.push(body);
    if (fail) return route.fulfill({ status: 503, json: { message: 'Try again.' } });
    const message = { id: body.clientMessageId, sequence: 2, groupId: 'team', role: 'user', authorId: null, authorName: 'You', authorAvatar: null, text: body.message, timestamp: Date.now(), replyTo: { id: messages[0].id, role: 'assistant', authorId: 'avery', authorName: 'Avery', text: messages[0].text } };
    messages.push(message); group.lastMessage = message;
    return route.fulfill({ status: 202, json: { message, duplicate: false } });
  });
  await page.goto('/'); await page.getByRole('tab', { name: 'Chat' }).click();
  await page.getByRole('button', { name: 'Open group chat Team' }).click();
  const content = page.getByText('Earlier group topic', { exact: true });
  await content.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reply' }).click();
  const composer = page.getByRole('form', { name: 'Message composer' });
  await expect(composer.getByLabel('Replying to Avery')).toContainText('Earlier group topic');
  await page.getByLabel('Message Team').fill('About that topic');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('alert')).toContainText('Try again.');
  await expect(composer.getByLabel('Replying to Avery')).toBeVisible();
  await expect(page.getByLabel('Message Team')).toHaveValue('About that topic');
  fail = false;
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('About that topic', { exact: true })).toBeVisible();
  expect(posted).toHaveLength(2);
  expect(posted[0].clientMessageId).toBe(posted[1].clientMessageId);
  expect(posted.map(item => item.replyToMessageId)).toEqual(['group-parent', 'group-parent']);
  await expect(composer.getByLabel('Replying to Avery')).toHaveCount(0);
  await expect(page.getByLabel('In reply to Avery')).toContainText('Earlier group topic');
});

test.describe('touch reply', () => {
  test.use({ hasTouch: true });
  test('long-press Reply opens the same composer banner on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open conversation with Avery' }).click();
    const bubble = page.locator('[data-message-id="avery-0"]');
    await bubble.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
    await page.getByRole('menuitem', { name: 'Reply' }).tap();
    await expect(page.getByLabel('Replying to Avery')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel reply' }).tap();
    await expect(page.getByLabel('Replying to Avery')).toHaveCount(0);
  });
});
