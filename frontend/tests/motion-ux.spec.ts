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
  await expect(nav.getByRole('link')).toHaveText([
    'Channels',
    'Model',
    'Instructions',
    'Heartbeat',
    'Time notes',
    'Computers',
    'Scratchpad',
    'Memory',
    'Avatar',
    'Organization',
    'Delete agent',
  ]);
  // On wide screens the links share the header row with the title (no separate strip or subtitle).
  const title = (await pane.getByRole('heading', { name: 'Agent settings' }).boundingBox())!;
  const links = (await nav.boundingBox())!;
  expect(Math.abs(title.y + title.height / 2 - (links.y + links.height / 2))).toBeLessThan(6);
  await expect(pane).not.toContainText('Name, model, channels');
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

test('edge handles stay hidden until the mouse nears, then show a glyph, a round button, and their label', async ({
  page,
}) => {
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
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/computers/desk');
  for (const name of ['All computers', 'Terminals']) {
    const handle = page.getByRole('button', { name, exact: true });
    await page.mouse.move(600, 300);
    await expect(handle).toHaveAttribute('data-near', 'far');
    await expect(handle).toHaveCSS('opacity', '0');
    const box = (await handle.boundingBox())!;
    // Collapsed, the button is a true circle.
    expect(Math.abs(box.width - box.height)).toBeLessThan(0.5);
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const away = name === 'Terminals' ? { x: -1, y: 0 } : { x: 0, y: -1 };
    await page.mouse.move(centre.x + away.x * 150, centre.y + away.y * 150);
    await expect(handle).toHaveAttribute('data-near', 'near');
    await expect(handle).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.mouse.move(centre.x + away.x * 60, centre.y + away.y * 60);
    await expect(handle).toHaveAttribute('data-near', 'close');
    await expect(handle).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await handle.hover();
    await expect(handle.getByText(name)).toHaveCSS('opacity', '1');
  }
});

