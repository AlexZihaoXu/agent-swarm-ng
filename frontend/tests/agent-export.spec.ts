import { test, expect } from './fixtures';
import { sampleAgents } from './sample-agents';

test('export offers every part but the bot token, and downloads the file with the chosen parts', async ({ page }) => {
  await page.goto('/chat/agents/avery');
  await page.locator('[data-chat-kind="dm"][data-chat-id="morgan"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Export agent…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export Morgan' });
  for (const part of ['Live context', 'Memories', 'Scratchpad', 'Private chat', 'Agent DMs', 'Discord', 'Activity log'])
    await expect(dialog.getByRole('switch', { name: part, exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('switch', { name: 'Discord bot token' })).toHaveAttribute('aria-checked', 'false');
  await dialog.getByRole('switch', { name: 'Activity log' }).click();
  const link = dialog.getByRole('link', { name: 'Export' });
  await expect(link).toHaveAttribute(
    'href',
    '/api/agents/morgan/export?parts=context,memories,scratchpad,chat,dms,discord',
  );
  await dialog.getByRole('switch', { name: 'Discord bot token' }).click();
  await expect(link).toHaveAttribute('href', /discordToken$/);
});

test('an imported agent arrives paused and grayed; its settings show what to fix in red, then it resumes', async ({
  page,
}) => {
  const imported = { ...structuredClone(sampleAgents[1]), id: 'nova', name: 'Nova', channelId: 'nova', paused: true };
  let review = {
    paused: true,
    problems: [
      { section: 'model', row: 0, message: 'This provider does not exist here. Switch to one of your connections.' },
      {
        section: 'links',
        kind: 'computers',
        id: 'gone',
        name: 'Old desk',
        message: 'The computer “Old desk” is not on this swarm. Remove it, then assign one of yours.',
      },
    ],
  };
  let uploaded = 0;
  await page.route('**/api/agents/import?*', async route => {
    uploaded = route.request().postDataBuffer()?.byteLength ?? 0;
    return route.fulfill({ status: 201, json: { agent: imported, skipped: { dms: 0, links: 1 } } });
  });
  await page.route('**/api/agents/nova/review', route => route.fulfill({ json: review }));
  await page.route('**/api/agents/nova/review/remove', route => {
    review = { ...review, problems: review.problems.filter(problem => problem.section !== 'links') };
    return route.fulfill({ json: review });
  });
  await page.route('**/api/agents/nova/resume', route => {
    if (review.problems.length)
      return route.fulfill({ status: 409, json: { message: 'Fix them first.', problems: [] } });
    review = { paused: false, problems: [] };
    return route.fulfill({ json: review });
  });
  await page.route('**/api/channels/nova/messages*', route =>
    route.fulfill({ json: { messages: [], nextCursor: null } }),
  );
  await page.goto('/chat/agents/avery');
  const list = page.getByRole('complementary', { name: 'Chats', exact: true });
  await list.click({ button: 'right', position: { x: 40, y: 500 } });
  await page.getByRole('menuitem', { name: 'Import agent…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import agent' });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'nova.swarm-agent',
    mimeType: 'application/gzip',
    buffer: Buffer.from('a fake agent file'),
  });
  await expect(dialog.getByText('nova.swarm-agent')).toBeVisible();
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  expect(uploaded).toBe('a fake agent file'.length);

  // Straight to its settings: paused, with what needs fixing in red.
  await expect(page).toHaveURL(/\/agents\/nova$/);
  const banner = page.getByRole('region', { name: 'Needs attention' });
  await expect(banner.getByRole('heading', { name: 'Nova is paused' })).toBeVisible();
  await expect(banner).toContainText('Model #1: This provider does not exist here');
  const resume = banner.getByRole('button', { name: 'Resume Nova' });
  await expect(resume).toBeDisabled();
  await banner.getByRole('button', { name: 'Remove' }).click();
  await expect(banner).not.toContainText('Old desk');
  // The model is fixed (as if saved): nothing left in red, so it can resume.
  review = { paused: true, problems: [] };
  await page.getByRole('button', { name: 'Close agent settings' }).click();
  // Meanwhile the chat says it is paused and offers no composer; its row is grayed.
  await expect(
    page.getByRole('status').filter({ hasText: 'Nova is paused until you review its settings' }),
  ).toBeVisible();
  await expect(page.getByRole('form', { name: 'Message composer' })).toHaveCount(0);
  await expect(page.locator('[data-chat-id="nova"]')).toHaveClass(/opacity-55/);
  await expect(page.locator('[data-chat-id="nova"]')).toContainText('Paused · review its settings');
  await page.getByRole('button', { name: 'Review settings' }).click();
  await banner.getByRole('button', { name: 'Resume Nova' }).click();
  await expect(banner).toHaveCount(0);
  await page.getByRole('button', { name: 'Close agent settings' }).click();
  await expect(page.getByRole('form', { name: 'Message composer' })).toBeVisible();
  await expect(page.locator('[data-chat-id="nova"]')).not.toHaveClass(/opacity-55/);
});
