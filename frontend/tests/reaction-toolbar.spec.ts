import { test, expect } from './fixtures';

test.use({ hasTouch: true });

test('shows only real recent emojis and Add Reaction, keeps three in MRU order, and restores them', async ({ page }) => {
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
  const row = page.locator('[data-message-id]').first().locator('xpath=ancestor::li[1]');
  const toolbar = row.getByRole('group', { name: 'Reaction actions' });
  await row.focus();
  await expect(toolbar).toHaveCSS('opacity', '1');
  await expect(toolbar.getByRole('button')).toHaveCount(0);
  await expect(toolbar.getByRole('combobox', { name: 'Add Reaction' })).toBeVisible();
  for (const label of ['Thumbs up', 'Fire', 'Heart', 'Eyes']) {
    await toolbar.getByRole('combobox', { name: 'Add Reaction' }).click();
    await expect(toolbar).toHaveCSS('opacity', '1');
    await page.getByRole('option', { name: label, exact: true }).click();
    await expect(toolbar.getByRole('button', { name: `React with ${label}`, exact: true })).toBeVisible();
  }
  const labels = () => toolbar.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
  expect(await labels()).toEqual(['React with Eyes', 'React with Heart', 'React with Fire']);
  await expect(toolbar.getByRole('button', { name: /edit|reply|more/i })).toHaveCount(0);
  await expect(toolbar.locator('svg')).toHaveCount(1); // Smiley only, no dropdown chevron.
  const fire = toolbar.getByRole('button', { name: 'React with Fire', exact: true });
  await fire.click();
  await expect(fire).toHaveAttribute('aria-pressed', 'false');
  await expect(fire).toBeFocused();
  expect(await labels()).toEqual(['React with Eyes', 'React with Heart', 'React with Fire']);
  await fire.click();
  await expect(fire).toHaveAttribute('aria-pressed', 'true');
  await expect(fire).toBeFocused();
  expect(await labels()).toEqual(['React with Fire', 'React with Eyes', 'React with Heart']);
  fail = true;
  await toolbar.getByRole('combobox', { name: 'Add Reaction' }).click();
  await page.getByRole('option', { name: 'Celebrate', exact: true }).click();
  await expect(row.getByRole('alert')).toHaveText('Reaction not saved.');
  expect(await labels()).toEqual(['React with Fire', 'React with Eyes', 'React with Heart']);
  await page.reload();
  await row.focus();
  await expect(toolbar.getByRole('button')).toHaveCount(3);
  expect(await labels()).toEqual(['React with Fire', 'React with Eyes', 'React with Heart']);
  await page.screenshot({ path: test.info().outputPath('recent-reaction-toolbar.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open conversation with Avery', exact: true }).click();
  await row.tap();
  await expect(toolbar).toHaveCSS('opacity', '1');
  const bounds = await toolbar.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('recent-reaction-toolbar-mobile.png'), animations: 'disabled' });
});
