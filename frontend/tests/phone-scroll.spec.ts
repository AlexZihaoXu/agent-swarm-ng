import { test, expect, type Page } from './fixtures';
import { sampleAgents, sampleHistory } from './sample-agents';

async function swipeUp(page: Page, x: number, y: number) {
  const client = await page.context().newCDPSession(page);
  let active = false;
  try {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    active = true;
    for (let step = 1; step <= 5; step++) {
      await page.waitForTimeout(45);
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y - step * 32, id: 1 }],
      });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    active = false;
  } finally {
    if (active) await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await client.detach();
  }
}

test.describe('phone touch scrolling', () => {
  test.use({ hasTouch: true });

  test('swiping over a message scrolls history without opening its menu or jumping on new publications', async ({
    page,
  }) => {
    const messages = Array.from({ length: 45 }, (_, index) => ({
      ...sampleHistory.avery[0],
      id: `scroll-${index}`,
      sequence: index + 1,
      role: index % 2 ? 'user' : 'assistant',
      text: `Message ${index} with enough content to make the history scrollable.`,
      timestamp: Date.now() + index * 1000,
    }));
    await page.route('**/api/channels/avery/messages*', route =>
      route.fulfill({ json: { messages, nextCursor: null } }),
    );
    await page.setViewportSize({ width: 390, height: 640 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/chat');
    await page.getByRole('button', { name: 'Open conversation with Avery' }).click();
    const viewport = page.getByRole('region', { name: 'Chat history' });
    await expect.poll(() => viewport.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(500);
    await viewport.evaluate(el => {
      el.scrollTop = 0;
    });
    const first = (await page.locator('[data-message-id="scroll-0"]').boundingBox())!;
    await swipeUp(page, first.x + first.width / 2, first.y + first.height / 2);
    await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeGreaterThan(30);
    await expect(page.getByRole('menu', { name: 'Message actions' })).toHaveCount(0);
    const readingPosition = await viewport.evaluate(el => el.scrollTop);
    await page.evaluate(() =>
      (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent({
        type: 'channel_message',
        eventId: 'new-while-reading',
        agentId: 'avery',
        channelId: 'avery',
        id: 'new-while-reading',
        sequence: 46,
        text: 'New publication while reading older content',
        timestamp: Date.now(),
      }),
    );
    await expect(page.locator('[data-message-id="new-while-reading"]')).toHaveCount(1);
    await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeLessThan(readingPosition + 30);
  });

  test('agent list, chat list and Settings still accept native vertical swipes', async ({ page }) => {
    const agents = Array.from({ length: 30 }, (_, index) => ({
      ...sampleAgents[0],
      id: `peer-${index}`,
      name: `Agent ${index}`,
      channelId: `channel-${index}`,
      lastMessage: null,
    }));
    await page.route(/\/api\/agents(?:\?.*)?$/, route => route.fulfill({ json: { agents, nextCursor: null } }));
    await page.setViewportSize({ width: 390, height: 640 });
    await page.goto('/');
    for (const [tab, label] of [
      ['Agents', 'Agents'],
      ['Chat', 'Chats'],
    ] as const) {
      if (tab === 'Chat') await page.getByRole('tab', { name: tab }).click();
      const list = page.getByRole('complementary', { name: label }).locator('[class*="overflow-y-auto"]').first();
      await expect.poll(() => list.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(300);
      const bounds = (await list.boundingBox())!;
      await swipeUp(page, bounds.x + bounds.width / 2, bounds.y + Math.min(320, bounds.height - 80));
      await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(30);
    }
    await page.getByRole('tab', { name: 'Settings' }).click();
    for (let index = 0; index < 3; index++) await page.getByRole('button', { name: 'Add endpoint' }).click();
    const settings = page.getByRole('tabpanel', { name: 'Settings' });
    await expect.poll(() => settings.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(300);
    const box = (await settings.boundingBox())!;
    await swipeUp(page, box.x + box.width / 2, box.y + 300);
    await expect.poll(() => settings.evaluate(el => el.scrollTop)).toBeGreaterThan(30);
  });

  test('a long peer picker and emoji results scroll inside their own menus', async ({ page }) => {
    await page.route('**/api/agents/avery/dm-peers*', route =>
      route.fulfill({
        json: {
          peers: Array.from({ length: 24 }, (_, i) => ({
            id: `peer-${i}`,
            name: `Peer ${i}`,
            channelId: `peer-channel-${i}`,
            avatar: null,
          })),
          nextCursor: null,
        },
      }),
    );
    await page.setViewportSize({ width: 390, height: 640 });
    await page.goto('/chat');
    await page.getByRole('button', { name: 'Open conversation with Avery' }).click();
    await page.getByRole('combobox', { name: 'Chat with' }).tap();
    const viewport = page.getByRole('listbox');
    await expect.poll(() => viewport.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(200);
    const box = (await viewport.boundingBox())!;
    await swipeUp(page, box.x + box.width / 2, box.y + Math.min(175, box.height - 50));
    await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeGreaterThan(30);
    await page.keyboard.press('Escape');
    await page.locator('[data-message-id="avery-0"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Add reaction' }).tap();
    const results = page.getByRole('region', { name: 'Emoji results' });
    await expect.poll(() => results.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(200);
    const emojiBox = (await results.boundingBox())!;
    await swipeUp(page, emojiBox.x + emojiBox.width / 2, emojiBox.y + Math.min(150, emojiBox.height - 40));
    await expect.poll(() => results.evaluate(el => el.scrollTop)).toBeGreaterThan(30);
    await expect(page.getByRole('menu', { name: 'Message actions' })).toBeVisible();
  });

  test('a peer-list failure still exposes the retry choice on phones', async ({ page }) => {
    await page.route('**/api/agents/avery/dm-peers*', route =>
      route.fulfill({ status: 503, json: { message: 'Unavailable' } }),
    );
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/chat');
    await page.getByRole('button', { name: 'Open conversation with Avery' }).tap();
    const trigger = page.getByRole('combobox', { name: 'Chat with' });
    await expect(trigger).toBeVisible();
    await trigger.tap();
    await expect(page.getByRole('option', { name: 'Retry conversations' })).toBeVisible();
  });

  test('the selected You button stays wide in one row with the agent at 280–390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 640 });
    await page.goto('/chat');
    await page.getByRole('button', { name: 'Open conversation with Avery' }).tap();
    const trigger = page.getByRole('combobox', { name: 'Chat with' });
    for (const width of [390, 320, 280]) {
      await page.setViewportSize({ width, height: 640 });
      await expect(trigger).toHaveText('You');
      const button = (await trigger.boundingBox())!;
      expect(button.width).toBeGreaterThanOrEqual(width === 280 ? 88 : width === 320 ? 104 : 120);
      expect(button.x + button.width).toBeLessThanOrEqual(width);
      const owner = page.getByRole('button', { name: 'Back to chats' });
      await expect(owner).toContainText('Avery');
      await expect(owner.locator('svg[data-avatar-shape]')).toHaveCount(1);
      expect(Math.abs((await owner.boundingBox())!.y - button.y)).toBeLessThan(8);
      await trigger.tap();
      const menu = page.getByRole('listbox');
      const popup = (await menu.boundingBox())!;
      expect(popup.width).toBeGreaterThanOrEqual(180);
      expect(popup.x).toBeGreaterThanOrEqual(0);
      expect(popup.x + popup.width).toBeLessThanOrEqual(width);
      await menu.getByRole('option', { name: 'You', exact: true }).tap();
      await expect(menu).toHaveCount(0);
    }
    await page.setViewportSize({ width: 900, height: 700 });
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveText('You');
  });
});
