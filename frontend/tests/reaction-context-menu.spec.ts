import { test, expect } from './fixtures';

test('right-click menus share a surface and fade-scale from their anchor, highlighting only the active message', async ({ page }) => {
  await page.goto('/');
  const bubble = page.locator('[data-message-id="avery-0"]');
  const other = page.locator('[data-message-id="avery-1"]');
  const idleShadow = await bubble.evaluate(element => getComputedStyle(element).boxShadow);
  await bubble.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Message actions' });
  await expect(menu).toHaveCSS('background-color', 'rgb(36, 36, 36)');
  await expect(menu).toHaveCSS('animation-name', 'dialog-in');
  await expect(bubble).toHaveAttribute('data-state', 'open');
  await expect.poll(() => bubble.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe(idleShadow);
  await expect(other).toHaveCSS('box-shadow', 'none');
  const origin = await menu.evaluate(element => getComputedStyle(element).transformOrigin);
  expect(origin).toMatch(/^0px /);
  await menu.getByRole('menuitem', { name: 'Add reaction' }).hover();
  const submenu = page.getByRole('menu').last();
  await expect(submenu).toHaveCSS('background-color', 'rgb(36, 36, 36)');
  await expect(submenu).toHaveCSS('animation-name', 'dialog-in');
  const closeAnimation = page.evaluate(() => new Promise<string>(resolve => {
    const target = document.querySelector<HTMLElement>('[aria-label="Message actions"]')!;
    const observer = new MutationObserver(() => {
      if (target.dataset.state === 'closed') { observer.disconnect(); resolve(getComputedStyle(target).animationName); }
    });
    observer.observe(target, { attributes: true, attributeFilter: ['data-state'] });
    setTimeout(() => { observer.disconnect(); resolve('missing'); }, 1000);
  }));
  await page.keyboard.press('Escape');
  expect(await closeAnimation).toBe('dialog-out');
  await expect(menu).toHaveCount(0);
  await expect(bubble).toHaveCSS('box-shadow', idleShadow);

  await page.getByRole('complementary', { name: 'Agents' }).click({ button: 'right', position: { x: 40, y: 350 } });
  const agentMenu = page.getByRole('menu');
  await expect(agentMenu).toHaveCSS('background-color', 'rgb(36, 36, 36)');
  await expect(agentMenu).toHaveCSS('animation-name', 'dialog-in');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Chat' }).click();
  await page.getByRole('complementary', { name: 'Chats' }).click({ button: 'right', position: { x: 40, y: 350 } });
  const chatMenu = page.getByRole('menu');
  await expect(chatMenu).toHaveCSS('background-color', 'rgb(36, 36, 36)');
  await expect(chatMenu).toHaveCSS('animation-name', 'dialog-in');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Agents' }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bubble.click({ button: 'right' });
  await expect(menu).toHaveCSS('animation-name', 'none');
});

test('existing reactions have a spaced, larger emoji and a nearby Add reaction picker', async ({ page }) => {
  const saved = new Map<string, { emoji: string; count: number; mine: boolean }[]>();
  await page.route('**/api/chats/*/reactions*', route => route.fulfill({ json: { messages: new URL(route.request().url()).searchParams.getAll('ids').map(id => ({ id, reactions: saved.get(id) ?? [] })) } }));
  await page.route('**/api/chats/*/messages/*/reaction', route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
    const { emoji, active } = route.request().postDataJSON();
    const next = (saved.get(id) ?? []).filter(item => item.emoji !== emoji);
    if (active) next.push({ emoji, count: 1, mine: true });
    saved.set(id, next); return route.fulfill({ json: { reactions: next } });
  });
  await page.goto('/');
  const bubble = page.locator('[data-message-id="avery-0"]');
  const row = bubble.locator('xpath=ancestor::li[1]');
  await expect(row.getByRole('button', { name: 'Add reaction' })).toHaveCount(0);
  await bubble.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add reaction' }).hover();
  await page.getByRole('searchbox', { name: 'Search emojis' }).fill('fire');
  await page.getByRole('group', { name: 'Emoji choices' }).getByRole('button', { name: 'fire', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Message actions' })).toHaveCount(0);
  const chip = row.getByRole('button', { name: 'Fire: 1 reaction' });
  await expect(chip).toBeVisible();
  await expect(row.getByLabel('Message reactions')).toHaveCSS('margin-left', '8px');
  await expect(chip.locator('span').first()).toHaveCSS('font-size', '16px');
  const picker = row.getByRole('button', { name: 'Add reaction' });
  await expect(picker).toBeVisible();
  const chipBounds = (await chip.boundingBox())!, pickerBounds = (await picker.boundingBox())!;
  expect(pickerBounds.x).toBeGreaterThan(chipBounds.x + chipBounds.width);
  await picker.click();
  const emojiDialog = page.getByRole('dialog');
  const emojiResults = emojiDialog.getByRole('region', { name: 'Emoji results' });
  await emojiResults.hover();
  await emojiResults.evaluate(element => { element.scrollTop = 100; element.dispatchEvent(new Event('scroll')); });
  await expect(emojiResults.locator('xpath=..').locator('[data-slot="scroll-area-thumb"]')).toHaveCount(1);
  await emojiDialog.getByRole('searchbox', { name: 'Search emojis' }).fill('red heart');
  await emojiDialog.getByRole('group', { name: 'Emoji choices' }).getByRole('button', { name: 'red heart', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Heart: 1 reaction' })).toBeVisible();
  await picker.click();
  await emojiDialog.getByRole('searchbox', { name: 'Search emojis' }).fill('coder');
  await emojiDialog.getByRole('group', { name: 'Emoji choices' }).getByRole('button', { name: 'woman technologist: medium skin tone', exact: true }).click();
  await expect(row.getByRole('button', { name: '👩🏽‍💻: 1 reaction' })).toBeVisible();
  await picker.click();
  await emojiDialog.getByRole('searchbox', { name: 'Search emojis' }).fill('canada');
  await emojiDialog.getByRole('group', { name: 'Emoji choices' }).getByRole('button', { name: 'flag: Canada', exact: true }).click();
  await expect(row.getByRole('button', { name: '🇨🇦: 1 reaction' })).toBeVisible();
});

test('right-clicking a bubble opens recent reactions, an emoji submenu, and Reply', async ({ page }) => {
  const saved = new Map<string, { emoji: string; count: number; mine: boolean }[]>();
  let fail = false;
  await page.route('**/api/chats/*/reactions*', route => route.fulfill({ json: { messages: new URL(route.request().url()).searchParams.getAll('ids').map(id => ({ id, reactions: saved.get(id) ?? [] })) } }));
  await page.route('**/api/chats/*/messages/*/reaction', route => {
    if (fail) return route.fulfill({ status: 503, json: { message: 'Reaction not saved.' } });
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
    const { emoji, active } = route.request().postDataJSON();
    const next = (saved.get(id) ?? []).filter(item => item.emoji !== emoji);
    if (active) next.push({ emoji, count: 1, mine: true });
    saved.set(id, next); return route.fulfill({ json: { reactions: next } });
  });
  await page.goto('/');
  const bubble = page.locator('[data-message-id="avery-0"]');
  const row = bubble.locator('xpath=ancestor::li[1]');
  const idle = await row.evaluate(element => getComputedStyle(element).backgroundColor);
  await bubble.hover();
  await expect.poll(() => row.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(idle);
  await expect(page.getByRole('menu', { name: 'Message actions' })).toHaveCount(0);
  await bubble.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Message actions' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('group', { name: 'Recent reactions' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Reply' })).not.toHaveAttribute('aria-disabled', 'true');
  const add = menu.getByRole('menuitem', { name: 'Add reaction' });
  await add.hover();
  await page.getByRole('searchbox', { name: 'Search emojis' }).fill('thumbs up');
  const thumbs = page.getByRole('group', { name: 'Emoji choices' }).getByRole('button', { name: 'thumbs up', exact: true });
  await expect(thumbs).toBeVisible();
  const triggerBounds = (await add.boundingBox())!, submenuBounds = (await thumbs.boundingBox())!;
  expect(submenuBounds.x).toBeGreaterThanOrEqual(triggerBounds.x + triggerBounds.width - 4);
  await thumbs.click();
  await expect(row.getByRole('button', { name: 'Thumbs up: 1 reaction' })).toBeVisible();

  for (const { label, query, option } of [
    { label: 'Fire', query: 'fire', option: 'fire' },
    { label: 'Heart', query: 'red heart', option: 'red heart' },
    { label: 'Eyes', query: 'eyes', option: 'eyes' },
    { label: 'Laugh', query: 'face with tears of joy', option: 'face with tears of joy' },
  ]) {
    await bubble.click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Add reaction' }).hover();
    await page.getByRole('searchbox', { name: 'Search emojis' }).fill(query);
    await page.getByRole('group', { name: 'Emoji choices' }).getByRole('button', { name: option, exact: true }).click();
    await expect(row.getByRole('button', { name: `${label}: 1 reaction` })).toBeVisible();
  }
  await bubble.click({ button: 'right' });
  const recents = menu.getByRole('group', { name: 'Recent reactions' });
  const labels = () => recents.getByRole('menuitem').evaluateAll(items => items.map(item => item.getAttribute('aria-label')));
  expect(await labels()).toEqual(['Remove Laugh reaction', 'Remove Eyes reaction', 'Remove Heart reaction', 'Remove Fire reaction']);
  await recents.getByRole('menuitem', { name: 'Remove Fire reaction' }).click();
  await expect(row.getByRole('button', { name: 'Fire: 1 reaction' })).toHaveCount(0);
  await bubble.click({ button: 'right' });
  expect(await labels()).toEqual(['Remove Laugh reaction', 'Remove Eyes reaction', 'Remove Heart reaction', 'React with Fire']);
  await recents.getByRole('menuitem', { name: 'React with Fire' }).click();
  await expect(row.getByRole('button', { name: 'Fire: 1 reaction' })).toBeVisible();
  await bubble.click({ button: 'right' });
  expect(await labels()).toEqual(['Remove Fire reaction', 'Remove Laugh reaction', 'Remove Eyes reaction', 'Remove Heart reaction']);
  fail = true;
  await menu.getByRole('menuitem', { name: 'Add reaction' }).hover();
  await page.getByRole('searchbox', { name: 'Search emojis' }).fill('party popper');
  await page.getByRole('group', { name: 'Emoji choices' }).getByRole('button', { name: 'party popper', exact: true }).click();
  await expect(row.getByRole('alert')).toHaveText('Reaction not saved.');
  await bubble.click({ button: 'right' });
  expect(await labels()).toEqual(['Remove Fire reaction', 'Remove Laugh reaction', 'Remove Eyes reaction', 'Remove Heart reaction']);
  await page.keyboard.press('Escape');
  await bubble.focus();
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Add reaction' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('searchbox', { name: 'Search emojis' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await bubble.click({ button: 'right' });
  expect(await labels()).toEqual(['Remove Fire reaction', 'Remove Laugh reaction', 'Remove Eyes reaction', 'Remove Heart reaction']);
  await page.screenshot({ path: test.info().outputPath('reaction-context-menu.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.locator('[data-message-id="avery-1"]').click({ button: 'right' });
  await expect(menu).toBeVisible();
});

test.describe('touch', () => {
  test.use({ hasTouch: true });
  test('a real touch with slight finger drift opens the right-click menu', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open conversation with Avery' }).click();
    const bubble = page.locator('[data-message-id="avery-0"]');
    await expect(bubble).toHaveCSS('user-select', 'none');
    const box = (await bubble.boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const client = await page.context().newCDPSession(page);
    const menu = page.getByRole('menu', { name: 'Message actions' });
    let touching = false;
    const start = async () => { touching = true; await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); };
    const end = async () => { if (touching) { touching = false; await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); } };
    try {
      await start();
      await page.waitForTimeout(100);
      await end();
      await page.waitForTimeout(750);
      await expect(menu).toHaveCount(0);

      await start();
      await page.waitForTimeout(130);
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 30, y: y + 25, id: 1 }] });
      await page.waitForTimeout(800);
      await expect(menu).toHaveCount(0);
      await end();

      await start();
      await page.waitForTimeout(130);
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 3, y: y + 2, id: 1 }] });
      await expect(menu).toBeVisible({ timeout: 1800 });
      await end();
      await expect(menu).toBeVisible();
      await menu.getByRole('menuitem', { name: 'Reply' }).tap();
      await expect(page.getByLabel('Replying to Avery')).toBeVisible();
    } finally {
      await end();
      await client.detach();
    }
  });

  test('a group message uses the same menu on a real mobile hold', async ({ page }) => {
    const group = { id: 'team', name: 'Team', createdAt: Date.now(), members: [], lastMessage: null };
    const messages = [{ id: 'group-1', sequence: 1, groupId: 'team', role: 'user', authorId: null, authorName: 'You', authorAvatar: null, text: 'Group note', timestamp: Date.now(), replyTo: null }];
    await page.route(/\/api\/groups(?:\?.*)?$/, route => route.fulfill({ json: { groups: [group], nextCursor: null } }));
    await page.route('**/api/groups/team', route => route.fulfill({ json: group }));
    await page.route('**/api/groups/team/messages*', route => route.fulfill({ json: { messages, nextCursor: null } }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('tab', { name: 'Chat' }).click();
    await page.getByRole('button', { name: 'Open group chat Team' }).click();
    const bubble = page.locator('[data-message-id="group-1"] .message-context-target');
    const box = (await bubble.boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const client = await page.context().newCDPSession(page);
    try {
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await page.waitForTimeout(130);
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 3, y: y + 2, id: 1 }] });
      const menu = page.getByRole('menu', { name: 'Message actions' });
      await expect(menu).toBeVisible({ timeout: 1800 });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await menu.getByRole('menuitem', { name: 'Reply' }).tap();
      await expect(page.getByLabel('Replying to You')).toBeVisible();
    } finally {
      await client.detach();
    }
  });

  test('long-press opens the message actions without hover', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const saved = new Map<string, { emoji: string; count: number; mine: boolean }[]>();
    await page.route('**/api/chats/*/reactions*', route => route.fulfill({ json: { messages: new URL(route.request().url()).searchParams.getAll('ids').map(id => ({ id, reactions: saved.get(id) ?? [] })) } }));
    await page.route('**/api/chats/*/messages/*/reaction', route => {
      const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
      saved.set(id, [{ emoji: '👍', count: 1, mine: true }]);
      return route.fulfill({ json: { reactions: saved.get(id) } });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open conversation with Avery' }).click();
    const bubble = page.locator('[data-message-id="avery-0"]');
    await expect(page.getByRole('menu', { name: 'Message actions' })).toHaveCount(0);
    await bubble.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
    const menu = page.getByRole('menu', { name: 'Message actions' });
    await expect(menu).toBeVisible();
    await bubble.dispatchEvent('pointerup', { pointerType: 'touch', button: 0 });
    const bounds = (await menu.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await expect(menu.getByRole('menuitem', { name: 'Reply' })).not.toHaveAttribute('aria-disabled', 'true');
    await menu.getByRole('menuitem', { name: 'Add reaction' }).tap();
    await page.getByRole('searchbox', { name: 'Search emojis' }).fill('thumbs up');
    await page.getByRole('group', { name: 'Emoji choices' }).getByRole('button', { name: 'thumbs up', exact: true }).tap();
    await expect(bubble.locator('xpath=ancestor::li[1]').getByRole('button', { name: 'Thumbs up: 1 reaction' })).toBeVisible();
  });
});