test('the desktop handle opens a Terminals drawer, and a session floats out fitted to its shape', async ({ page }) => {
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
  const second = { ...session, id: '12345678-1234-1234-1234-123456789abd', name: 'deploy' };
  let screenReads = 0;
  await page.route('**/api/computers/*/terminals', route => {
    if (route.request().postDataJSON().operation !== 'screens')
      return route.fulfill({ json: { type: 'terminal', sessions: [session, second] } });
    screenReads++;
    return route.fulfill({
      json: {
        type: 'terminal',
        screens: [session, second].map(item => ({ id: item.id, ansi: `\x1b[32m${item.name}$\x1b[0m ls` })),
      },
    });
  });
  await page.routeWebSocket('**/api/computers/*/terminals/*/stream', ws =>
    ws.send(JSON.stringify({ type: 'ready', columns: 120, rows: 36 })),
  );
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/computers/desk');
  // The handle opens the Terminals drawer first; sessions are then brought up as floating windows. The drawer
  // stays open so several can come out, and a floated session's card leaves the list.
  await page.getByRole('button', { name: 'Terminals', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Terminals' });
  // Cards are live previews: the screen with its colours, refreshed about twice a second.
  const preview = drawer.getByRole('button', { name: 'Float build' }).getByTestId('terminal-preview');
  await expect(preview).toContainText('build$ ls');
  await expect(preview.locator('span', { hasText: 'build$' })).toHaveCSS('color', 'rgb(13, 188, 121)');
  const reads = screenReads;
  await expect.poll(() => screenReads).toBeGreaterThan(reads + 1);
  await drawer.getByRole('button', { name: 'Float build' }).click();
  await expect(drawer.getByRole('button', { name: 'Float build' })).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Float deploy' }).click();
  await expect(drawer).toContainText('Every terminal is out on the desktop.');
  await expect(page.getByRole('region', { name: /^Floating terminal/ })).toHaveCount(2);
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  const floating = page.getByRole('region', { name: 'Floating terminal build' });
  await page
    .getByRole('region', { name: 'Floating terminal deploy' })
    .getByRole('button', { name: 'Close deploy' })
    .click();
  await expect(page.getByRole('region', { name: 'Floating terminal deploy' })).toHaveCount(0);
  // Closing a window opens the drawer, where its card comes back.
  await expect(drawer.getByRole('button', { name: 'Float deploy' })).toBeVisible();
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(floating).toContainText('Connected');
  // The window wraps the terminal: widths change, the shape follows.
  const before = (await floating.boundingBox())!;
  await page.mouse.move(before.x + before.width - 2, before.y + before.height - 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width - 200, before.y + before.height, { steps: 5 });
  await page.mouse.up();
  const after = (await floating.boundingBox())!;
  expect(after.width).toBeLessThan(before.width);
  expect(after.height).toBeLessThan(before.height);
  // The bottom edge sets the height; the width follows the terminal's shape.
  await page.mouse.move(after.x + after.width / 2, after.y + after.height - 1);
  await page.mouse.down();
  await page.mouse.move(after.x + after.width / 2, after.y + after.height + 80, { steps: 5 });
  await page.mouse.up();
  const taller = (await floating.boundingBox())!;
  expect(taller.height).toBeGreaterThan(after.height + 60);
  expect(taller.width).toBeGreaterThan(after.width);
  // The window keeps its shadow: nothing inside the window clips it.
  const frame = floating.locator('[data-terminal-emulator]');
  await expect(frame).not.toHaveCSS('overflow', 'hidden');
  // The red close light puts it back into the drawer.
  await floating.getByRole('button', { name: 'Close build' }).click();
  await expect(floating).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: 'Float build' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Float deploy' })).toBeVisible();
});

test('a session resized elsewhere reshapes its floating window without a reload', async ({ page }) => {
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
  let size = { columns: 120, rows: 36 };
  const session = () => ({
    id: '12345678-1234-1234-1234-123456789abc',
    name: 'build',
    alive: true,
    exitCode: null,
    createdAt: 1,
    ...size,
  });
  await page.route('**/api/computers/*/terminals', route =>
    route.fulfill({ json: { type: 'terminal', sessions: [session()] } }),
  );
  const sockets: { close: () => void }[] = [];
  await page.routeWebSocket('**/api/computers/*/terminals/*/stream', ws => {
    sockets.push(ws);
    ws.send(JSON.stringify({ type: 'ready', ...size }));
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/computers/desk');
  await page.getByRole('button', { name: 'Terminals', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Terminals' });
  await drawer.getByRole('button', { name: 'Float build' }).click();
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  const floating = page.getByRole('region', { name: 'Floating terminal build' });
  await expect(floating).toContainText('120 × 36');
  const wide = (await floating.boundingBox())!;
  // Another client (or an agent) resizes the session; its viewer stream restarts at the new size.
  size = { columns: 80, rows: 24 };
  for (const socket of sockets.splice(0)) socket.close();
  await expect(floating).toContainText('80 × 24');
  await expect(floating).toHaveCSS('transition-property', /width/);
  await expect
    .poll(async () => {
      const box = (await floating.boundingBox())!;
      return Math.round((box.width / box.height) * 10) / 10;
    })
    .not.toBe(Math.round((wide.width / wide.height) * 10) / 10);
});

test('the Terminals drawer creates a terminal and floats it straight up', async ({ page }) => {
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
  const made = {
    id: '12345678-1234-1234-1234-123456789abd',
    name: 'notes',
    alive: true,
    exitCode: null,
    createdAt: 1,
    columns: 120,
    rows: 36,
  };
  let sessions: (typeof made)[] = [];
  const bodies: { operation: string }[] = [];
  await page.route('**/api/computers/*/terminals', route => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    if (body.operation === 'create') {
      sessions = [made];
      return route.fulfill({ json: { type: 'terminal', session: made } });
    }
    return route.fulfill({ json: { type: 'terminal', sessions } });
  });
  await page.routeWebSocket('**/api/computers/*/terminals/*/stream', ws =>
    ws.send(JSON.stringify({ type: 'ready', columns: 120, rows: 36 })),
  );
  await page.goto('/computers/desk');
  await page.getByRole('button', { name: 'Terminals', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Terminals' });
  await expect(drawer).toContainText('No terminals on this computer yet.');
  await expect(drawer.getByRole('button', { name: 'New terminal' })).toHaveCount(2); // header + and the empty state
  await drawer.getByRole('button', { name: 'New terminal' }).last().click();
  const form = page.getByRole('dialog', { name: 'New terminal' });
  await expect(form.getByLabel('Working directory')).toHaveValue('~/Desktop');
  await form.getByLabel('Terminal name', { exact: true }).fill('notes');
  await form.getByRole('button', { name: 'Create terminal', exact: true }).click();
  await expect(form).toHaveCount(0);
  // The drawer stays open; the new terminal is out on the desktop, not in its list.
  await expect(drawer).toContainText('Every terminal is out on the desktop.');
  expect(bodies.find(body => body.operation === 'create')).toEqual({
    operation: 'create',
    name: 'notes',
    cwd: '~/Desktop',
  });
  await expect(page.getByRole('region', { name: 'Floating terminal notes' })).toContainText('notes');
});

test('computer previews keep fetching fresh frames after leaving the grid and coming back', async ({ page }) => {
  // A tiny valid JPEG.
  const jpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  );
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
  const urls: string[] = [];
  await page.route('**/api/computers/desk/preview*', route => {
    urls.push(route.request().url());
    return route.fulfill({ body: jpeg, contentType: 'image/jpeg', headers: { 'Cache-Control': 'no-store' } });
  });
  await page.goto('/computers');
  await expect.poll(() => urls.length).toBeGreaterThan(3);
  const shown = () =>
    page
      .locator('[data-testid="computer-preview-layer"]')
      .evaluateAll(images => images.map(i => i.getAttribute('src')));
  const seen = new Set(await shown());
  await page.waitForTimeout(1200);
  for (const src of await shown()) seen.add(src);
  await page.getByRole('button', { name: 'Open Desk desktop' }).click();
  await page.getByRole('button', { name: 'Back to computers' }).click();
  await page.waitForTimeout(1500);
  // Frame URLs never repeat, so coming back cannot replay frames from the first visit out of the image cache.
  const again = await shown();
  expect(again.length).toBeGreaterThan(0);
  for (const src of again) expect(seen.has(src)).toBe(false);
});

test('long histories keep a bounded window: older pages load near the top and the newest are offloaded', async ({
  page,
}) => {
  const total = Array.from({ length: 400 }, (_, i) => ({
    id: `w-${i + 1}`,
    sequence: i + 1,
    channelId: agent.channelId,
    role: i % 2 ? 'assistant' : 'user',
    text: `Window message ${i + 1}`,
    timestamp: 1000 + i,
  }));
  await page.route('**/api/channels/long-channel/messages*', route => {
    const before = Number(new URL(route.request().url()).searchParams.get('before') || 401);
    const rows = total.filter(row => row.sequence < before).slice(-50);
    return route.fulfill({ json: { messages: rows, nextCursor: rows[0].sequence > 1 ? rows[0].sequence : null } });
  });
  await page.goto('/chat/agents/long-agent');
  const list = page.getByRole('list', { name: 'Messages' });
  const viewport = page.getByRole('region', { name: 'Chat history', exact: true });
  await expect(list.locator('[data-message-id="w-400"]')).toBeVisible();
  for (let i = 0; i < 8; i++) {
    await viewport.evaluate(element => {
      element.scrollTop = 0;
    });
    await page.waitForTimeout(250);
  }
  await expect(list.locator('[data-message-id="w-150"]')).toHaveCount(1);
  // At most one window of messages is on the page, and the newest were dropped while reading older ones.
  expect(await list.locator(':scope > li').count()).toBeLessThanOrEqual(150);
  await expect(list.locator('[data-message-id="w-400"]')).toHaveCount(0);
  // Older history loading in is not news: the pill only offers the way back.
  await expect(page.getByRole('button', { name: 'Jump to latest' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New messages' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Jump to latest' }).click();
  await expect(list.locator('[data-message-id="w-400"]')).toBeVisible();
});
