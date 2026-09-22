import { test, expect, type Page } from './fixtures';
import { avatarShapes, eyePath, eyePoses, defaultAvatar } from '../src/lib/agent-avatar';
import { projectEye } from '../src/lib/avatar-perspective';
async function openCreate(page: Page) {
  await page.goto('/');
  await page.getByRole('complementary', { name: 'Agents', exact: true }).click({ button: 'right', position: { x: 40, y: 360 } });
  await page.getByRole('menuitem', { name: 'Create new agent' }).click();
}
async function select(page: Page, label: string, option: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(page.getByRole('listbox', { includeHidden: true })).toHaveCount(0);
}
const previewArt = (page: Page) => page.getByTestId('agent-avatar-preview').locator('[data-avatar-shape]').first();

test('all silhouettes move; randomization is stable and preserves the state preview', async ({ page }) => {
  await openCreate(page); const art = previewArt(page);
  for (const shape of avatarShapes) {
    await page.getByRole('button', { name: `Preview ${shape.label}`, exact: true }).click();
    await expect(art).toHaveAttribute('data-avatar-shape', shape.id);
    await art.scrollIntoViewIfNeeded(); await expect(art).toHaveAttribute('data-motion', 'enabled');
    const path = art.locator('path').first(), before = await path.getAttribute('d');
    await expect.poll(() => path.getAttribute('d')).not.toBe(before);
  }
  const sample = page.getByTestId('agent-avatar-preview').locator('[data-avatar-sample="32"]');
  await expect(sample.locator('[data-slot="online-indicator"]')).toHaveAttribute('data-state', 'ready');
  await expect(sample.locator('[data-slot="online-indicator"]')).toHaveCSS('width', '10px');
  await select(page, 'State preview', 'Working');
  await expect(sample.locator('[data-slot="online-indicator"]')).toHaveAttribute('data-state', 'working');
  await expect(sample.locator('.presence-dot')).toHaveCSS('animation-name', 'presence-pulse');
  await expect(sample.locator('[data-slot="online-indicator"]')).toHaveCSS('width', '10px');
  await select(page, 'State preview', 'Typing');
  await expect(sample.locator('[data-slot="typing-badge"]')).toHaveCSS('width', '24px');
  await expect(sample.locator('[data-slot="presence-cutout"]')).toHaveCSS('width', '28px');
  await select(page, 'State preview', 'Working');
  await page.getByRole('button', { name: 'Randomize', exact: true }).click();
  const seed = await art.getAttribute('data-avatar-seed');
  await expect(art).toHaveAttribute('data-avatar-state', 'working');
  await page.getByLabel('Agent name', { exact: true }).fill('Astra');
  await expect(art).toHaveAttribute('data-avatar-seed', seed!);
  await select(page, 'Eye shape', 'Circles');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(art.locator('g[stroke]')).toHaveAttribute('stroke-width', '8');
  await expect(art).toHaveAttribute('data-eye-style', 'round');
  await select(page, 'State preview', 'Idle');
  await page.getByLabel('State preview').click(); await expect(page.getByRole('option')).toHaveCount(3); await page.keyboard.press('Escape');
  await page.getByRole('region', { name: 'Agent editor', exact: true }).evaluate(element => { element.scrollTop = 0; });
  await page.getByRole('dialog').screenshot({ path: '../.cache/agent-avatar-preview-desktop.png', animations: 'disabled' });
});

