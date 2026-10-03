import { test, expect, type Page } from './fixtures';
import { sampleAgents } from './sample-agents';

const desk = {
  id: 'c20ed85c-52d4-4f92-a8bb-e2bbb7975470',
  name: 'Shared desktop',
  state: 'running',
  createdAt: 0,
  cpuPercent: 0,
  memoryBytes: 0,
  memoryLimitBytes: 4294967296,
  cpuCount: 4,
  cpuCores: 4,
  memoryGiB: 4,
  timezone: 'UTC',
};
const session = {
  id: '12345678-1234-1234-1234-123456789abc',
  name: 'build-web',
  alive: true,
  exitCode: null,
  createdAt: 1,
  columns: 100,
  rows: 30,
};
async function mocks(page: Page) {
  await page.route(/\/api\/computers(?:\?.*)?$/, route =>
    route.fulfill({ json: { computers: [{ ...desk, portalFree: true }], controllerConnected: true } }),
  );
  await page.route('**/api/computers/control', route => route.fulfill({ json: { holders: [] } }));
  await page.route('**/api/computers/*/terminals', route =>
    route.fulfill({ json: { type: 'terminal', sessions: [session] } }),
  );
  await page.routeWebSocket('**/api/computers/*/terminals/*/stream', ws =>
    ws.send(JSON.stringify({ type: 'ready', columns: 100, rows: 30 })),
  );
  await page.route(`**/computers/${desk.id}/desktop/**`, route =>
    route.fulfill({ contentType: 'text/html', body: '<html><body style="background:#123">Desktop</body></html>' }),
  );
  await page.route('**/api/files/find**', route =>
    route.fulfill({
      json: { files: [{ id: 'f1', name: 'report.pdf', channelKey: 'chat:avery', kind: 'file', size: 3 }], scratch: [] },
    }),
  );
}

