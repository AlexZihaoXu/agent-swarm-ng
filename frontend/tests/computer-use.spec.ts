import { test, expect } from './fixtures';
const desk = { id: 'c20ed85c-52d4-4f92-a8bb-e2bbb7975470', name: 'Shared desktop', state: 'running', createdAt: 0, cpuPercent: 0, memoryBytes: 0, memoryLimitBytes: 4294967296, cpuCount: 4, cpuCores: 4, memoryGiB: 4, timezone: 'UTC' };
test('computer assignments save separately and restore after refresh', async ({ page }) => {
  let ids: string[] = [];
  await page.route(/\/api\/computers(?:\?.*)?$/, route => route.fulfill({ json: { computers: [desk], controllerConnected: true } }));
  await page.route('**/api/agents/*/computers', route => {
    if (route.request().method() === 'PUT') { ids = route.request().postDataJSON().computerIds; return route.fulfill({ json: { saved: true } }); }
    return route.fulfill({ json: { computers: ids.map(() => ({ ...desk, holder: null, current: false })) } });
  });
  await page.goto('/agents');
  const assignment = page.getByRole('region', { name: 'Computers', exact: true });
  await expect(assignment.getByRole('checkbox', { name: desk.name })).toBeVisible();
  await assignment.getByRole('checkbox', { name: desk.name }).check();
  await assignment.getByRole('button', { name: 'Save computer assignments' }).click();
  await expect(assignment.getByRole('status')).toContainText('saved');
  await page.reload();
  await expect(page.getByRole('checkbox', { name: desk.name })).toBeChecked();
  await page.setViewportSize({ width: 320, height: 720 });
  await page.getByRole('checkbox', { name: desk.name }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('viewer starts locked, explicit input toggle and human Force release are independent', async ({ page }) => {
  let held = true;
  await page.addInitScript(id => localStorage.setItem(`computer-consent:${id}`, 'yes'), desk.id);
  await page.route(/\/api\/computers(?:\?.*)?$/, route => route.fulfill({ json: { computers: [desk], controllerConnected: true } }));
  await page.route('**/api/computers/control', route => route.fulfill({ json: { holders: held ? [{ computerId: desk.id, agent: { id: 'agent-a', name: 'Worker A' } }] : [] } }));
  await page.route(`**/api/computers/${desk.id}/release`, route => { held = false; return route.fulfill({ json: { released: true } }); });
  await page.route(`**/computers/${desk.id}/desktop/**`, route => route.request().url().endsWith('/api/health') ? route.fulfill({ json: { status: 'ok' } }) : route.fulfill({ contentType: 'text/html', body: '<html><body>Desktop fixture</body></html>' }));
  await page.goto(`/computers/${desk.id}`);
  const input = page.getByRole('button', { name: 'Enable human desktop input' });
  await expect(input).toHaveText('Input locked');
  await expect(page.getByRole('button', { name: 'Remote shortcuts' })).toBeDisabled();
  await expect(page.locator('iframe')).toHaveAttribute('inert', '');
  await input.click(); await expect(input).toHaveText('Input live');
  await expect(page.getByRole('button', { name: 'Remote shortcuts' })).toBeEnabled();
  await page.getByRole('button', { name: 'Force release', exact: true }).click();
  await expect(page.getByText('No agent holds control')).toBeVisible();
  await expect(input).toHaveText('Input live');
  await page.reload(); await expect(input).toHaveText('Input locked');
  await page.setViewportSize({ width: 320, height: 720 });
  await expect(input).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
