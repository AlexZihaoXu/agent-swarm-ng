import { expect, test } from './fixtures';
import { sampleAgents } from './sample-agents';

const agent = {
  id: 'long-agent',
  channelId: 'long-channel',
  name: 'Long agent',
  endpointId: 'endpoint',
  model: 'test-model',
  thinkingLevel: 'off',
  createdAt: 1000,
};
const messages = Array.from({ length: 40 }, (_, i) => ({
  id: `long-${i + 1}`,
  sequence: i + 1,
  channelId: agent.channelId,
  role: i % 2 ? 'assistant' : 'user',
  text: `Long message ${i + 1}\nWith a second line so the history scrolls.`,
  timestamp: 1000 + i,
}));

test.beforeEach(async ({ page }) => {
  await page.route(/\/api\/agents(?:\?.*)?$/, route =>
    route.fulfill({
      json: { agents: [...sampleAgents, { ...agent, lastMessage: messages.at(-1) }], nextCursor: null },
    }),
  );
});

test('a conversation is fetched before it is opened, and shows a placeholder only while it is on its way', async ({
  page,
}) => {
  let release: () => void = () => {};
  const held = new Promise<void>(resolve => (release = resolve));
  let requested = false;
  await page.route('**/api/channels/long-channel/messages*', async route => {
    requested = true;
    await held;
    await route.fulfill({ json: { messages, nextCursor: null } });
  });
  await page.goto('/chat/agents/avery');
  // Idle warm-up or hovering the row starts the request before any click.
  await page.getByRole('button', { name: 'Open conversation with Long agent' }).hover();
  await expect.poll(() => requested).toBe(true);
  await page.getByRole('button', { name: 'Open conversation with Long agent' }).click();
  const placeholder = page.getByRole('status', { name: 'Loading messages…' });
  await expect(placeholder).toBeVisible();
  await expect(page.getByRole('button', { name: 'Loading messages…' })).toHaveCount(0);
  release();
  await expect(page.getByRole('list', { name: 'Messages' }).locator(':scope > li')).toHaveCount(40);
  await expect(placeholder).toHaveCount(0);
});

test('reading older messages offers a way back to the latest, which then disappears', async ({ page }) => {
  await page.route('**/api/channels/long-channel/messages*', route =>
    route.fulfill({ json: { messages, nextCursor: null } }),
  );
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto('/chat/agents/long-agent');
  await expect(page.getByRole('list', { name: 'Messages' }).locator(':scope > li')).toHaveCount(40);
  const jump = page.getByRole('button', { name: 'Jump to latest' });
  await expect(jump).toHaveCount(0);
  const viewport = page.getByRole('region', { name: 'Chat history', exact: true });
  await viewport.evaluate(element => element.scrollTo({ top: 0 }));
  await expect(jump).toBeVisible();
  await jump.click();
  await expect
    .poll(() => viewport.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight))
    .toBeLessThan(2);
  await expect(jump).toHaveCount(0);
});

test('the sidebar has one selection highlight, and it follows the selected conversation', async ({ page }) => {
  await page.route('**/api/channels/long-channel/messages*', route =>
    route.fulfill({ json: { messages, nextCursor: null } }),
  );
  await page.goto('/chat/agents/avery');
  const highlight = page.locator('[data-slot="row-selection"]');
  await expect(highlight).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Open conversation with Avery' }).locator('[data-slot="row-selection"]'),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Open conversation with Long agent' }).click();
  await expect(highlight).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Open conversation with Long agent' }).locator('[data-slot="row-selection"]'),
  ).toHaveCount(1);
});

test('buttons give press feedback, and dialogs open over the shared blurred backdrop', async ({ page }) => {
  await page.goto('/chat/agents/avery');
  const create = page.getByRole('button', { name: 'Create group chat' });
  await expect(create).toHaveCSS('transition-property', /transform/);
  await create.click();
  await expect(page.getByRole('dialog', { name: 'Create group chat' })).toBeVisible();
  await expect(page.locator('[data-state="open"].fixed.inset-0').first()).toHaveCSS('backdrop-filter', 'blur(2px)');
});

