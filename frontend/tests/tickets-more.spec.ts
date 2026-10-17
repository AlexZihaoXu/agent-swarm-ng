import { test, expect, type Page } from './fixtures';
import { sampleHistory } from './sample-agents';
import { mockTickets, ticketOf } from './ticket-mocks';

/** Sub-issues, relations, due dates, search and filters, keys, chips and tickets from messages (docs/tickets.md). */
async function board(page: Page, tickets: Record<string, unknown>[]) {
  const state = await mockTickets(page);
  state.enabled = true;
  state.tickets = tickets;
  for (const ticket of tickets) state.events.set(ticket.number as number, []);
  return state;
}
const card = (page: Page, number: number) => page.getByRole('button', { name: new RegExp(`^HOME-${number}\\b`) });

test('tickets: a sub-issue added from the detail, its progress on the parent and a breadcrumb back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const state = await board(page, [ticketOf(1, { title: 'Release 2.0' })]);
  await page.goto('/tickets/HOME-1');
  const ticket = page.getByRole('region', { name: 'Ticket HOME-1' });
  await expect(ticket.getByText('No sub-issues.')).toBeVisible();
  await ticket.getByRole('button', { name: 'Add sub-issue' }).click();
  const dialog = page.getByRole('dialog', { name: 'New sub-issue' });
  await expect(dialog).toContainText('A sub-issue of HOME-1 “Release 2.0”.');
  await dialog.getByLabel('Title').fill('Write the release notes');
  await dialog.getByRole('button', { name: 'Create ticket' }).click();
  expect(state.bodies.at(-1)).toMatchObject({ title: 'Write the release notes', parent: 1 });
  // The sub-issue opens, with its parent as a breadcrumb.
  const child = page.getByRole('region', { name: 'Ticket HOME-2' });
  await child
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('button', { name: /HOME-1/ })
    .click();
  await expect(ticket.getByRole('button', { name: /HOME-2.*Write the release notes/ })).toBeVisible();
  await expect(ticket.getByText('0/1 done')).toBeVisible();
  // Done: the parent's card on the board shows 1/1.
  state.tickets.find(item => item.number === 2)!.status = 'done';
  await page.goto('/tickets');
  await expect(card(page, 1)).toContainText('1/1');
});

test('tickets: a blocked mark and due dates on cards, relations and the overdue state in the detail', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const state = await board(page, [
    ticketOf(3, { title: 'Ship it', due: '2020-03-01' }),
    ticketOf(2, { title: 'Back up first', due: '2099-06-01' }),
    ticketOf(1, { title: 'Migrate' }),
  ]);
  state.relations.push([2, 'blocks', 3]);
  await page.goto('/tickets');
  await expect(card(page, 3)).toContainText('Blocked');
  await expect(card(page, 2)).not.toContainText('Blocked');
  // Overdue in red; a far date plain, with its year.
  await expect(card(page, 3).getByText('Mar 1, 2020')).toHaveClass(/text-red-300/);
  await expect(card(page, 2).getByText('Jun 1, 2099')).not.toHaveClass(/text-red-300/);
  await card(page, 3).click();
  const ticket = page.getByRole('region', { name: 'Ticket HOME-3' });
  await expect(ticket.getByText('Overdue', { exact: true })).toBeVisible();
  await expect(ticket.getByRole('button', { name: /HOME-2.*Back up first/ })).toBeVisible();
  // Removing the relation saves it and the mark goes.
  await ticket.getByRole('button', { name: 'Remove blocked by HOME-2' }).click();
  expect(state.bodies.at(-1)).toEqual({ removeRelations: [{ kind: 'blocked_by', number: 2 }] });
  await expect(ticket.getByRole('button', { name: /HOME-2.*Back up first/ })).toHaveCount(0);
  // A new due date saves at once.
  await ticket.getByLabel(/Due date/).fill('2099-01-02');
  await expect.poll(() => state.bodies.at(-1)).toEqual({ due: '2099-01-02' });
});

