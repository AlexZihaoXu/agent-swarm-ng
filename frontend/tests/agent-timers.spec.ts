import { test, expect } from './fixtures';

test('shows the agent’s timers and saves the owner’s changes after saying the agent will be told', async ({ page }) => {
  const now = Date.now();
  let timers: Record<string, unknown>[] = [
    {
      id: 't1',
      kind: 'timer',
      note: 'check the build',
      nextAt: new Date(now + 3_600_000).toISOString(),
      createdAt: new Date(now).toISOString(),
    },
    {
      id: 'r1',
      kind: 'reminder',
      note: 'stretch',
      nextAt: new Date(now + 1_800_000).toISOString(),
      everySeconds: 3600,
      fired: 2,
      total: 'unlimited',
      createdAt: new Date(now).toISOString(),
    },
  ];
  const puts: unknown[] = [];
  await page.route('**/api/agents/avery/timers', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { timers } });
    const body = route.request().postDataJSON();
    puts.push(body);
    timers = timers.filter(timer => timer.id !== 't1').map(timer => ({ ...timer, note: 'stand up', total: 5 }));
    return route.fulfill({ json: { timers } });
  });
  await page.goto('/agents/avery');
  const settings = page.getByRole('region', { name: 'Settings for Avery' });
  const section = settings.getByRole('region', { name: 'Timers' });
  const list = section.getByRole('list', { name: "Avery's timers" });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByRole('listitem').nth(1)).toContainText('fired 2');
  await section.getByRole('button', { name: 'Cancel check the build' }).click();
  await expect(section.getByText('Cancelled when you save.')).toBeVisible();
  const reminder = list.getByRole('listitem', { name: 'Reminder: stretch' });
  await reminder.getByLabel('Note').fill('stand up');
  await reminder.getByLabel('Times in all').fill('5');
  await settings.getByRole('button', { name: 'Save changes', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save timer changes?' });
  await expect(dialog).toContainText('Avery will be told what you changed (2 timers)');
  // Cancelling keeps the changes unsaved.
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(puts).toHaveLength(0);
  await settings.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Save timer changes?' })
    .getByRole('button', { name: 'Save and tell it' })
    .click();
  await expect
    .poll(() => puts)
    .toEqual([
      {
        changes: [
          { id: 't1', cancel: true },
          { id: 'r1', note: 'stand up', total: 5 },
        ],
      },
    ]);
  await expect(section.getByRole('status')).toContainText('Avery has been told what changed');
  await expect(list.getByRole('listitem')).toHaveCount(1);
});