test('agent settings offer jump links that follow the reader and land each heading in view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto('/agents/avery');
  const pane = page.getByRole('region', { name: 'Settings for Avery' });
  const nav = pane.getByRole('navigation', { name: 'Jump to section' });
  await expect(nav.getByRole('link')).toHaveText(['Channels', 'Model', 'Computers', 'Avatar', 'Delete agent']);
  await expect(nav.locator('[aria-current="location"]')).toHaveText('Channels');
  await nav.getByRole('link', { name: 'Avatar' }).click();
  await expect(nav.locator('[aria-current="location"]')).toHaveText('Avatar');
  const heading = pane.getByRole('heading', { name: 'Avatar', exact: true });
  await expect.poll(async () => (await heading.boundingBox())!.y).toBeGreaterThan((await nav.boundingBox())!.y);
  const navBottom = (await nav.boundingBox())!.y + (await nav.boundingBox())!.height;
  // Near the end of the page the scroll bottoms out, so allow the heading anywhere in the upper half.
  await expect.poll(async () => (await heading.boundingBox())!.y - navBottom).toBeLessThan(700 / 2);
  expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(navBottom);
  await expect(pane.getByRole('region', { name: 'Avatar' })).toBeFocused();
  // Scrolling by hand moves the highlight back.
  await pane.getByRole('region', { name: 'Agent editor' }).evaluate(element => element.scrollTo({ top: 0 }));
  await expect(nav.locator('[aria-current="location"]')).toHaveText('Channels');
});

