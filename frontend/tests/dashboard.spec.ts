import { test, expect, chooseAgent } from './fixtures';
import { defaultAvatar } from '../src/lib/agent-avatar';

test('saved agents keep the sidebar and open inline settings; Chat owns messages', async ({ page }) => {
  await page.goto('/');
  // The page behind the panes is the bars' colour (iOS shows it behind the status bar); the panes paint their own.
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(21, 21, 21)');
  await expect(page.getByRole('tablist', { name: 'Main navigation' }).getByRole('tab')).toHaveText([
    'Dashboard',
    'Agents',
    'Chat',
    'Computers',
    'Settings',
  ]);
  await expect(page.getByRole('tab', { name: 'Agents', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Settings for Avery' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create new agent' })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Message composer' })).toHaveCount(0);
  await chooseAgent(page, 'Morgan');
  await expect(page.getByRole('region', { name: 'Settings for Morgan' })).toBeVisible();
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await expect(page.getByLabel('Message Morgan')).toBeVisible();
});

test('agent panel context menu opens the creation form', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('complementary', { name: 'Agents', exact: true })
    .click({ button: 'right', position: { x: 50, y: 350 } });
  const create = page.getByRole('menuitem', { name: 'Create new agent' });
  await expect(create).toBeVisible();
  await expect(create).toHaveCSS('cursor', 'pointer');
  await create.click();
  const dialog = page.getByRole('dialog', { name: 'Create new agent' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('animation-name', 'dialog-in');
  await expect(dialog.getByLabel('Agent name')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create agent', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('combobox', { name: 'Agent' }).click();
  await expect(page.getByRole('option')).toHaveCount(4);
});

test('agent context menu and placeholder support keyboard dismissal and focus return', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const panel = page.getByRole('complementary', { name: 'Agents', exact: true });
  await panel.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Create new agent' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Create new agent' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCSS('animation-name', 'none');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(panel).toBeFocused();
});

test('chat identity animates and settles on the latest selected agent', async ({ page }) => {
  await page.goto('/chat/agents/avery');
  const name = page.getByRole('heading', { name: 'Avery', exact: true });
  await expect(name.locator('span[aria-hidden="true"]')).toHaveText('Avery');
  await page.getByRole('button', { name: 'Open conversation with Morgan' }).click();
  const nextName = page.getByRole('heading', { name: 'Morgan', exact: true }).locator('[data-slot="swap-text"]');
  await expect(nextName).toHaveText('Morgan');
  const avatar = page.locator('section[aria-label^="Conversation with "]').getByTestId('chat-avatar').first();
  await expect(avatar.locator('[data-avatar="current"] svg')).toHaveAttribute(
    'data-avatar-seed',
    String(defaultAvatar('morgan').seed),
  );
  await expect(avatar.locator('[data-avatar="previous"]')).toHaveCSS('opacity', '0');
  await page.getByRole('button', { name: 'Open conversation with Riley' }).click();
  await page.getByRole('button', { name: 'Open conversation with Quinn' }).click();
  await expect(page.getByRole('heading', { name: 'Quinn', exact: true }).locator('[data-slot="swap-text"]')).toHaveText(
    'Quinn',
  );
  await expect(avatar.locator('[data-avatar="current"] svg')).toHaveAttribute(
    'data-avatar-seed',
    String(defaultAvatar('quinn').seed),
  );
  await expect(avatar.locator('[data-avatar="previous"]')).toHaveCSS('opacity', '0');
});

test('chat identity switches without animation for reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/chat/agents/avery');
  await page.getByRole('button', { name: 'Open conversation with Morgan' }).click();
  const name = page.getByRole('heading', { name: 'Morgan', exact: true }).locator('[data-slot="swap-text"]');
  await expect(name).toHaveText('Morgan');
  expect(await name.evaluate(element => element.getAnimations().length)).toBe(0);
  const avatar = page.locator('section[aria-label^="Conversation with "]').getByTestId('chat-avatar').first();
  await expect(avatar.locator('[data-avatar="current"]')).toHaveCSS('animation-name', 'none');
  await expect(avatar.locator('[data-avatar="previous"]')).toHaveCSS('opacity', '0');
});

