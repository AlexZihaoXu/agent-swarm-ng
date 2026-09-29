import { test, expect, type Page } from './fixtures';
import type { WebSocketRoute } from '@playwright/test';
const id = 'c4a5f16d-0042-4b70-a232-dd65591a2c4c',
  sid = '12345678-1234-1234-1234-123456789abc';
async function setup(page: Page, state = 'running') {
  const requests: any[] = [],
    input: string[] = [],
    sockets: WebSocketRoute[] = [];
  let sessions = [
    {
      id: sid,
      name: 'build',
      alive: true,
      exitCode: null,
      createdAt: 1,
      columns: 120,
      rows: 36,
      cwd: '/workspace',
      currentCommand: 'bash',
    },
  ];
  await page.routeWebSocket('**/api/computers/*/terminals/*/stream', ws => {
    sockets.push(ws);
    ws.onMessage(message => {
      const frame = JSON.parse(String(message));
      if (frame.type === 'input') input.push(Buffer.from(frame.data, 'base64').toString());
      else expect(frame.type).toBe('ping');
    });
    ws.send(JSON.stringify({ type: 'ready', columns: 120, rows: 36 }));
    ws.send(
      JSON.stringify({
        type: 'output',
        data: Buffer.from(
          '\x1b[2J\x1b[H\x1b[31mREAL TERMINAL 世界\x1b[0m\r\n<script>not executable</script>\r\n$ ',
        ).toString('base64'),
      }),
    );
  });
  await page.route('**/api/computers', route =>
    route.fulfill({
      json: {
        controllerConnected: true,
        computers: [{ id, name: 'Terminal desk', state, createdAt: 0, cpuPercent: 0, memoryBytes: 0 }],
      },
    }),
  );
  await page.route('**/api/computers/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('settings-limits'))
      return route.fulfill({
        json: {
          cpuCores: { min: 1, max: 8, default: 4 },
          memoryGiB: { min: 1, max: 16, default: 4 },
          timezoneDefault: 'UTC',
        },
      });
    if (url.pathname.endsWith('terminals')) {
      const body = route.request().postDataJSON();
      requests.push(body);
      if (body.operation === 'list') return route.fulfill({ json: { type: 'terminal', sessions } });
      if (body.operation === 'create') {
        const session = { ...sessions[0], id: '98765432-1234-1234-1234-123456789abc', name: body.name };
        sessions.push(session);
        return route.fulfill({ json: { type: 'terminal', session } });
      }
      if (body.operation === 'delete') {
        sessions = sessions.filter(row => row.id !== body.session);
        return route.fulfill({ json: { type: 'terminal', deleted: true, sessionId: body.session } });
      }
      const session = sessions.find(row => row.id === body.session);
      if (!session) return route.fulfill({ status: 400, json: { message: 'Terminal not found.' } });
      return route.fulfill({ json: { type: 'terminal', session, accepted: true } });
    }
    return route.fulfill({ status: 503, json: { message: 'Unavailable' } });
  });
  await page.goto('/computers');
  await page.getByRole('button', { name: 'Actions for Terminal desk' }).click();
  return { requests, input, sockets };
}
async function open(page: Page) {
  const state = await setup(page);
  await page.getByRole('menuitem', { name: 'Terminals', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Terminals · Terminal desk' });
  await expect(panel.locator('.xterm-rows')).toContainText('REAL TERMINAL');
  await expect(panel).toContainText('Keyboard only');
  return { panel, ...state };
}
test('real ANSI renderer forwards focused keyboard including Escape/Tab/control without closing the modal', async ({
  page,
}) => {
  const { panel, input } = await open(page);
  await expect(panel.getByLabel('Terminal text')).toHaveCount(0);
  await expect(panel.locator('script')).toHaveCount(0);
  const red = panel.locator('.xterm-rows span').filter({ hasText: 'REAL TERMINAL' }).first();
  await expect(red).toHaveCSS('color', 'rgb(204, 0, 0)');
  await panel.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('hello');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Escape');
  await expect.poll(() => input.join('')).toContain('hello\r\t\x1b[A\x03\x02\x1b');
  await expect(panel).toBeVisible();
});
test('mouse/focus reports and guest clipboard escapes never become input or browser clipboard writes', async ({
  page,
}) => {
  const { panel, input, sockets } = await open(page);
  await page.evaluate(() => {
    (window as any).__clipboardWrites = 0;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => {
          (window as any).__clipboardWrites++;
          return Promise.resolve();
        },
      },
    });
  });
  sockets.at(-1)!.send(
    JSON.stringify({
      type: 'output',
      data: Buffer.from('\x1b[?1003h\x1b[?1006h\x1b[?1004h\x1b]52;c;dW50cnVzdGVk\x07').toString('base64'),
    }),
  );
  await panel.getByTestId('terminal-viewport').click({ position: { x: 20, y: 20 } });
  const box = await panel.getByTestId('terminal-viewport').boundingBox();
  await page.mouse.move(box!.x + 50, box!.y + 50);
  await page.mouse.down();
  await page.mouse.move(box!.x + 90, box!.y + 65);
  await page.mouse.up();
  await page.mouse.wheel(0, 50);
  await panel.getByRole('button', { name: 'New terminal', exact: true }).click();
  expect(input).toEqual([]);
  expect(await page.evaluate(() => (window as any).__clipboardWrites)).toBe(0);
});
test('fixed120x36 terminal does not resize on a phone or resize request; reconnect does not replay keys', async ({
  page,
}) => {
  const { panel, input, sockets } = await open(page);
  const width = await panel.locator('.xterm-screen').evaluate(node => (node as HTMLElement).clientWidth);
  await expect(panel.locator('.xterm-rows > div')).toHaveCount(36);
  await page.setViewportSize({ width: 320, height: 760 });
  expect(await panel.locator('.xterm-screen').evaluate(node => (node as HTMLElement).clientWidth)).toBe(width);
  expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  sockets.at(-1)!.send(
    JSON.stringify({
      type: 'output',
      data: Buffer.from('\x1b[8;24;80t\x1b[?3h\x1b[10;1HSIZE_LOCK_PROBE').toString('base64'),
    }),
  );
  await expect(panel.locator('.xterm-rows')).toContainText('SIZE_LOCK_PROBE');
  await expect(panel.locator('.xterm-rows > div')).toHaveCount(36);
  expect(await panel.locator('.xterm-screen').evaluate(node => (node as HTMLElement).clientWidth)).toBe(width);
  await panel.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('once');
  await expect.poll(() => input.join('')).toBe('once');
  await sockets.at(-1)!.close({ code: 1000 });
  await expect(panel).toContainText('Disconnected');
  await panel.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(panel).toContainText('Keyboard only');
  expect(input.join('')).toBe('once');
  await page.screenshot({ path: '../.scratch/terminal-emulator-320.png', animations: 'disabled' });
});
test('create, reserved-key controls and deliberate deletion remain available', async ({ page }) => {
  const { panel, requests } = await open(page);
  await panel.getByRole('button', { name: 'New terminal', exact: true }).click();
  await panel.getByLabel('Terminal name', { exact: true }).fill('server');
  await panel.getByLabel('Initial command').fill('npm run dev');
  await panel.getByLabel('Working directory').fill('~/project');
  await panel.getByRole('button', { name: 'Create terminal', exact: true }).click();
  await expect(panel.getByLabel('Select terminal')).toHaveValue('98765432-1234-1234-1234-123456789abc');
  expect(requests.find(r => r.operation === 'create')).toEqual({
    operation: 'create',
    name: 'server',
    command: 'npm run dev',
    cwd: '~/project',
  });
  await panel.getByLabel('Terminal key').selectOption('C-w');
  await panel.getByRole('button', { name: 'Send key', exact: true }).click();
  await expect.poll(() => requests.filter(r => r.operation === 'press').length).toBe(1);
  await panel.getByRole('button', { name: 'Delete terminal', exact: true }).click();
  expect(requests.some(r => r.operation === 'delete')).toBe(false);
  await panel.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => requests.filter(r => r.operation === 'delete').length).toBe(1);
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Actions for Terminal desk' })).toBeFocused();
  expect(requests.filter(r => r.operation === 'delete')).toHaveLength(1);
});
test('stopped computers do not offer terminal execution', async ({ page }) => {
  await setup(page, 'exited');
  await expect(page.getByRole('menuitem', { name: 'Terminals', exact: true })).toHaveAttribute('data-disabled', '');
});
test('controls stay usable while the session list refreshes in the background', async ({ page }) => {
  const { panel, requests } = await open(page);
  await page.route('**/api/computers/*/terminals', async route => {
    if (route.request().postDataJSON()?.operation === 'list') await new Promise(resolve => setTimeout(resolve, 700));
    return route.fallback();
  });
  const interrupt = panel.getByRole('button', { name: 'Interrupt', exact: true });
  await expect(interrupt).toBeEnabled();
  // Polls run every 2 s and now take 700 ms: sample across several cycles. The button must never be disabled by a refresh.
  let disabled = 0;
  for (let i = 0; i < 40; i++) {
    if (await interrupt.isDisabled()) disabled++;
    await page.waitForTimeout(100);
  }
  expect(disabled).toBe(0);
  await interrupt.click();
  await expect.poll(() => requests.filter(r => r.operation === 'interrupt').length).toBe(1);
  // Choosing another terminal keeps the panel populated instead of blanking to "Loading terminals…".
  await expect(panel.getByText('Loading terminals…')).toHaveCount(0);
});
