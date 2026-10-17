import { test, expect, type Page } from './fixtures';
import { seededBoard } from './ticket-mocks';

/** A mouse drag in small steps (dnd-kit starts after a few pixels of movement), until the card has settled. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 4 });
  await expect(page.locator('.ticket-lift')).toHaveCount(1);
  await page.mouse.move(to.x, to.y, { steps: 20 });
  await page.mouse.up();
  await expect(page.locator('.ticket-lift')).toHaveCount(0);
}
const center = async (locator: ReturnType<Page['locator']>) => {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, top: box.y };
};

test('tickets workflow: a state added in the organization becomes a board column a card drags into', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const { state, column, card } = await seededBoard(page);
  await page.goto('/organization');
  const workflow = page.getByRole('region', { name: 'Workflow' });
  await workflow.scrollIntoViewIfNeeded();
  const started = workflow.getByRole('group', { name: 'Started', exact: true });
  await expect(started.getByLabel('Name of In review')).toHaveValue('In review');
  // Add a started state.
  await workflow.getByRole('button', { name: 'Add a started state' }).click();
  await workflow.getByLabel('New started state').fill('QA');
  await workflow.getByRole('button', { name: 'Add state' }).click();
  await expect(started.getByLabel('Name of QA')).toBeVisible();
  expect(state.bodies.at(-1)).toEqual({ 'POST state': null, name: 'QA', category: 'started' });
  // ↑ on its grip moves it within its category; its notify switch and colour save at once.
  await started.getByRole('button', { name: 'Move QA (drag, or use the arrow keys)' }).press('ArrowUp');
  await expect.poll(() => state.bodies.at(-1)).toEqual({ 'PATCH state': 'state-7', position: 1 });
  await expect(started.getByRole('textbox')).toHaveCount(3);
  expect(
    await started.getByRole('textbox').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value)),
  ).toEqual(['In progress', 'QA', 'In review']);
  await started.getByRole('switch', { name: 'Notify me' }).nth(1).click();
  await expect.poll(() => state.bodies.at(-1)).toEqual({ 'PATCH state': 'state-7', notifyOnEnter: true });
  await started.getByRole('button', { name: /^Colour of QA/ }).click();
  await page.getByRole('radio', { name: 'Violet' }).click();
  await expect.poll(() => state.bodies.at(-1)).toEqual({ 'PATCH state': 'state-7', color: 'violet' });
  await page.keyboard.press('Escape');
  // The last unstarted state cannot be deleted.
  await expect(workflow.getByRole('button', { name: 'Delete Todo' })).toBeDisabled();
  await page.screenshot({ path: '../.scratch/tickets-workflow-editor.png' });

  // On the board it is a column, in its place, and a card drags into it.
  await page.getByRole('tablist', { name: 'Main navigation' }).getByRole('tab', { name: 'Tickets' }).click();
  await expect(column('QA')).toBeVisible();
  const names = await page.getByRole('region', { name: 'Tickets' }).locator('section h3').allTextContents();
  expect(names.map(name => name.replace(/\d+$/, ''))).toEqual([
    'Backlog',
    'Todo',
    'In progress',
    'QA',
    'In review',
    'Done',
  ]);
  const target = await center(column('QA'));
  await drag(page, await center(card(1)), { x: target.x, y: target.top + 80 });
  await expect(column('QA').getByRole('button', { name: /^HOME-1\b/ })).toBeVisible();
  expect(state.bodies.at(-1)).toEqual({ status: 'state-7', place: {} });
  expect(state.events.get(1)!.at(-1)).toMatchObject({ text: 'moved it Todo → QA' });

  // Deleting it asks where its tickets go.
  await page.goto('/organization');
  await workflow.getByRole('button', { name: 'Delete QA' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete QA?' });
  await expect(dialog.getByText('Move its tickets to')).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(dialog).toBeHidden();
  expect(state.bodies.at(-1)).toEqual({ 'DELETE state': 'state-7' });
  expect(state.tickets.find(ticket => ticket.number === 1)?.status).toBe('progress');
  await expect(workflow.getByLabel('Name of QA')).toHaveCount(0);
});

test('tickets: archive and restore in the detail, hidden from the board until Show archived', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const { state, card } = await seededBoard(page);
  await card(2).click();
  const ticket = page.getByRole('region', { name: 'Ticket HOME-2' });
  await ticket.getByRole('button', { name: 'Archive ticket' }).click();
  await expect(ticket.getByText('Archived', { exact: true })).toBeVisible();
  expect(state.bodies.at(-1)).toEqual({ archived: true });
  await expect(ticket.getByText('Admin archived it')).toBeVisible();
  // Back on the board it is gone, until Show archived (kept in the address).
  await ticket.getByRole('button', { name: 'Tickets' }).first().click();
  await expect(card(1)).toBeVisible();
  await expect(card(2)).toHaveCount(0);
  await page.getByRole('button', { name: 'Filter' }).click();
  await page.getByRole('dialog', { name: 'Filter tickets' }).getByRole('button', { name: 'Show archived' }).click();
  await expect(page).toHaveURL(/[?&]archived=1/);
  await page.keyboard.press('Escape');
  await expect(card(2)).toContainText('Archived');
  await page.reload();
  await expect(card(2)).toContainText('Archived');
  await card(2).click();
  await page
    .getByRole('region', { name: 'Ticket HOME-2' })
    .getByRole('button', { name: 'Restore from the archive' })
    .click();
  expect(state.bodies.at(-1)).toEqual({ archived: false });
  await expect(ticket.getByRole('button', { name: 'Archive ticket' })).toBeVisible();
});
