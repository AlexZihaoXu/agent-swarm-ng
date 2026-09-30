import { test, expect } from './fixtures';
import { sampleAgents } from './sample-agents';

test('per-agent instructions: a rich editor saved as Markdown, after a plain-words warning about the cache', async ({
  page,
}) => {
  const saves: unknown[] = [];
  await page.route('**/api/agents/avery', route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const body = route.request().postDataJSON();
    saves.push(body);
    return route.fulfill({ json: { ...sampleAgents[0], instructions: body.instructions } });
  });
  await page.goto('/agents/avery');
  const settings = page.getByRole('region', { name: 'Settings for Avery' });
  const section = settings.getByRole('region', { name: 'Instructions' });
  const editor = section.getByRole('textbox', { name: 'Instructions for Avery' });
  await editor.click();
  await page.keyboard.type('Keep replies short.');
  // Formatting from the bubble menu on a selection.
  await page.keyboard.press('Shift+Home');
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(section.getByText('Words: 3')).toBeVisible();
  const save = settings.getByRole('button', { name: 'Save changes' });
  await save.click();
  const dialog = page.getByRole('dialog', { name: 'Save new instructions?' });
  await expect(dialog).toContainText('a ready-made copy of that beginning (a cache)');
  await expect(dialog).toContainText('That one reply is slower and uses more of your plan or budget');
  // Cancelling keeps the change unsaved.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(saves).toHaveLength(0);
  await expect(save).toBeVisible();
  await save.click();
  await page
    .getByRole('dialog', { name: 'Save new instructions?' })
    .getByRole('button', { name: 'Save instructions' })
    .click();
  await expect.poll(() => saves).toEqual([{ instructions: '**Keep replies short.**' }]);
  await expect(section.getByRole('status')).toContainText('The agent follows them from its next turn');
});
