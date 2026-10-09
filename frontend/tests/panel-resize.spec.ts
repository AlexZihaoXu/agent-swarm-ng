import { test, expect } from './fixtures';

test('the chat list and activity panel edges resize on wide screens and keep their width', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/chat/agents/avery');
  const list = page.getByRole('complementary', { name: 'Chats' });
  await expect(list).toBeVisible();
  const before = (await list.boundingBox())!.width;
  const edge = page.getByRole('separator', { name: 'Resize the chat list' });
  const box = (await edge.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + 200, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await list.boundingBox())!.width).toBeGreaterThan(before + 100);
  // From the keyboard too, and within its bounds.
  await edge.focus();
  await page.keyboard.press('End');
  await expect(edge).toHaveAttribute('aria-valuenow', '480');
  // Kept after a reload; double-click goes back to the default.
  await page.reload();
  await expect(page.getByRole('separator', { name: 'Resize the chat list' })).toHaveAttribute('aria-valuenow', '480');
  await page.getByRole('separator', { name: 'Resize the chat list' }).dblclick();
  await expect(page.getByRole('separator', { name: 'Resize the chat list' })).toHaveAttribute('aria-valuenow', '288');
  // The activity panel's left edge.
  await page
    .getByRole('button', { name: /activity/i })
    .first()
    .click();
  const panel = page.getByRole('dialog', { name: 'Agent activity' });
  await expect(panel).toBeVisible();
  const width = (await panel.boundingBox())!.width;
  const left = page.getByRole('separator', { name: 'Resize the activity panel' });
  await left.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(width + 50);
});

test('no resize edge on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/chat');
  await expect(page.getByRole('separator', { name: 'Resize the chat list' })).toBeHidden();
});