test('empty screens say what is missing and point to the next step', async ({ page }) => {
  await page.route(/\/api\/computers(?:\?.*)?$/, route =>
    route.fulfill({ json: { computers: [], controllerConnected: true } }),
  );
  await page.goto('/computers');
  await expect(page.getByRole('heading', { name: 'No computers yet' })).toBeVisible();
  // The main navigation keeps plain accessible names; its icons are decorative.
  await expect(page.getByRole('tab', { name: 'Computers', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Computers', exact: true }).locator('svg')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Create computer' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Create computer' }).click();
  await expect(page).toHaveURL(/\/computers\/new$/);
  await expect(page.getByRole('dialog', { name: 'Create computer' })).toBeVisible();
});

test('the browser page menu is suppressed on app surfaces but kept for fields and selected text', async ({ page }) => {
  await page.goto('/chat/agents/avery');
  const prevented = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate(element => {
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      });
  expect(await prevented('header')).toBe(true);
  expect(await prevented('textarea')).toBe(false);
  await page.getByRole('heading', { name: 'Avery', exact: true }).first().selectText();
  expect(await prevented('header')).toBe(false);
});

test('typing while focus rests elsewhere in a chat goes to the message box', async ({ page }) => {
  await page.goto('/chat/agents/avery');
  const composer = page.getByLabel('Message Avery');
  await page.getByRole('region', { name: 'Chat history', exact: true }).focus();
  await page.keyboard.type('hi there');
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue('hi there');
  // Shortcuts are left alone.
  await page.getByRole('region', { name: 'Chat history', exact: true }).focus();
  await page.keyboard.press('Control+a');
  await expect(composer).not.toBeFocused();
});

test('right-clicking empty space on Computers offers page actions, a card offers its own', async ({ page }) => {
  await page.route(/\/api\/computers(?:\?.*)?$/, route =>
    route.fulfill({
      json: {
        controllerConnected: true,
        computers: [{ id: 'desk', name: 'Desk', state: 'running', createdAt: 0, cpuPercent: 0, memoryBytes: 0 }],
      },
    }),
  );
  await page.goto('/computers');
  await page.getByRole('article', { name: 'Desk' }).waitFor();
  const box = (await page.getByRole('article', { name: 'Desk' }).boundingBox())!;
  await page.mouse.click(box.x + box.width + 200, box.y + box.height + 150, { button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'New computer' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Refresh' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Power off' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('article', { name: 'Desk' }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Power off' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'New computer' })).toHaveCount(0);
});

test('the desktop viewer switches to a terminal view and to other computers from its drawer', async ({ page }) => {
  const computers = [
    { id: 'desk', name: 'Desk', state: 'running', createdAt: 0, cpuPercent: 0, memoryBytes: 0 },
    { id: 'lab', name: 'Lab', state: 'running', createdAt: 0, cpuPercent: 0, memoryBytes: 0 },
  ];
  await page.route(/\/api\/computers(?:\?.*)?$/, route =>
    route.fulfill({ json: { controllerConnected: true, computers } }),
  );
  await page.route('**/api/computers/*/terminals', route =>
    route.fulfill({ json: { type: 'terminal', sessions: [] } }),
  );
  await page.goto('/computers/desk');
  const views = page.getByRole('tablist', { name: 'Computer view' });
  await expect(views.getByRole('tab', { name: 'Desktop' })).toHaveAttribute('aria-selected', 'true');
  await views.getByRole('tab', { name: 'Terminal' }).click();
  await expect(page.getByRole('tablist', { name: 'Terminal sessions' })).toBeVisible();
  // Desktop-only controls step aside in the terminal view.
  await expect(page.getByRole('button', { name: /human desktop input/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'All computers' }).click();
  const drawer = page.getByRole('dialog', { name: 'All computers' });
  await expect(drawer.getByRole('button', { name: /Desk/ })).toHaveAttribute('aria-current', 'page');
  await drawer.getByRole('button', { name: /Lab/ }).click();
  await expect(page).toHaveURL(/\/computers\/lab$/);
  await expect(drawer).toHaveCount(0);
});

test('the viewer mode and terminal session live in the address, so a refresh returns to them', async ({ page }) => {
  await page.route(/\/api\/computers(?:\?.*)?$/, route =>
    route.fulfill({
      json: {
        controllerConnected: true,
        computers: [{ id: 'desk', name: 'Desk', state: 'running', createdAt: 0, cpuPercent: 0, memoryBytes: 0 }],
      },
    }),
  );
  const session = {
    id: '12345678-1234-1234-1234-123456789abc',
    name: 'build',
    alive: true,
    exitCode: null,
    createdAt: 1,
    columns: 120,
    rows: 36,
  };
  await page.route('**/api/computers/*/terminals', route =>
    route.fulfill({ json: { type: 'terminal', sessions: [session] } }),
  );
  await page.goto('/computers/desk');
  await page.getByRole('tablist', { name: 'Computer view' }).getByRole('tab', { name: 'Terminal' }).click();
  await expect(page).toHaveURL(`/computers/desk/terminal/${session.id}`);
  await page.reload();
  await expect(
    page.getByRole('tablist', { name: 'Computer view' }).getByRole('tab', { name: 'Terminal' }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: /build/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tablist', { name: 'Computer view' }).getByRole('tab', { name: 'Desktop' }).click();
  await expect(page).toHaveURL('/computers/desk');
});

test('a handle on the desktop pulls out a floating terminal that can expand to the Terminal view', async ({ page }) => {
  await page.route(/\/api\/computers(?:\?.*)?$/, route =>
    route.fulfill({
      json: {
        controllerConnected: true,
        computers: [
          { id: 'desk', name: 'Desk', state: 'running', createdAt: 0, cpuPercent: 0, memoryBytes: 0, portalFree: true },
        ],
      },
    }),
  );
  const session = {
    id: '12345678-1234-1234-1234-123456789abc',
    name: 'build',
    alive: true,
    exitCode: null,
    createdAt: 1,
    columns: 120,
    rows: 36,
  };
  await page.route('**/api/computers/*/terminals', route =>
    route.fulfill({ json: { type: 'terminal', sessions: [session] } }),
  );
  await page.routeWebSocket('**/api/computers/*/terminals/*/stream', ws =>
    ws.send(JSON.stringify({ type: 'ready', columns: 120, rows: 36 })),
  );
  await page.goto('/computers/desk');
  await page.getByRole('button', { name: 'Floating terminal' }).click();
  const floating = page.getByRole('region', { name: 'Floating terminal' });
  await expect(floating).toBeVisible();
  await expect(floating.getByLabel('Terminal session')).toHaveValue(session.id);
  await expect(floating).toContainText('Connected');
  await floating.getByRole('button', { name: 'Close floating terminal' }).click();
  await expect(floating).toHaveCount(0);
  await page.getByRole('button', { name: 'Floating terminal' }).click();
  await page
    .getByRole('region', { name: 'Floating terminal' })
    .getByRole('button', { name: 'Open in Terminal view' })
    .click();
  await expect(page).toHaveURL(`/computers/desk/terminal/${session.id}`);
});
