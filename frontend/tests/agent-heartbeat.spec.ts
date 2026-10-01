import { test, expect } from './fixtures';
import { sampleAgents } from './sample-agents';

test('an agent’s heartbeat settings save with the page and refuse half-set hours', async ({ page }) => {
  let body: unknown;
  await page.route('**/api/agents/avery', route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    body = route.request().postDataJSON();
    return route.fulfill({
      json: {
        ...sampleAgents[0],
        heartbeat: {
          enabled: true,
          minutes: 45,
          from: '09:00',
          to: '18:00',
          checklist: 'Check the nightly build.',
          timeZone: 'UTC',
        },
      },
    });
  });
  await page.goto('/agents/avery');
  const settings = page.getByRole('region', { name: 'Settings for Avery' });
  const section = settings.getByRole('region', { name: 'Heartbeat' });
  await section.scrollIntoViewIfNeeded();
  const every = section.getByLabel('Every (minutes)', { exact: true });
  await expect(every).toBeDisabled();
  await section.getByRole('switch', { name: 'Wake up periodically' }).click();
  await expect(every).toBeEnabled();
  await every.fill('45');
  await section.getByLabel('Active from').fill('09:00');
  await expect(section.getByRole('alert')).toContainText('Set both active hours');
  await section.getByLabel('Until').fill('18:00');
  await expect(section.getByRole('alert')).toHaveCount(0);
  await section.getByLabel('What to check').fill('  Check the nightly build.  ');
  await page.screenshot({ path: '../.scratch/shots/heartbeat-settings.png' });
  await settings.getByRole('button', { name: 'Save changes' }).click();
  await expect(section.getByRole('status')).toContainText('The first heartbeat comes one interval from now');
  expect(body).toEqual({
    heartbeat: { enabled: true, minutes: 45, from: '09:00', to: '18:00', checklist: 'Check the nightly build.' },
  });
});
