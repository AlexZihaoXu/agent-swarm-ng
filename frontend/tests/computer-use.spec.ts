import { test, expect } from './fixtures';
import { sampleAgents } from './sample-agents';
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
  await expect(assignment.getByRole('button', { name: /Save computer/ })).toHaveCount(0); // one Save for the whole page
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(assignment.getByRole('status')).toContainText('saved');
  await page.reload();
  await expect(page.getByRole('checkbox', { name: desk.name })).toBeChecked();
  await page.setViewportSize({ width: 320, height: 720 });
  await page.getByRole('checkbox', { name: desk.name }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
for (const rosterLoaded of [true, false]) test(`viewer shows controlling avatar and live state; release stays independent (roster loaded: ${rosterLoaded})`, async ({ page }) => {
  let held = true;
  const holder = { ...sampleAgents[0], id: 'holder-agent', channelId: 'holder-channel', name: rosterLoaded ? 'Worker A' : 'Controlling agent with a particularly long display name for narrow screens', avatar: { shape: 'bean' as const, color: '#7c3aed', seed: 42, eyeStyle: 'round' as const } };
  const run = { runId: 'control-run', agentId: holder.id, channelId: holder.channelId, clientMessageId: 'initiator' };
  await page.addInitScript(({ id, run }) => { localStorage.setItem(`computer-consent:${id}`, 'yes'); (window as unknown as { agentRunSnapshot: object[] }).agentRunSnapshot = [run]; }, { id: desk.id, run });
  await page.route(/\/api\/agents(?:\?.*)?$/, route => route.fulfill({ json: { agents: rosterLoaded || new URL(route.request().url()).searchParams.has('search') ? [holder] : [], nextCursor: null } }));

  await page.route(/\/api\/computers(?:\?.*)?$/, route => route.fulfill({ json: { computers: [desk], controllerConnected: true } }));
  await page.route('**/api/computers/control', route => route.fulfill({ json: { holders: held ? [{ computerId: desk.id, agent: { id: holder.id, name: holder.name } }] : [] } }));
  await page.route(`**/api/computers/${desk.id}/release`, route => { held = false; return route.fulfill({ json: { released: true } }); });
  await page.route(`**/computers/${desk.id}/desktop/**`, route => route.request().url().endsWith('/api/health') ? route.fulfill({ json: { status: 'ok' } }) : route.fulfill({ contentType: 'text/html', body: '<html><body>Desktop fixture</body></html>' }));
  await page.goto(`/computers/${desk.id}`);
  const presence = page.getByTestId('computer-agent-presence');
  await expect(presence).toHaveAttribute('aria-label', `${holder.name} is on this computer. Working.`);
  const art = presence.locator('[data-avatar="current"] svg[data-avatar-shape]');
  await expect(art).toHaveAttribute('data-avatar-shape', 'bean'); await expect(art).toHaveAttribute('data-avatar-seed', '42');
  await expect(art).toHaveAttribute('data-avatar-state', 'working');
  await page.evaluate(event => (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent(event), { ...run, eventId: 'control-typing', type: 'typing', active: true, targets: ['another-conversation'] });
  await expect(presence.locator('[data-slot="typing-badge"]')).toBeVisible(); await expect(presence).toContainText('Typing');
  await page.evaluate(event => (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent(event), { ...run, eventId: 'control-done', type: 'done' });
  await expect(presence).toContainText('Ready'); await expect(art).toHaveAttribute('data-avatar-state', 'idle');
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const input = page.getByRole('button', { name: /human desktop input/ });
  await expect(input).toHaveText('Input locked');
  await expect(page.getByRole('button', { name: 'Remote shortcuts' })).toBeDisabled();
  await expect(page.locator('iframe')).toHaveAttribute('inert', '');
  await input.click(); await expect(input).toHaveText('Input live');
  await expect(page.getByRole('button', { name: 'Remote shortcuts' })).toBeEnabled();
  if (!rosterLoaded) await page.getByTestId('computer-viewer').screenshot({ path: '../.scratch/controller-avatar-320.png' });
  await page.getByRole('button', { name: 'Force release', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Force release computer' });
  await expect(confirm).toContainText('takes control from them now');
  await confirm.getByRole('button', { name: 'Force release', exact: true }).click();
  await expect(page.getByText('No agent holds control')).toBeVisible();
  await expect(input).toHaveText('Input live');
  await page.reload(); await expect(input).toHaveText('Input locked');
  await page.setViewportSize({ width: 320, height: 720 });
  await expect(input).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