test('disclosure, shape and eye changes transition; the modal scrollbar is inset', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 1100 }); await openCreate(page);
  const toggle = page.getByRole('button', { name: 'Avatar', exact: true });
  const content = page.locator('[data-slot="avatar-disclosure"]');
  const height = (await content.boundingBox())!.height;
  await content.evaluate(element => {
    const heights: number[] = [];
    const observer = new ResizeObserver(() => heights.push(element.getBoundingClientRect().height));
    observer.observe(element); Object.assign(window, { avatarHeights: heights, avatarResizeObserver: observer });
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(content).toHaveAttribute('inert', '');
  await expect.poll(async () => (await content.boundingBox())!.height).toBe(0);
  const heights = await page.evaluate(() => {
    const scope = window as unknown as { avatarHeights: number[]; avatarResizeObserver: ResizeObserver };
    scope.avatarResizeObserver.disconnect(); return scope.avatarHeights;
  });
  expect(heights.some(value => value > 0 && value < height - 1)).toBe(true);
  await toggle.click(); await expect.poll(async () => (await content.boundingBox())!.height).toBeGreaterThan(height - 1);
  const art = previewArt(page);
  await page.getByRole('button', { name: 'Preview Pebble', exact: true }).click(); await expect(art).toHaveAttribute('data-transition', 'idle');
  await page.getByRole('button', { name: 'Preview Triangle', exact: true }).click();
  await expect(art).toHaveAttribute('data-transition', 'running'); await expect(art).toHaveAttribute('data-transition', 'idle');
  await select(page, 'Eye shape', 'Rounded pills'); await expect(art).toHaveAttribute('data-transition', 'idle');
  await art.locator('g[stroke]').evaluate(element => {
    const widths: number[] = [];
    const observer = new MutationObserver(() => widths.push(Number(element.getAttribute('stroke-width'))));
    observer.observe(element, { attributes: true, attributeFilter: ['stroke-width'] }); Object.assign(window, { avatarWidths: widths, avatarWidthObserver: observer });
  });
  await select(page, 'Eye shape', 'Circles'); await expect(art).toHaveAttribute('data-transition', 'idle');
  const widths = await page.evaluate(() => {
    const scope = window as unknown as { avatarWidths: number[]; avatarWidthObserver: MutationObserver };
    scope.avatarWidthObserver.disconnect(); return scope.avatarWidths;
  });
  expect(widths.some(value => value > 4.2 && value < 8)).toBe(true);
  await page.getByRole('button', { name: 'Randomize', exact: true }).click();
  await expect(art).toHaveAttribute('data-transition', 'running'); await expect(art).toHaveAttribute('data-transition', 'idle');
  await page.setViewportSize({ width: 360, height: 650 });
  const viewport = page.getByRole('region', { name: 'Agent editor', exact: true });
  await viewport.evaluate(element => { element.scrollTop = 150; });
  const scrollbar = page.getByRole('dialog').locator('[data-slot="scroll-area-scrollbar"]');
  await expect(scrollbar).toBeVisible();
  const dialogBox = (await page.getByRole('dialog').boundingBox())!, barBox = (await scrollbar.boundingBox())!;
  expect(dialogBox.x + dialogBox.width - barBox.x - barBox.width).toBeGreaterThanOrEqual(10);
  expect(await viewport.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await page.getByRole('dialog').screenshot({ path: '../.cache/avatar-editor-inset-scrollbar.png', animations: 'disabled' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toggle.click(); await expect(content).toHaveCSS('transition-property', 'none');
});

test('look preview glides through intermediate poses instead of snapping', async ({ page }) => {
  await openCreate(page);
  await page.getByRole('button', { name: 'Preview Pebble', exact: true }).click();
  await select(page, 'Eye shape', 'Rounded pills'); await select(page, 'Look preview', 'Forward');
  const art = previewArt(page), eye = art.locator('[data-eye-view="left"]');
  await art.scrollIntoViewIfNeeded();
  const start = projectEye(eyePoses.idle[0], { x: 0, y: 0 }, 'pebble').transform;
  const target = projectEye(eyePoses.idle[0], { x: 2.5, y: -1.3 }, 'pebble').transform;
  await expect(eye).toHaveAttribute('transform', start);
  await eye.evaluate(element => {
    const frames: string[] = [];
    const observer = new MutationObserver(() => { if (frames.length < 512) frames.push(element.getAttribute('transform') ?? ''); });
    observer.observe(element, { attributes: true, attributeFilter: ['transform'] });
    Object.assign(window, { avatarViewFrames: frames, avatarViewObserver: observer });
  });
  await select(page, 'Look preview', 'Upper right'); await art.scrollIntoViewIfNeeded();
  await expect(eye).toHaveAttribute('transform', target);
  const frames = await page.evaluate(() => {
    const scope = window as unknown as { avatarViewFrames: string[]; avatarViewObserver: MutationObserver };
    scope.avatarViewObserver.disconnect(); return scope.avatarViewFrames;
  });
  expect(frames.some(frame => frame !== start && frame !== target)).toBe(true);
});

test('direction previews turn the face in depth without rotating the eyelid closure', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await openCreate(page);
  await page.getByRole('button', { name: 'Preview Pebble', exact: true }).click();
  const art = previewArt(page);
  for (const eyes of ['Rounded pills', 'Circles']) {
    await select(page, 'Eye shape', eyes);
    for (const [direction, angle] of [['Upper left', 28], ['Upper right', -28], ['Lower left', -28], ['Lower right', 28]] as const) {
      await select(page, 'Look preview', direction);
      await expect(art.locator('[data-eye-view="left"]')).toHaveAttribute('transform', new RegExp(`rotate\\(${angle}\\)`));
      await expect(art.locator('[data-eyelid="left"]')).toHaveAttribute('transform', /scale\(1 1\)/);
      expect(await art.locator('[data-eyelid="left"]').getAttribute('transform')).not.toMatch(/rotate|skew/);
      await art.scrollIntoViewIfNeeded();
      await page.getByTestId('agent-avatar-preview').screenshot({ path: `../.cache/avatar-depth-${eyes === 'Circles' ? 'round' : 'pill'}-${direction.replaceAll(' ', '-')}.png`, animations: 'disabled' });
    }
  }
});

test('motion pauses offscreen, hidden, collapsed and for reduced motion; keyboard controls work', async ({ page }) => {
  await openCreate(page); const art = previewArt(page);
  await page.getByRole('button', { name: 'Preview Bean', exact: true }).focus(); await page.keyboard.press('Space');
  await expect(art).toHaveAttribute('data-avatar-shape', 'bean');
  await art.scrollIntoViewIfNeeded();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(art).toHaveAttribute('data-motion', 'paused');
  await page.evaluate(() => { Reflect.deleteProperty(document, 'hidden'); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(art).toHaveAttribute('data-motion', 'enabled');
  await page.getByRole('button', { name: 'Avatar', exact: true }).click();
  await expect(art).toHaveAttribute('data-motion', 'static');
  await page.getByRole('button', { name: 'Avatar', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await select(page, 'Eye shape', 'Rounded pills'); await select(page, 'State preview', 'Typing');
  await expect(art).toHaveAttribute('data-motion', 'static');
  await expect(art.locator('g[stroke] path').first()).toHaveAttribute('d', eyePath(eyePoses.typing[0]));
  const before = await art.locator('path').first().getAttribute('d');
  await page.getByLabel('Agent name', { exact: true }).fill('No reshuffle');
  expect(await art.locator('path').first().getAttribute('d')).toBe(before);
});

test('existing agents can edit and persist appearance without changing their chat or identity', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  const card = page.getByRole('button', { name: 'Open conversation with Avery' });
  const beforeMessages = await page.getByRole('list', { name: 'Messages' }).innerText();
  await card.click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Edit agent', exact: true }).click();
  await page.getByRole('button', { name: 'Preview Triangle', exact: true }).click();
  await select(page, 'Avatar color', 'Apricot'); await select(page, 'Eye shape', 'Circles');
  const seed = await previewArt(page).getAttribute('data-avatar-seed');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const header = page.getByTestId('chat-avatar').locator('[data-avatar="current"] svg');
  await expect(header).toHaveAttribute('data-avatar-shape', 'triangle');
  await expect(header).toHaveAttribute('data-eye-style', 'round');
  await expect(card.locator('[data-avatar-shape]')).toHaveAttribute('data-avatar-seed', seed!);
  expect(await page.getByRole('list', { name: 'Messages' }).innerText()).toBe(beforeMessages);
  await page.reload();
  await expect(header).toHaveAttribute('data-avatar-shape', 'triangle');
  await expect(header.locator('path').first()).toHaveAttribute('fill', '#f7ad51');
  await card.click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Edit agent', exact: true }).click();
  await page.getByRole('button', { name: 'Randomize', exact: true }).click();
  await page.route('**/api/agents/avery/settings', route => route.request().method() === 'PATCH' ? route.fulfill({ status: 503, json: { message: 'Save failed' } }) : route.fallback());
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Save failed');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(header).toHaveAttribute('data-avatar-seed', seed!);
});

test('creation sends appearance but never the preview state', async ({ page }) => {
  await page.route('**/api/model-endpoints', route => route.fulfill({ json: [{ id: 'fixture', name: 'Fixture', baseUrl: 'http://test.invalid/v1' }] }));
  await page.route('**/api/model-endpoints/test', route => route.fulfill({ json: { models: ['test-model'] } }));
  await page.route('**/api/agents/model-capabilities?*', route => route.fulfill({ json: { thinkingLevels: ['off'], reasoning: false } }));
  let created: Record<string, any> | undefined;
  await page.route('**/api/agents', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { agents: [], nextCursor: null } });
    created = route.request().postDataJSON();
    return route.fulfill({ json: { ...created, id: 'new-avatar', channelId: 'new-channel', createdAt: 1, lastMessage: null } });
  });
  await openCreate(page); await page.getByLabel('Agent name', { exact: true }).fill('New avatar');
  await page.getByRole('button', { name: 'Preview Bean', exact: true }).click(); await select(page, 'Eye shape', 'Circles');
  await select(page, 'State preview', 'Typing');
  await select(page, 'Endpoint', 'Fixture'); await select(page, 'Model', 'test-model');
  await page.getByRole('button', { name: 'Create agent', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New avatar', exact: true })).toBeVisible();
  expect(created?.avatar).toMatchObject({ shape: 'bean', eyeStyle: 'round' });
  expect(created?.avatar).not.toHaveProperty('state');
  await expect(page.getByTestId('chat-avatar').locator('[data-avatar="current"] svg')).toHaveAttribute('data-avatar-state', 'idle');
});

test('mobile preview is scrollable without horizontal overflow and unsaved changes cancel', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/'); const card = page.getByRole('button', { name: 'Open conversation with Avery' });
  const original = defaultAvatar('avery');
  await card.click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Edit agent', exact: true }).click();
  await page.getByRole('button', { name: 'Preview Triangle', exact: true }).click(); await select(page, 'Eye shape', 'Circles');
  const dialog = page.getByRole('dialog'); expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByRole('region', { name: 'Agent editor', exact: true }).evaluate(element => { element.scrollTop = 0; });
  await dialog.screenshot({ path: '../.cache/agent-avatar-preview-mobile.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(card.locator('[data-avatar-shape]')).toHaveAttribute('data-avatar-seed', String(original.seed));
});
