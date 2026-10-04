import { test, expect } from './fixtures';
import { sampleAgents } from './sample-agents';

test('an agent’s time notes default to every 15 minutes and save with the page', async ({ page }) => {
  let body: unknown;
  await page.route('**/api/agents/avery', route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    body = route.request().postDataJSON();
    return route.fulfill({ json: { ...sampleAgents[0], timeNoteMinutes: 5 } });
  });
  await page.goto('/agents/avery');
  const settings = page.getByRole('region', { name: 'Settings for Avery' });
  const section = settings.getByRole('region', { name: 'Time notes' });
  await section.scrollIntoViewIfNeeded();
  const choice = section.getByRole('combobox', { name: 'Tell the time' });
  await expect(choice).toHaveText(/Every 15 minutes/);
  await choice.click();
  await page.getByRole('option', { name: 'Every 5 minutes', exact: true }).click();
  await settings.getByRole('button', { name: 'Save changes' }).click();
  await expect(section.getByRole('status')).toContainText('next step');
  expect(body).toEqual({ timeNoteMinutes: 5 });
  // Listed among the sections to jump to (wide screens: in the Agents panel).
  await expect(
    page.getByRole('navigation', { name: 'Jump to section' }).getByRole('link', { name: 'Time notes' }),
  ).toBeVisible();
});