test('messages enter in order with overlapping timing and respect reduced motion', async ({ page }) => {
  await page.goto('/chat/agents/avery');
  const messages = page.getByRole('list', { name: 'Messages' }).locator('[data-message-id]');
  await expect(messages).toHaveCount(3);
  await expect(messages.first()).toHaveCSS('animation-name', 'message-in');
  const timing = await messages.evaluateAll(elements =>
    elements.map(element => {
      const style = getComputedStyle(element);
      return {
        delay: parseFloat(style.animationDelay),
        duration: Math.max(...style.animationDuration.split(',').map(value => parseFloat(value))),
      };
    }),
  );
  const timestamp = page
    .getByRole('region', { name: 'Conversation with Avery' })
    .locator('[data-slot="message-time"]')
    .first();
  await expect(timestamp).toHaveCSS('animation-name', 'message-in');
  expect(await timestamp.evaluate(element => parseFloat(getComputedStyle(element).animationDelay))).toBe(0);
  expect(timing[0].delay).toBe(0.03);
  expect(timing[0].duration).toBe(0.32);
  for (let i = 1; i < timing.length; i++) {
    expect(timing[i].delay).toBeGreaterThan(timing[i - 1].delay);
    expect(timing[i].delay - timing[i - 1].delay).toBeCloseTo(timing[i - 1].duration * 0.1);
  }
  await expect(messages.last()).toHaveCSS('opacity', '1');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Open conversation with Morgan' }).click();
  await expect(messages.first()).toHaveCSS('animation-name', 'none');
  await expect(messages.last()).toHaveCSS('opacity', '1');
});

test('composer sends through the API with Enter or the button and rejects blank messages', async ({ page }) => {
  await page.goto('/chat/agents/avery');
  const input = page.getByLabel('Message Avery');
  const send = page.getByRole('button', { name: 'Send message' });
  const messages = page.getByRole('list', { name: 'Messages' }).locator('[data-message-id]');
  await input.fill('   ');
  await expect(send).toBeDisabled();
  await input.press('Enter');
  await expect(messages).toHaveCount(3);
  await input.fill('Hello from the preview');
  await expect(send).toBeEnabled();
  await input.press('Enter');
  await expect(messages).toHaveCount(4);
  await expect(messages.last()).toContainText('Hello from the preview');
  await expect(messages.last()).toHaveCSS('animation-delay', '0s');
  await expect(input).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Open conversation with Avery' })).toContainText(
    'Hello from the preview',
  );
  await input.fill('Another message');
  await send.click();
  await expect(messages).toHaveCount(5);
  await expect(input).toBeFocused();
  await page.reload();
  await expect(messages).toHaveCount(5);
});

test('sidebar preview and time use the shared swap, and sent history staggers on reentry', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2030, 0, 1, 12, 34));
  await page.goto('/chat/agents/avery');
  const row = page.getByRole('button', { name: 'Open conversation with Avery' });
  const labels = row.locator('[data-slot="swap-text"]');
  await expect(labels).toHaveCount(2);
  await expect(labels.nth(1)).toHaveAttribute('data-prefix', '');
  await page.getByLabel('Message Avery').fill('Updated preview');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(labels.nth(0)).toHaveText('12:34 PM');
  await expect(labels.nth(1)).toHaveText('Updated preview');
  await expect(labels.nth(1)).toHaveAttribute('data-prefix', 'You: ');
  expect(await labels.nth(1).evaluate(element => getComputedStyle(element, '::before').fontWeight)).toBe('500');
  await page.getByRole('button', { name: 'Open conversation with Morgan' }).click();
  await row.click();
  const sentBubble = page.getByRole('list', { name: 'Messages' }).locator('[data-message-id]').last();
  await expect(sentBubble).toHaveCSS('animation-name', 'message-in');
  await expect(sentBubble).toHaveCSS('animation-delay', '0.12s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByLabel('Message Avery').fill('Immediate preview');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(labels.nth(1)).toHaveText('Immediate preview');
  expect(await labels.nth(1).evaluate(element => element.getAnimations().length)).toBe(0);
});