test('Ctrl+K opens Portal, prefixes narrow it, Enter floats and Shift+Enter goes to the page', async ({ page }) => {
  await mocks(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/agents/avery');
  // The app (and its shortcut) mounts once the sign-in check answers.
  await expect(page.getByRole('button', { name: 'Open Portal' })).toBeVisible();
  await page.keyboard.press('Control+k');
  const portal = page.getByRole('dialog', { name: 'Portal' });
  await expect(portal).toBeVisible();
  // The empty state teaches the prefixes as chips.
  const chips = portal.getByRole('button', { name: /^[@#:/>?]/ });
  await expect(chips).toHaveText(['@Agents', '#Chats', ':Computers', '/Pages', '>Commands', '?Knowledge']);
  // The best result is highlighted and the footer says what Enter does with it.
  await expect(portal.getByRole('option', { selected: true })).toContainText('Avery');
  await expect(portal.locator('footer')).toContainText('open');
  await page.screenshot({ path: '../.scratch/shots/portal-empty.png' });
  // A typed prefix becomes a chip; Backspace on an empty search removes it.
  const input = portal.getByRole('combobox');
  await input.fill('@');
  await expect(portal.getByRole('button', { name: 'Searching Agents; remove' })).toBeVisible();
  await expect(portal.getByRole('option')).toHaveCount(sampleAgents.length);
  await input.press('Backspace');
  await expect(portal.getByRole('button', { name: 'Searching Agents; remove' })).toHaveCount(0);
  // Searching everything: terminals, files, pages.
  await input.fill('build');
  await expect(portal.getByRole('option', { name: /build-web/ })).toBeVisible();
  await input.fill('report');
  await expect(portal.getByRole('option', { name: /report\.pdf/ })).toBeVisible();
  // Enter on an agent floats a chat with it, over the page; the window survives a page change.
  await input.fill('@morg');
  await page.screenshot({ path: '../.scratch/shots/portal-agents.png' });
  await input.press('Enter');
  await expect(portal).toBeHidden();
  const chat = page.getByRole('region', { name: 'Chat with Morgan' });
  await expect(chat).toBeVisible();
  // It opens below the top bar, and even dragged over it, its title bar stays on top and can be grabbed.
  const bar = chat.locator('header');
  expect((await bar.boundingBox())!.y).toBeGreaterThanOrEqual(56);
  const start = (await bar.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, 20, { steps: 5 });
  await page.mouse.up();
  const moved = (await bar.boundingBox())!;
  expect(moved.y).toBeLessThan(40);
  const onTop = await page.evaluate(
    ([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('[aria-label="Chat with Morgan"]')),
    [moved.x + moved.width / 2, moved.y + moved.height / 2],
  );
  expect(onTop).toBe(true);
  // A terminal too.
  await page.keyboard.press('Control+k');
  await portal.getByRole('combobox').fill(':build');
  await portal.getByRole('combobox').press('Enter');
  const terminal = page.getByRole('region', { name: 'Floating terminal build-web' });
  await expect(terminal).toBeVisible();
  // Minimize puts it in the dock; its dock button brings it back.
  await terminal.getByRole('button', { name: 'Minimize build-web' }).click();
  await expect(terminal).toBeHidden();
  const dock = page.getByRole('navigation', { name: 'Minimized windows' });
  await dock.getByRole('button', { name: 'build-web' }).click();
  await expect(terminal).toBeVisible();
  // Windows stay open across pages.
  await page.getByRole('tab', { name: 'Chat' }).click();
  await expect(page).toHaveURL(/\/chat/);
  await expect(terminal).toBeVisible();
  await expect(chat).toBeVisible();
  await page.keyboard.press('Control+k');
  await portal.getByRole('combobox').fill(':shared');
  await portal.getByRole('combobox').press('Enter');
  const desktop = page.getByRole('region', { name: 'Floating desktop Shared desktop' });
  await expect(desktop).toBeVisible();
  await expect(desktop.getByRole('button', { name: /Input locked/ })).toBeVisible();
  await page.screenshot({ path: '../.scratch/shots/portal-windows.png' });
  await desktop.getByRole('button', { name: 'Close Shared desktop' }).click();
  await expect(desktop).toBeHidden();
  // Shift+Enter goes to the page instead.
  await page.keyboard.press('Control+k');
  await portal.getByRole('combobox').fill('/knowledge');
  await portal.getByRole('combobox').press('Shift+Enter');
  await expect(page).toHaveURL(/\/settings\/knowledge$/);
});

test('keys inside a focused terminal stay with the computer', async ({ page }) => {
  await mocks(page);
  await page.goto('/agents/avery');
  // The app (and its shortcut) mounts once the sign-in check answers.
  await expect(page.getByRole('button', { name: 'Open Portal' })).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog', { name: 'Portal' }).getByRole('combobox').fill(':build');
  await expect(page.getByRole('option', { name: /build-web/, selected: true })).toBeVisible();
  await page.keyboard.press('Enter');
  const terminal = page.getByRole('region', { name: 'Floating terminal build-web' });
  await terminal.locator('.xterm-helper-textarea').focus();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Portal' })).toBeHidden();
  // The header button always opens it.
  await page.getByRole('button', { name: 'Open Portal' }).click();
  await expect(page.getByRole('dialog', { name: 'Portal' })).toBeVisible();
});

test('reduced transparency keeps Portal solid, and phones open pages instead of windows', async ({ page }) => {
  await mocks(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/chat');
  await page.getByRole('button', { name: 'Open Portal' }).click();
  const portal = page.getByRole('dialog', { name: 'Portal' });
  await portal.getByRole('combobox').fill('@morg');
  await page.screenshot({ path: '../.scratch/shots/portal-phone.png' });
  await portal.getByRole('combobox').press('Enter');
  await expect(page).toHaveURL(/\/chat\/agents\/morgan$/);
  await expect(page.getByRole('region', { name: 'Chat with Morgan' })).toHaveCount(0);
});