test('tickets: search and filters live in the address, survive a reload and narrow the board', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const state = await board(page, [
    ticketOf(3, { title: 'Rotate the logs', priority: 'high', labels: ['ops'] }),
    ticketOf(2, { title: 'Back up Keep', description: 'nightly rsync', priority: 'low' }),
    ticketOf(1, { title: 'Update the image', priority: 'high' }),
  ]);
  await page.goto('/tickets');
  await page.getByLabel('Search tickets').fill('rsync');
  await expect(page).toHaveURL(/[?&]q=rsync/);
  await expect(card(page, 2)).toBeVisible();
  await expect(card(page, 3)).toHaveCount(0);
  expect(state.queries).toContain('rsync');
  await page.getByLabel('Search tickets').fill('');
  await expect(page).not.toHaveURL(/q=/);
  await page.getByRole('button', { name: 'Filter' }).click();
  const filters = page.getByRole('dialog', { name: 'Filter tickets' });
  await filters.getByRole('group', { name: 'Priority' }).getByRole('button', { name: 'High' }).click();
  await filters.getByRole('group', { name: 'Label' }).getByRole('button', { name: 'ops' }).click();
  await filters.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/priority=high/);
  await expect(page).toHaveURL(/label=ops/);
  await expect(card(page, 3)).toBeVisible();
  await expect(card(page, 1)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Filter 2/ })).toBeVisible();
  // Reloaded (or shared), the address keeps them; the list sorts too.
  await page.reload();
  await expect(card(page, 3)).toBeVisible();
  await expect(card(page, 1)).toHaveCount(0);
  await page.getByRole('radio', { name: 'List' }).click();
  await expect(page).toHaveURL(/\/tickets\/list\?.*priority=high/);
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page).not.toHaveURL(/priority=/);
  await expect(page.getByRole('button', { name: /^HOME-1\b/ })).toBeVisible();
});

test('tickets: C opens a new ticket, / searches, ? lists the keys, never while typing', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await board(page, [ticketOf(1, { title: 'Update the image' })]);
  await page.goto('/tickets');
  await expect(card(page, 1)).toBeVisible();
  await page.keyboard.press('c');
  const dialog = page.getByRole('dialog', { name: 'New ticket' });
  await expect(dialog).toBeVisible();
  // Typing a C in the dialog's field is just a letter.
  await dialog.getByLabel('Title').type('Check');
  await expect(dialog.getByLabel('Title')).toHaveValue('Check');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.keyboard.press('/');
  await expect(page.getByLabel('Search tickets')).toBeFocused();
  await page.keyboard.type('c/');
  await expect(page.getByLabel('Search tickets')).toHaveValue('c/');
  await expect(dialog).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Search tickets')).toHaveValue('');
  await page.keyboard.press('Shift+?');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help).toContainText('New ticket');
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  // In a ticket, Escape goes back to the board.
  await card(page, 1).click();
  await expect(page).toHaveURL(/\/tickets\/HOME-1/);
  await expect(page.getByRole('heading', { name: 'Update the image' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/tickets(\?.*)?$/);
});

test('tickets: an id in a chat shows as a live chip, and a message becomes a ticket from its menu', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const state = await board(page, [ticketOf(1, { title: 'Update the image', status: 'progress' })]);
  const messages = [
    ...sampleHistory.avery,
    {
      ...sampleHistory.avery[0]!,
      id: 'avery-9',
      sequence: 9,
      text: 'HOME-1 is on its way; HOME-77 does not exist.',
    },
  ];
  await page.route('**/api/channels/avery/messages*', route => route.fulfill({ json: { messages, nextCursor: null } }));
  await page.goto('/chat/agents/avery');
  const message = page.locator('[data-message-id="avery-9"]');
  const chip = message.getByRole('button', { name: /HOME-1 Update the image/ });
  await expect(chip).toBeVisible();
  await expect(message).toContainText('HOME-77 does not exist');
  await expect(message.getByRole('button', { name: /HOME-77/ })).toHaveCount(0);
  await chip.click();
  await expect(page).toHaveURL(/\/tickets\/HOME-1\?org=personal/);
  await expect(page.getByRole('region', { name: 'Ticket HOME-1' }).first()).toBeVisible();

  await page.goto('/chat/agents/avery');
  await page.locator('[data-message-id="avery-1"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Create ticket from message…' }).click();
  await expect(page).toHaveURL(/\/tickets\?org=personal/);
  const dialog = page.getByRole('dialog', { name: 'New ticket' });
  await expect(dialog.getByLabel('Title')).toHaveValue('Let’s start with a simple place to talk.');
  await expect(dialog).toContainText('the message is linked');
  await dialog.getByRole('button', { name: 'Create ticket' }).click();
  expect(state.bodies.at(-1)).toMatchObject({
    title: 'Let’s start with a simple place to talk.',
    linkMessage: 'avery-1',
  });
  const ticket = page.getByRole('region', { name: 'Ticket HOME-2' });
  // The link goes back to the conversation, at that message.
  await ticket.getByRole('button', { name: /Message · Avery/ }).click();
  await expect(page).toHaveURL(/\/chat\/agents\/avery/);
});
