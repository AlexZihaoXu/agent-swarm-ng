import { test, expect } from './fixtures';
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
test('computer assignments save separately and restore after refresh', async ({ page }) => {
  let ids: string[] = [];
  await page.route(/\/api\/computers(?:\?.*)?$/, route =>
    route.fulfill({ json: { computers: [desk], controllerConnected: true } }),
  );
  await page.route('**/api/agents/*/computers', route => {
    if (route.request().method() === 'PUT') {
      ids = route.request().postDataJSON().computerIds;
      return route.fulfill({ json: { saved: true } });
    }
    return route.fulfill({ json: { computers: ids.map(() => ({ ...desk, holder: null, current: false })) } });
  });
  await page.goto('/agents');
  const assignment = page.getByRole('region', { name: 'Computers', exact: true });
  await expect(assignment.getByRole('checkbox', { name: desk.name })).toBeVisible();
  await assignment.getByRole('checkbox', { name: desk.name }).check();
  await expect(assignment.getByRole('button', { name: /Save computer/ })).toHaveCount(0); // one Save for the whole page
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(assignment.getByRole('status')).toContainText('saved');
  await page.reload();
  await expect(page.getByRole('checkbox', { name: desk.name })).toBeChecked();
  await page.setViewportSize({ width: 320, height: 720 });
  await page.getByRole('checkbox', { name: desk.name }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
for (const rosterLoaded of [true, false])
  test(`viewer shows controlling avatar and live state; release stays independent (roster loaded: ${rosterLoaded})`, async ({
    page,
  }) => {
    let held = true;
    const holder = {
      ...sampleAgents[0],
      id: 'holder-agent',
      channelId: 'holder-channel',
      name: rosterLoaded ? 'Worker A' : 'Controlling agent with a particularly long display name for narrow screens',
      avatar: { shape: 'bean' as const, color: '#7c3aed', seed: 42, eyeStyle: 'round' as const },
    };
    const run = { runId: 'control-run', agentId: holder.id, channelId: holder.channelId, clientMessageId: 'initiator' };
    await page.addInitScript(
      ({ id, run }) => {
        localStorage.setItem(`computer-consent:${id}`, 'yes');
        (window as unknown as { agentRunSnapshot: object[] }).agentRunSnapshot = [run];
      },
      { id: desk.id, run },
    );
    await page.route(/\/api\/agents(?:\?.*)?$/, route =>
      route.fulfill({
        json: {
          agents: rosterLoaded || new URL(route.request().url()).searchParams.has('search') ? [holder] : [],
          nextCursor: null,
        },
      }),
    );

    await page.route(/\/api\/computers(?:\?.*)?$/, route =>
      route.fulfill({ json: { computers: [desk], controllerConnected: true } }),
    );
    await page.route('**/api/computers/control', route =>
      route.fulfill({
        json: { holders: held ? [{ computerId: desk.id, agent: { id: holder.id, name: holder.name } }] : [] },
      }),
    );
    await page.route(`**/api/computers/${desk.id}/release`, route => {
      held = false;
      return route.fulfill({ json: { released: true } });
    });
    await page.route(`**/computers/${desk.id}/desktop/**`, route =>
      route.request().url().endsWith('/api/health')
        ? route.fulfill({ json: { status: 'ok' } })
        : route.fulfill({ contentType: 'text/html', body: '<html><body>Desktop fixture</body></html>' }),
    );
    await page.goto(`/computers/${desk.id}`);
    const presence = page.getByTestId('computer-agent-presence');
    await expect(presence).toHaveAttribute('aria-label', `${holder.name} is on this computer. Working.`);
    const art = presence.locator('[data-avatar="current"] svg[data-avatar-shape]');
    await expect(art).toHaveAttribute('data-avatar-shape', 'bean');
    await expect(art).toHaveAttribute('data-avatar-seed', '42');
    await expect(art).toHaveAttribute('data-avatar-state', 'working');
    await page.evaluate(
      event => (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent(event),
      { ...run, eventId: 'control-typing', type: 'typing', active: true, targets: ['another-conversation'] },
    );
    await expect(presence.locator('[data-slot="typing-badge"]')).toBeVisible();
    await expect(presence).toContainText('Typing');
    await page.evaluate(
      event => (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent(event),
      { ...run, eventId: 'control-done', type: 'done' },
    );
    await expect(presence).toContainText('Ready');
    await expect(art).toHaveAttribute('data-avatar-state', 'idle');
    // Sideways: an upright phone shows the desktop turned and view-only.
    await page.setViewportSize({ width: 720, height: 320 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const input = page.getByRole('button', { name: /human desktop input/ });
    await expect(input).toHaveAccessibleName(/^Input locked/);
    await expect(page.getByRole('button', { name: 'Remote shortcuts' })).toBeDisabled();
    await expect(page.locator('iframe')).toHaveAttribute('inert', '');
    await input.click();
    await expect(input).toHaveAccessibleName(/^Input live/);
    await expect(page.getByRole('button', { name: 'Remote shortcuts' })).toBeEnabled();
    if (!rosterLoaded)
      await page.getByTestId('computer-viewer').screenshot({ path: '../.scratch/controller-avatar-320.png' });
    await page.getByRole('button', { name: 'Force release', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Force release computer' });
    await expect(confirm).toContainText('takes control from them now');
    await confirm.getByRole('button', { name: 'Force release', exact: true }).click();
    await expect(page.getByText('No agent holds control')).toBeVisible();
    await expect(input).toHaveAccessibleName(/^Input live/);
    await page.reload();
    await expect(input).toHaveAccessibleName(/^Input locked/);
    await page.setViewportSize({ width: 320, height: 720 });
    await expect(input).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

test('the agent on a computer opens a floating chat over the desktop that sends to its conversation', async ({
  page,
}) => {
  const agent = sampleAgents[0];
  await page.addInitScript(id => localStorage.setItem(`computer-consent:${id}`, 'yes'), desk.id);
  await page.route(/\/api\/computers(?:\?.*)?$/, route =>
    route.fulfill({ json: { computers: [{ ...desk, portalFree: true }], controllerConnected: true } }),
  );
  await page.route('**/api/computers/control', route =>
    route.fulfill({ json: { holders: [{ computerId: desk.id, agent: { id: agent.id, name: agent.name } }] } }),
  );
  await page.route(`**/computers/${desk.id}/desktop/**`, route =>
    route.request().url().endsWith('/api/health')
      ? route.fulfill({ json: { status: 'ok' } })
      : route.fulfill({ contentType: 'text/html', body: '<html><body>Desktop fixture</body></html>' }),
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/computers/${desk.id}`);
  await page.getByRole('button', { name: `Chat with ${agent.name}` }).click();
  const window = page.getByRole('region', { name: `Chat with ${agent.name}` });
  await expect(window.getByRole('list', { name: 'Messages' })).toBeVisible();
  // It grows out of the agent in the header (above the window), and its red close light always shows its "×".
  const origin = await window.evaluate(element => getComputedStyle(element).transformOrigin.split(' ').map(parseFloat));
  expect(origin[1]).toBeLessThan(0);
  await expect(window.getByRole('button', { name: `Close chat with ${agent.name}` }).locator('svg')).toBeVisible();
  // Measure once it has finished growing.
  await expect.poll(() => window.evaluate(element => getComputedStyle(element).transform)).toBe('none');
  const box = (await window.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(1280);
  const sent = page.waitForRequest(request => request.url().endsWith('/api/chat'));
  await window.getByRole('textbox', { name: `Message ${agent.name}` }).fill('How is it going?');
  await window.getByRole('button', { name: 'Send message' }).click();
  expect((await sent).postDataJSON()).toMatchObject({ agentId: agent.id, message: 'How is it going?' });
  await expect(window).toContainText('How is it going?');
  // Dragging by the title bar moves the window.
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 200, box.y + 112, { steps: 4 });
  await page.mouse.up();
  expect((await window.boundingBox())!.x).toBeLessThan(box.x - 150);
  // Any edge resizes, with the matching cursor: the left edge widens it while the right edge stays put.
  const before = (await window.boundingBox())!;
  const left = page.locator('[data-resize-edge="w"]');
  await expect(left).toHaveCSS('cursor', 'ew-resize');
  await expect(page.locator('[data-resize-edge="n"]')).toHaveCSS('cursor', 'ns-resize');
  await expect(page.locator('[data-resize-edge="se"]')).toHaveCSS('cursor', 'nwse-resize');
  await page.mouse.move(before.x + 1, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x - 99, before.y + before.height / 2, { steps: 4 });
  await page.mouse.up();
  const wider = (await window.boundingBox())!;
  expect(wider.width).toBeGreaterThan(before.width + 90);
  expect(Math.abs(wider.x + wider.width - (before.x + before.width))).toBeLessThan(1);
  // It may leave the viewer (even the page edge) but 64px stay on screen to grab it again.
  const moved = (await window.boundingBox())!;
  await page.mouse.move(moved.x + moved.width / 2, moved.y + 12);
  await page.mouse.down();
  await page.mouse.move(1700, 900, { steps: 4 });
  await page.mouse.up();
  const parked = (await window.boundingBox())!;
  expect(parked.x).toBeLessThanOrEqual(1280 - 64 + 0.5);
  expect(parked.x).toBeGreaterThan(1100);
  expect(parked.y).toBeLessThanOrEqual(800 - 64 + 0.5);
  // The close light shrinks it back into the header; Open in Chat goes to the whole conversation.
  await window.getByRole('button', { name: `Close chat with ${agent.name}` }).click();
  // It shrinks back into the header before it goes.
  await expect.poll(() => window.evaluate(element => getComputedStyle(element).transform)).not.toBe('none');
  await expect(window).toHaveCount(0);
  await page.getByRole('button', { name: `Chat with ${agent.name}` }).click();
  await window.getByRole('button', { name: 'Open in Chat' }).click();
  await expect(page).toHaveURL(new RegExp(`/chat/agents/${agent.id}$`));
});

test('the chat and terminal windows show which one is focused, and the one touched last is on top', async ({
  page,
}) => {
  const agent = sampleAgents[0];
  const session = {
    id: '12345678-1234-1234-1234-123456789abc',
    name: 'build',
    alive: true,
    exitCode: null,
    createdAt: 1,
    columns: 120,
    rows: 36,
  };
  await page.addInitScript(id => localStorage.setItem(`computer-consent:${id}`, 'yes'), desk.id);
  await page.route(/\/api\/computers(?:\?.*)?$/, route =>
    route.fulfill({ json: { computers: [{ ...desk, portalFree: true }], controllerConnected: true } }),
  );
  await page.route('**/api/computers/control', route =>
    route.fulfill({ json: { holders: [{ computerId: desk.id, agent: { id: agent.id, name: agent.name } }] } }),
  );
  await page.route('**/api/computers/*/terminals', route =>
    route.fulfill({ json: { type: 'terminal', sessions: [session] } }),
  );
  await page.routeWebSocket('**/api/computers/*/terminals/*/stream', ws =>
    ws.send(JSON.stringify({ type: 'ready', columns: 120, rows: 36 })),
  );
  await page.route(`**/computers/${desk.id}/desktop/**`, route =>
    route.request().url().endsWith('/api/health')
      ? route.fulfill({ json: { status: 'ok' } })
      : route.fulfill({ contentType: 'text/html', body: '<html><body>Desktop fixture</body></html>' }),
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/computers/${desk.id}`);
  await page.getByRole('button', { name: 'Terminals', exact: true }).click();
  await page.getByRole('dialog', { name: 'Terminals' }).getByRole('button', { name: 'Float build' }).click();
  const terminal = page.getByRole('region', { name: 'Floating terminal' });
  await expect(terminal).toHaveAttribute('data-focused', '');
  await page.getByRole('button', { name: `Chat with ${agent.name}` }).click();
  const chat = page.getByRole('region', { name: `Chat with ${agent.name}` });
  await expect(chat).toHaveAttribute('data-focused', '');
  await expect(terminal).not.toHaveAttribute('data-focused');
  const z = async (locator: typeof chat) => Number(await locator.evaluate(element => getComputedStyle(element).zIndex));
  expect(await z(chat)).toBeGreaterThan(await z(terminal));
  // Touching the terminal focuses it and brings it to the front.
  await terminal.getByText('build').click();
  await expect(terminal).toHaveAttribute('data-focused', '');
  await expect(chat).not.toHaveAttribute('data-focused');
  expect(await z(terminal)).toBeGreaterThan(await z(chat));
  await expect(chat.getByRole('button', { name: /^Close chat/ })).not.toHaveCSS('background-color', 'rgb(255, 95, 87)');
  // Touching anything else leaves neither focused.
  await page.getByRole('navigation', { name: 'Computer location' }).click();
  await expect(terminal).not.toHaveAttribute('data-focused');
  await expect(chat).not.toHaveAttribute('data-focused');
});