test('drafts and sent messages stay with their agent, with multiline input', async ({ page }) => {
  await page.goto('/chat/agents/avery');
  const avery = page.getByLabel('Message Avery');
  await avery.fill('First line');
  await avery.press('Shift+Enter');
  await avery.press('a');
  await expect(avery).toHaveValue('First line\na');
  await expect(page.getByRole('list', { name: 'Messages' }).locator('li')).toHaveCount(3);
  await page.getByRole('button', { name: 'Open conversation with Morgan' }).click();
  await expect(page.getByLabel('Message Morgan')).toHaveValue('');
  await page.getByLabel('Message Morgan').fill('Only for Morgan');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByRole('button', { name: 'Open conversation with Avery' }).click();
  await expect(avery).toHaveValue('First line\na');
  await avery.press('Enter');
  await expect(page.getByRole('list', { name: 'Messages' })).not.toContainText('Only for Morgan');
  await expect(page.getByRole('list', { name: 'Messages' }).locator('[data-message-id]').last()).toHaveCSS(
    'white-space',
    'pre-wrap',
  );
  await page.getByRole('button', { name: 'Open conversation with Morgan' }).click();
  await expect(page.getByRole('list', { name: 'Messages' })).toContainText('Only for Morgan');
});

test('IME confirmation does not send a message', async ({ page }) => {
  await page.goto('/chat/agents/avery');
  const input = page.getByLabel('Message Avery');
  await input.fill('Draft composition');
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  await expect(input).toHaveValue('Draft composition');
  await expect(page.getByRole('list', { name: 'Messages' }).locator('li')).toHaveCount(3);
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`new messages scroll to the bottom with motion preference: ${reducedMotion}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: 1100, height: 360 });
    await page.goto('/chat/agents/avery');
    const viewport = page.getByRole('region', { name: 'Chat history', exact: true });
    await viewport.evaluate(element => {
      const original = element.scrollTo.bind(element);
      element.scrollTo = ((options: ScrollToOptions) => {
        element.dataset.requestedScrollBehavior = options.behavior;
        original(options);
      }) as typeof element.scrollTo;
    });
    await page.getByLabel('Message Avery').fill(Array.from({ length: 8 }, () => 'Another preview line').join('\n'));
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(viewport).toHaveAttribute(
      'data-requested-scroll-behavior',
      reducedMotion === 'reduce' ? 'instant' : 'smooth',
    );
    await expect
      .poll(() =>
        viewport.evaluate(element => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)),
      )
      .toBeLessThan(2);
  });
}

test('scrollbar appears only when needed without changing chat width', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto('/chat/agents/avery');
  const viewport = page.getByRole('region', { name: 'Chat history', exact: true });
  const scrollbar = page.locator('[data-slot="scroll-area-scrollbar"]');
  await expect(scrollbar).not.toBeVisible();
  const widthBefore = await viewport.evaluate(element => element.clientWidth);
  const input = page.getByLabel('Message Avery');
  await input.fill(Array.from({ length: 40 }, (_, index) => `Preview line ${index + 1}`).join('\n'));
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(scrollbar).toBeVisible();
  expect(await viewport.evaluate(element => element.clientWidth)).toBe(widthBefore);
  await page.getByRole('button', { name: 'Open conversation with Morgan' }).click();
  await expect(scrollbar).not.toBeVisible();
  expect(await viewport.evaluate(element => element.clientWidth)).toBe(widthBefore);
});

test('chat scrollbar appears during scrolling and fades away when idle', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 360 });
  await page.goto('/chat/agents/avery');
  const viewport = page.getByRole('region', { name: 'Chat history', exact: true });
  await expect(viewport).toBeVisible();
  const thumb = page.locator('[data-slot="scroll-area-thumb"]');
  await page.mouse.move(20, 20);
  await expect(thumb).not.toBeVisible();
  await viewport.focus();
  await page.keyboard.press('Home');
  await expect(thumb).toBeVisible();
  expect((await thumb.boundingBox())!.width).toBeLessThanOrEqual(6);
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBe(0);
  await page.keyboard.press('End');
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(thumb).toBeVisible();
  await expect(thumb).not.toBeVisible();
});

test('agent search filters names and handles no matches', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Agent' }).click();
  const search = page.getByPlaceholder('Search agents…');
  await expect(search).toBeVisible();
  await search.fill('  MOR  ');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option')).toContainText('Morgan');
  await search.fill('unknown');
  await expect(page.getByText('No matches')).toBeVisible();
  await search.fill('');
  await expect(page.getByRole('option')).toHaveCount(4);
  await expect(page.getByRole('form', { name: 'Message composer' })).toHaveCount(0);
});

test('phone agent search filters the picker and handles no matches', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/agents');
  await page.getByRole('combobox', { name: 'Agent' }).click();
  const search = page.getByPlaceholder('Search agents…');
  await expect(search).toHaveCSS('font-size', '16px');
  await search.fill('  MOR  ');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option')).toContainText('Morgan');
  await search.fill('unknown');
  await expect(page.getByText('No matches')).toBeVisible();
  await search.fill('');
  await expect(page.getByRole('option')).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('navigation is centered with a moving indicator and pointer cursors', async ({ page }) => {
  await page.goto('/');
  const indicator = page.getByTestId('tab-indicator');
  await expect(indicator).toBeVisible();
  const tabs = page.getByRole('tablist', { name: 'Main navigation' });
  const box = await tabs.boundingBox();
  const width = await page.evaluate(() => window.innerWidth);
  expect(Math.abs(box!.x + box!.width / 2 - width / 2)).toBeLessThan(2);
  await expect(tabs.getByRole('tab', { name: 'Settings' })).toHaveCSS('cursor', 'pointer');
  await expect(page.getByRole('combobox', { name: 'Agent' })).toHaveCSS('cursor', 'pointer');
  await expect(page.getByRole('button', { name: 'Create new agent' })).toHaveCSS('cursor', 'pointer');
  await expect(indicator).toHaveCSS('transition-property', /\btransform\b/);
  const initial = await indicator.boundingBox();
  await tabs.getByRole('tab', { name: 'Settings' }).click();
  await expect.poll(async () => (await indicator.boundingBox())!.x).toBeGreaterThan(initial!.x + 50);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(indicator).toHaveCSS('transition-property', 'none');
});

test('settings is reachable with keyboard-accessible tabs', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Agents', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Chat', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Computers' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'API endpoints' })).toBeVisible();
  await page.getByRole('tab', { name: 'Agents', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Settings for Avery' })).toBeVisible();
});

test('mobile moves between agents with the picker, inline settings and no overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await chooseAgent(page, 'Riley');
  await expect(page.getByRole('region', { name: 'Settings for Riley' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await chooseAgent(page, 'Avery');
  await expect(page.getByRole('region', { name: 'Settings for Avery' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create new agent' })).toBeVisible();
});

test('time labels open each stretch of messages more than five minutes after the one before', async ({ page }) => {
  const start = new Date(2026, 8, 28, 9, 0).getTime();
  await page.route('**/api/channels/*/messages*', route =>
    route.fulfill({
      json: {
        messages: [0, 2, 12].map((minutes, i) => ({
          id: `t-${i}`,
          sequence: i + 1,
          channelId: 'c',
          role: i % 2 ? 'assistant' : 'user',
          text: `At ${minutes} minutes`,
          timestamp: start + minutes * 60_000,
        })),
        nextCursor: null,
      },
    }),
  );
  await page.goto('/chat/agents/avery');
  const labels = page.getByRole('list', { name: 'Messages' }).locator('[data-slot="message-time"]');
  await expect(page.getByRole('list', { name: 'Messages' }).getByText('At 12 minutes')).toBeVisible();
  // 0 and 2 minutes share one label; 12 minutes opens another.
  await expect(labels).toHaveCount(2);
  await expect(labels.first()).toContainText('9:00');
  await expect(labels.last()).toContainText('9:12');
});
