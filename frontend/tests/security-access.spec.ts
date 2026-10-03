import { test, expect } from './fixtures';

test('critical events show as banners that link to their logs and can be dismissed', async ({ page }) => {
  let alerts = [
    {
      id: 'lockdown',
      kind: 'lockdown',
      title: 'Sign-in is locked down',
      detail: 'Only trusted addresses can sign in.',
      startedAt: '2026-10-03T10:00:00.000Z',
      endedAt: null,
      dismissable: false,
      logs: 'signin',
    },
    {
      id: 'a1',
      kind: 'outage',
      title: 'Possible power outage',
      detail: 'The host restarted and the platform had not shut down cleanly.',
      startedAt: '2026-10-03T08:00:00.000Z',
      endedAt: '2026-10-03T09:30:00.000Z',
      dismissable: true,
      logs: 'system',
    },
  ];
  await page.route('**/api/alerts', route => route.fulfill({ json: { alerts } }));
  await page.route('**/api/alerts/a1/dismiss', route => {
    alerts = alerts.filter(alert => alert.id !== 'a1');
    return route.fulfill({ json: { ok: true } });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/agents');
  const banners = page.getByRole('region', { name: 'Critical events' });
  await expect(banners.getByRole('alert')).toHaveCount(2);
  const outage = banners.getByRole('alert').filter({ hasText: 'Possible power outage' });
  await expect(outage).toContainText(/from .* to /);
  // The lockdown lasts until it is lifted: no Dismiss.
  await expect(
    banners.getByRole('alert').filter({ hasText: 'locked down' }).getByRole('button', { name: 'Dismiss' }),
  ).toHaveCount(0);
  await page.screenshot({ path: '../.scratch/shots/banners.png' });
  await outage.getByRole('button', { name: 'View logs' }).click();
  await expect(page).toHaveURL(/\/settings\/audit\?category=system$/);
  await expect(page.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
  await outage.getByRole('button', { name: 'Dismiss' }).click();
  await expect(banners.getByRole('alert')).toHaveCount(1);
});

test('banners beyond three are one click away, even when the first three cannot be dismissed', async ({ page }) => {
  const alerts = ['lockdown', 'disk-full-1', 'disk-full-2', 'outage'].map((id, index) => ({
    id,
    kind: id.replace(/-\d$/, ''),
    title: `Event ${index + 1}`,
    detail: 'Detail.',
    startedAt: '2026-10-03T10:00:00.000Z',
    endedAt: null,
    dismissable: id === 'outage',
    logs: 'system',
  }));
  await page.route('**/api/alerts', route => route.fulfill({ json: { alerts } }));
  await page.goto('/agents');
  const banners = page.getByRole('region', { name: 'Critical events' });
  await expect(banners.getByRole('alert')).toHaveCount(3);
  await banners.getByRole('button', { name: 'Show 1 more' }).click();
  await expect(banners.getByRole('alert')).toHaveCount(4);
  await expect(
    banners.getByRole('alert').filter({ hasText: 'Event 4' }).getByRole('button', { name: 'Dismiss' }),
  ).toBeVisible();
});

test('known addresses are labelled, trusted and removed in Settings → Security', async ({ page }) => {
  await page.goto('/settings');
  const security = page.getByRole('region', { name: 'Security' });
  await expect(security).toContainText('You are at');
  await security.getByLabel('Address or range').fill('100.64.0.0/10');
  await security.getByLabel('Label', { exact: true }).fill('Tailnet');
  await security.getByRole('switch', { name: 'Trusted' }).click();
  await security.getByRole('button', { name: 'Add', exact: true }).click();
  const row = security.getByRole('row').filter({ hasText: '100.64.0.0/10' });
  await expect(row).toBeVisible();
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await row.getByRole('switch').click();
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  // A cleared label is not saved: the field shows the saved one again.
  const label = row.getByLabel('Label of 100.64.0.0/10');
  await label.fill('');
  await label.blur();
  await expect(label).toHaveValue('Tailnet');
  await row.getByRole('button', { name: 'Remove' }).click();
  await expect(security.getByRole('row').filter({ hasText: '100.64.0.0/10' })).toHaveCount(0);
});

test('the access log summarizes requests by address, country, route and status', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Open the access log' }).click();
  await expect(page).toHaveURL(/\/settings\/access$/);
  const log = page.getByRole('region', { name: 'Access log' });
  await expect(log.getByRole('heading', { name: 'Requests over time' })).toBeVisible();
  // This browser's own requests are there, as the signed-in Admin.
  const addresses = log.getByRole('region', { name: 'Addresses' });
  await expect(addresses.getByRole('row').filter({ hasText: 'Admin' }).first()).toBeVisible();
  await expect(log.getByRole('region', { name: 'Routes' })).toContainText('GET /api/');
  await page.setViewportSize({ width: 360, height: 740 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: '../.scratch/shots/access-phone.png' });
});
