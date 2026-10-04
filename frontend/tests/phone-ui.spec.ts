import { test, expect } from './fixtures';
import { sampleAgents } from './sample-agents';

const size = async (element: { boundingBox: () => Promise<{ width: number; height: number } | null> }) =>
  (await element.boundingBox())!;

for (const width of [320, 390])
  test(`phone controls and reply composer remain reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    for (const label of ['Agents', 'Chat', 'Computers', 'Settings'])
      expect((await size(page.getByRole('tab', { name: label }))).height).toBeGreaterThanOrEqual(44);
    // Agents keeps its picker and + at the top, finger-sized.
    expect((await size(page.getByRole('combobox', { name: 'Agent' }))).height).toBeGreaterThanOrEqual(44);
    expect((await size(page.getByRole('button', { name: 'Create new agent' }))).width).toBeGreaterThanOrEqual(44);
    await page.getByRole('tab', { name: 'Chat' }).click();
    expect((await size(page.getByRole('button', { name: 'Create group chat' }))).width).toBeGreaterThanOrEqual(44);
    await expect(page.getByLabel('Search chats')).toHaveCSS('font-size', '16px');
    await page.getByRole('button', { name: 'Open conversation with Avery' }).click();
    expect((await size(page.getByRole('button', { name: 'Back to chats' }))).height).toBeGreaterThanOrEqual(44);
    expect((await size(page.getByRole('button', { name: 'Agent activity' }))).width).toBeGreaterThanOrEqual(44);
    const input = page.getByLabel('Message Avery');
    const composer = (await page.getByRole('form', { name: 'Message composer' }).boundingBox())!;
    const inputBounds = (await input.boundingBox())!;
    expect(composer.x).toBeGreaterThanOrEqual(24);
    expect(composer.x + composer.width).toBeLessThanOrEqual(width - 24);
    expect(inputBounds.x - composer.x).toBeGreaterThanOrEqual(12);
    await expect(input).toHaveCSS('font-size', '16px');
    await input.fill('Phone reply');
    expect((await size(page.getByRole('button', { name: 'Send message' }))).width).toBeGreaterThanOrEqual(44);
    const bubble = page.locator('[data-message-id="avery-0"]');
    await bubble.click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Message actions' });
    expect((await size(menu.getByRole('menuitem', { name: 'Reply' }))).height).toBeGreaterThanOrEqual(44);
    expect((await size(menu.getByRole('menuitem', { name: 'Add reaction' }))).height).toBeGreaterThanOrEqual(44);
    await menu.getByRole('menuitem', { name: 'Reply' }).click();
    expect((await size(page.getByRole('button', { name: 'Cancel reply' }))).width).toBeGreaterThanOrEqual(44);
    await expect(input).toHaveValue('Phone reply');
    if (width === 320)
      await page.screenshot({ path: test.info().outputPath('phone-reply-320.png'), animations: 'disabled' });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.getByRole('button', { name: 'Back to chats' }).click();
    await page.getByRole('tab', { name: 'Settings' }).click();
    expect((await size(page.getByRole('button', { name: 'Connect ChatGPT' }))).height).toBeGreaterThanOrEqual(44);
    expect((await size(page.getByRole('button', { name: 'Add endpoint' }))).height).toBeGreaterThanOrEqual(44);
    await page.getByRole('button', { name: 'Add endpoint' }).click();
    await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveCSS('font-size', '16px');
    expect((await size(page.getByRole('textbox', { name: 'Name', exact: true }))).height).toBeGreaterThanOrEqual(44);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });

test('group header, reply and composer fit a narrow phone without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const group = {
    id: 'team',
    name: 'Research notes and plans',
    members: [{ id: 'avery', name: 'Avery', avatar: null, channelId: sampleAgents[0].channelId }],
    lastMessage: null,
    createdAt: Date.now(),
  };
  const message = {
    id: 'group-1',
    sequence: 1,
    groupId: 'team',
    role: 'assistant',
    authorId: 'avery',
    authorName: 'Avery',
    authorAvatar: null,
    text: 'A result',
    timestamp: Date.now(),
    replyTo: null,
  };
  await page.route(/\/api\/groups(?:\?.*)?$/, route => route.fulfill({ json: { groups: [group], nextCursor: null } }));
  await page.route('**/api/groups/team', route => route.fulfill({ json: group }));
  await page.route('**/api/groups/team/messages*', route =>
    route.fulfill({ json: { messages: [message], nextCursor: null } }),
  );
  await page.goto('/');
  await page.getByRole('tab', { name: 'Chat' }).click();
  await page.getByRole('button', { name: 'Open group chat Research notes and plans' }).click();
  expect((await size(page.getByRole('button', { name: 'Back to chats' }))).height).toBeGreaterThanOrEqual(44);
  const edit = await size(page.getByRole('button', { name: 'Edit group chat' }));
  expect(edit.height).toBeGreaterThanOrEqual(44);
  expect(edit.width).toBe(44);
  expect((await size(page.getByRole('button', { name: 'Chat files' }))).width).toBe(44);
  // Back, Files and Edit share the 320px header with the title, which keeps a readable width.
  expect((await size(page.getByRole('heading', { name: 'Research notes and plans' }))).width).toBeGreaterThanOrEqual(
    110,
  );
  await page.getByText('A result', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reply' }).click();
  await expect(page.getByLabel('Replying to Avery')).toContainText('A result');
  await expect(page.getByLabel('Message Research notes and plans')).toHaveCSS('font-size', '16px');
  const composer = (await page.getByRole('form', { name: 'Message composer' }).boundingBox())!;
  expect(composer.x).toBeGreaterThanOrEqual(24);
  expect(composer.x + composer.width).toBeLessThanOrEqual(320 - 24);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.screenshot({ path: test.info().outputPath('phone-group-320.png'), animations: 'disabled' });
});

test('phone agent creation and editing expose reachable form and permission controls', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  // The Agents bar above the settings keeps its context menu.
  const panel = page.getByRole('complementary', { name: 'Agents' });
  await expect(page.getByRole('combobox', { name: 'Agent' })).toContainText('Avery');
  const bar = (await panel.boundingBox())!;
  await panel.click({ button: 'right', position: { x: bar.width - 70, y: bar.height / 2 } });
  await page.getByRole('menuitem', { name: 'Create new agent' }).click();
  await expect(page.getByLabel('Agent name')).toHaveCSS('font-size', '16px');
  expect((await size(page.getByLabel('Agent name'))).height).toBeGreaterThanOrEqual(44);
  expect((await size(page.getByRole('button', { name: 'Avatar', exact: true }))).height).toBeGreaterThanOrEqual(44);
  expect((await size(page.getByRole('button', { name: 'Randomize' }))).height).toBeGreaterThanOrEqual(44);
  expect((await size(page.getByLabel('Avatar color'))).height).toBeGreaterThanOrEqual(44);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/agents\/avery$/);
  const editor = page.getByRole('region', { name: 'Settings for Avery' });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('tablist', { name: 'Agent editor sections' })).toHaveCount(0);
  await expect(editor.getByRole('checkbox', { name: 'Morgan' })).toBeVisible();
  await expect(page.getByLabel('Find agents')).toHaveCSS('font-size', '16px');
  await editor.getByRole('heading', { name: 'Avatar' }).scrollIntoViewIfNeeded();
  expect((await size(editor.getByRole('button', { name: 'Preview Triangle' }))).height).toBeGreaterThanOrEqual(44);
  await editor.getByRole('button', { name: 'Preview Triangle' }).click();
  expect((await size(page.getByRole('button', { name: 'Save changes' }))).height).toBeGreaterThanOrEqual(44);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test('phone emoji picker keeps its search and choices finger-sized', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/chat');
  await page.getByRole('button', { name: 'Open conversation with Avery' }).click();
  await page.locator('[data-message-id="avery-0"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add reaction' }).click();
  const menu = page.getByRole('menu', { name: 'Message actions' });
  const search = page.getByRole('searchbox', { name: 'Search emojis' });
  await expect(search).not.toBeFocused();
  await expect(menu).toBeVisible();
  await search.click();
  await expect(search).toBeFocused();
  await expect(menu).toBeVisible();
  await expect(search).toHaveCSS('font-size', '16px');
  expect((await size(search)).height).toBeGreaterThanOrEqual(44);
  await search.fill('fire');
  // Popper repositions after the results re-render; wait for it to settle inside the viewport.
  await expect.poll(async () => (await menu.boundingBox())!.x).toBeGreaterThanOrEqual(0);
  const menuBox = (await menu.boundingBox())!;
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(320);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(640);
  const choices = page.getByRole('group', { name: 'Emoji choices' }).getByRole('button');
  const fourth = (await choices.nth(3).boundingBox())!;
  expect(fourth.x + fourth.width).toBeLessThanOrEqual(320);
  const choice = page.getByRole('group', { name: 'Emoji choices' }).getByRole('button', { name: 'fire', exact: true });
  expect((await size(choice)).width).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: test.info().outputPath('phone-emoji-320.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 320, height: 400 });
  await expect
    .poll(async () => {
      const box = await page.getByRole('menu', { name: 'Message actions' }).boundingBox();
      return box ? box.y + box.height : Infinity;
    })
    .toBeLessThanOrEqual(400);
  await expect(search).toBeInViewport();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});
