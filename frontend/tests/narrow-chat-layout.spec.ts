import { test, expect } from './fixtures';
import { sampleHistory, sampleAgents } from './sample-agents';

const bounds = async (locator: { boundingBox: () => Promise<{ x: number; y: number; width: number; height: number } | null> }) => (await locator.boundingBox())!;

for (const width of [700, 320, 280]) test(`narrow ${width}px keeps an active desktop conversation and its bubbles visible`, async ({ page }) => {
  const messages = sampleHistory.avery.map(message => ({ ...message }));
  messages[1].text = 'A long outgoing message ' + 'unbroken'.repeat(120);
  messages[2].text = 'A lengthy result ' + 'unbroken'.repeat(60) + '\n\n' + 'Substantial detail '.repeat(100);
  await page.route('**/api/channels/avery/messages*', route => route.fulfill({ json: { messages, nextCursor: null } }));
  await page.setViewportSize({ width: 900, height: 700 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  await expect(page.locator('[data-message-id="avery-2"]')).toBeVisible();
  const assertAllBubblesFit = async (viewportWidth: number) => {
    const clipped = await page.locator('[data-message-id]').evaluateAll(elements => elements.flatMap(element => {
      const { left, right } = element.getBoundingClientRect();
      return left < 0 || right > innerWidth + 1 ? [{ id: element.getAttribute('data-message-id'), left, right }] : [];
    }));
    expect(clipped, `all message bubbles must fit within ${viewportWidth}px`).toEqual([]);
  };
  await assertAllBubblesFit(900);
  await page.setViewportSize({ width, height: 700 });
  const chat = page.getByRole('region', { name: 'Conversation with Avery' });
  await expect(chat).toBeVisible();
  // Radix's default display:table inner wrapper can expand to message max-content and
  // shift every right-aligned bubble beyond the clipped scroll viewport.
  const historyViewport = page.getByRole('region', { name: 'Chat history' });
  expect(await historyViewport.evaluate(element => getComputedStyle(element.firstElementChild!).display)).toBe('block');
  expect(await historyViewport.evaluate(element => element.firstElementChild!.clientWidth)).toBeLessThanOrEqual(await historyViewport.evaluate(element => element.clientWidth));
  await expect(page.getByRole('complementary', { name: 'Agents' })).toBeHidden();
  const backButton = page.getByRole('button', { name: 'Back to agents' });
  await expect(backButton).toContainText('Avery');
  await expect(backButton.locator('svg[data-avatar-shape]')).toHaveCount(1);
  const selector = page.getByRole('combobox', { name: 'Chat with' });
  await expect(selector).toHaveText('You');
  const back = await bounds(backButton), activity = await bounds(page.getByRole('button', { name: 'Agent activity' })), picker = await bounds(selector);
  expect(Math.abs(back.y - activity.y)).toBeLessThan(8);
  expect(Math.abs(back.y - picker.y)).toBeLessThan(8);
  await expect(chat.locator('header').first().locator('[data-slot="agent-exchange-icon"]')).toHaveCount(1);
  await expect(page.getByRole('tablist', { name: 'Main navigation' })).toBeHidden();
  const bubble = await bounds(page.locator('[data-message-id="avery-2"]'));
  expect(bubble.x).toBeGreaterThanOrEqual(0);
  expect(bubble.x + bubble.width).toBeLessThanOrEqual(width);
  await assertAllBubblesFit(width);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  await page.screenshot({ path: test.info().outputPath(`narrow-${width}.png`), animations: 'disabled' });
  await page.getByRole('button', { name: 'Back to agents' }).click();
  await expect(page.getByRole('complementary', { name: 'Agents' })).toBeVisible();
  const tabs = await bounds(page.getByRole('tablist', { name: 'Main navigation' }));
  expect(tabs.y).toBeGreaterThan(600);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
});

test('floating phone tabs and one-row conversation headers navigate without a footer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const tabs = page.getByRole('tablist', { name: 'Main navigation' });
  expect((await bounds(tabs)).y).toBeGreaterThan(760);
  expect(await tabs.locator('xpath=..').evaluate(element => getComputedStyle(element).position)).toBe('fixed');
  expect(await tabs.locator('xpath=..').evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('0px');
  expect((await bounds(page.getByText('Your account'))).y + (await bounds(page.getByText('Your account'))).height).toBeLessThan((await bounds(tabs)).y);
  await page.screenshot({ path: test.info().outputPath('phone-agent-list.png'), animations: 'disabled' });
  await page.getByRole('tab', { name: 'Chat' }).click();
  await expect(page.getByRole('complementary', { name: 'Chats' })).toBeVisible();
  await page.getByRole('button', { name: 'Open conversation with Avery' }).click();
  await expect(tabs).toBeHidden();
  const back = page.getByRole('button', { name: 'Back to chats' });
  await expect(back).toContainText('Avery');
  await expect(page.getByRole('combobox', { name: 'Chat with' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Chat history' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to chats' }).click();
  await expect(tabs).toBeVisible();
  await page.getByRole('tab', { name: 'Settings' }).click();
  expect((await bounds(tabs)).y).toBeGreaterThan(760);
  await page.getByRole('tabpanel', { name: 'Settings' }).evaluate(element => { element.scrollTop = element.scrollHeight; });
  const lastNote = await bounds(page.getByText('Save endpoints to keep them after restart.', { exact: false }));
  expect(lastNote.y + lastNote.height).toBeLessThan((await bounds(tabs)).y);
  await page.setViewportSize({ width: 900, height: 700 });
  const desktopTabs = await bounds(tabs);
  expect(desktopTabs.y).toBeLessThan(30);
});

test('phone navigation transitions animate only when motion is allowed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const agents = page.getByRole('complementary', { name: 'Agents' });
  await expect(agents).toHaveCSS('animation-name', 'phone-list-in');
  await page.getByRole('button', { name: 'Open conversation with Avery' }).click();
  await expect(page.getByRole('region', { name: 'Conversation with Avery' })).toHaveCSS('animation-name', 'phone-detail-in');
  await page.getByRole('button', { name: 'Back to agents' }).click();
  await expect(agents).toHaveCSS('animation-name', 'phone-list-in');
  await page.getByRole('tab', { name: 'Settings' }).click();
  const settings = page.getByRole('tabpanel', { name: 'Settings' });
  await expect(settings).toHaveCSS('animation-name', 'fade-in');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(settings).toHaveCSS('animation-name', 'none');
});

test('group incoming messages remain readable and bounded on a phone', async ({ page }) => {
  const group = { id: 'team', name: 'Team', createdAt: Date.now(), members: [{ id: 'avery', name: 'Avery', avatar: null, channelId: sampleAgents[0].channelId }], lastMessage: null };
  const messages = [{ id: 'group-long', sequence: 1, groupId: 'team', role: 'assistant', authorId: 'avery', authorName: 'Avery', authorAvatar: null, text: 'Shared result ' + 'long'.repeat(70), timestamp: Date.now(), replyTo: null }];
  await page.route(/\/api\/groups(?:\?.*)?$/, route => route.fulfill({ json: { groups: [group], nextCursor: null } }));
  await page.route('**/api/groups/team', route => route.fulfill({ json: group }));
  await page.route('**/api/groups/team/messages*', route => route.fulfill({ json: { messages, nextCursor: null } }));
  await page.setViewportSize({ width: 375, height: 700 }); await page.goto('/');
  await page.getByRole('tab', { name: 'Chat' }).click();
  await page.getByRole('button', { name: 'Open group chat Team' }).click();
  const breadcrumb = page.getByRole('navigation', { name: 'Conversation breadcrumb' });
  await expect(breadcrumb).toContainText('Chats');
  await expect(breadcrumb).toHaveCSS('border-top-width', '0px');
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText('Team');
  const row = page.locator('[data-message-id="group-long"]');
  const bubble = row.locator('.message-context-target');
  const groupHistory = page.getByRole('region', { name: 'Group chat history' });
  expect(await groupHistory.evaluate(element => getComputedStyle(element.firstElementChild!).display)).toBe('block');
  expect(await groupHistory.evaluate(element => element.firstElementChild!.clientWidth)).toBeLessThanOrEqual(await groupHistory.evaluate(element => element.clientWidth));
  await expect(bubble).toBeVisible();
  await expect(row.locator('time').first()).toBeHidden();
  await expect(bubble.locator('time')).toBeVisible();
  await row.hover();
  await expect.poll(() => row.locator('[data-avatar-shape]').first().evaluate(element => getComputedStyle(element.parentElement!).opacity)).toBe('1');
  expect((await bounds(bubble)).x + (await bounds(bubble)).width).toBeLessThanOrEqual(375);
  await expect.poll(() => bubble.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  await page.screenshot({ path: test.info().outputPath('phone-group-bubbles.png'), animations: 'disabled' });
});
