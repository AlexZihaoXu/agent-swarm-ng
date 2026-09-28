import { test, expect } from './fixtures';

const count = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { notificationAudio: { starts: number } }).notificationAudio.starts);

test('plays the formatted clip only for a new incoming agent message', async ({ page }) => {
  let publish = false;
  await page.route('**/api/chat', route => {
    const body = route.request().postDataJSON();
    const message = {
      type: 'channel_message',
      channelId: 'avery',
      id: 'new-reply',
      text: 'Reply',
      timestamp: Date.now(),
    };
    return route.fulfill({
      contentType: 'application/x-ndjson',
      body:
        [
          {
            type: 'user_message',
            channelId: 'avery',
            id: body.clientMessageId,
            text: body.message,
            timestamp: Date.now(),
          },
          { type: 'typing', channelId: 'avery', active: true, targets: ['avery'] },
          { ...message, channelId: 'wrong-channel' },
          { ...message, id: 'avery-0', text: 'Replayed history' },
          ...(publish ? [message, message] : []),
          { type: 'done' },
        ]
          .map(event => JSON.stringify(event))
          .join('\n') + '\n',
    });
  });
  await page.goto('/chat/agents/avery');
  await expect(page.getByRole('heading', { name: 'Avery', exact: true })).toBeVisible();
  expect(await count(page)).toBe(0);
  await page.getByLabel('Message Avery').fill('Hello');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('list', { name: 'Messages' })).toContainText('Hello');
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { notificationAudio: { decodes: number } }).notificationAudio.decodes),
    )
    .toBe(1);
  expect(await count(page)).toBe(0);
  publish = true;
  await page.getByLabel('Message Avery').fill('Again');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('list', { name: 'Messages' })).toContainText('Reply');
  await expect.poll(() => count(page)).toBe(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Avery', exact: true })).toBeVisible();
  expect(await count(page)).toBe(0);
});
