import { test, expect, type Page } from './fixtures';
import { sampleAgents } from './sample-agents';

type Ticket = Record<string, any>;
const settings = (enabled: boolean) => ({
  enabled,
  prefix: 'HOME',
  wakeOnAssign: true,
  agentsCreate: true,
  agentsPickUp: false,
  pushOnReview: true,
});

const LABEL: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  progress: 'In progress',
  review: 'In review',
  done: 'Done',
};

/** A stateful stand-in for the organization and ticket routes (docs/tickets.md). */
async function mockTickets(page: Page) {
  const state = {
    enabled: false,
    tickets: [] as Ticket[],
    events: new Map<number, Ticket[]>(),
    bodies: [] as unknown[],
    failNext: false,
  };
  const organization = () => ({
    id: 'personal',
    name: 'Home lab',
    ownerId: 'admin',
    ownerName: 'Admin',
    createdAt: '2030-01-01T00:00:00.000Z',
    agents: 4,
    computers: 0,
    groups: 0,
    tickets: settings(state.enabled),
  });
  await page.route(/\/api\/organizations$/, route => route.fulfill({ json: { organizations: [organization()] } }));
  await page.route(/\/api\/organizations\/personal$/, route => {
    const body = route.request().postDataJSON();
    if (body.tickets?.enabled !== undefined) state.enabled = body.tickets.enabled;
    return route.fulfill({ json: { organizations: [organization()] } });
  });
  const event = (kind: string, text: string, author = { kind: 'person', id: 'admin', name: 'Admin' }) => ({
    sequence: Math.round(Math.random() * 1e6),
    id: crypto.randomUUID(),
    kind,
    author,
    text,
    trusted: author.kind === 'person',
    createdAt: '2030-01-01T10:00:00.000Z',
  });
  const detail = (ticket: Ticket) => ({ ticket, events: state.events.get(ticket.number) ?? [], olderEvents: false });
  await page.route(/\/api\/organizations\/personal\/tickets(\/\d+)?$/, route => {
    const request = route.request();
    const number = Number(new URL(request.url()).pathname.split('/')[5] ?? 0);
    if (request.method() === 'GET' && !number)
      return route.fulfill({ json: { settings: settings(state.enabled), tickets: state.tickets, truncated: false } });
    const ticket = state.tickets.find(item => item.number === number);
    if (request.method() === 'GET')
      return ticket
        ? route.fulfill({ json: detail(ticket) })
        : route.fulfill({ status: 404, json: { message: 'No.' } });
    const body = request.postDataJSON();
    state.bodies.push(body);
    if (request.method() === 'POST') {
      const agent = sampleAgents.find(item => item.id === body.assignee?.agentId);
      const made: Ticket = {
        id: crypto.randomUUID(),
        number: state.tickets.length + 1,
        key: `HOME-${state.tickets.length + 1}`,
        title: body.title,
        description: body.description ?? '',
        status: 'todo',
        priority: body.priority ?? 'none',
        labels: [],
        links: [],
        assignee: agent ? { kind: 'agent', id: agent.id, name: agent.name } : null,
        writer: { kind: 'person', id: 'admin', name: 'Admin', trusted: true },
        createdBy: 'Admin',
        createdAt: '2030-01-01T10:00:00.000Z',
        updatedAt: new Date().toISOString(),
      };
      state.tickets.unshift(made);
      state.events.set(made.number, [
        event('created', 'created this'),
        ...(agent
          ? [
              event('assignee', `assigned ${agent.name}`),
              event('woken', 'was woken by the assignment', { kind: 'agent', id: agent.id, name: agent.name }),
            ]
          : []),
      ]);
      return route.fulfill({ json: detail(made) });
    }
    if (!ticket) return route.fulfill({ status: 404, json: { message: 'No.' } });
    if (state.failNext) {
      state.failNext = false;
      return route.fulfill({ status: 409, json: { message: 'Tickets are off for this organization.' } });
    }
    if (body.status && body.status !== ticket.status) {
      state.events.get(number)!.push(event('status', `moved it ${LABEL[ticket.status]} → ${LABEL[body.status]}`));
      ticket.status = body.status;
    }
    // Board order: a place puts it beside its neighbour, a new status alone on top of its column.
    if (body.place || body.status) {
      const rest = state.tickets.filter(item => item !== ticket);
      const at = (target?: number) => (target ? rest.findIndex(item => item.number === target) : -1);
      const [after, before] = [at(body.place?.after), at(body.place?.before)];
      const top = rest.findIndex(item => item.status === ticket.status);
      const index = after >= 0 ? after + 1 : before >= 0 ? before : top >= 0 ? top : rest.length;
      state.tickets = [...rest.slice(0, index), ticket, ...rest.slice(index)];
    }
    return route.fulfill({ json: detail(ticket) });
  });
  return state;
}

/** Tickets on, with Todo holding HOME-3, HOME-2, HOME-1 (newest on top). */
async function seededBoard(page: Page) {
  const state = await mockTickets(page);
  state.enabled = true;
  state.tickets = [3, 2, 1].map(number => ({
    id: `ticket-${number}`,
    number,
    key: `HOME-${number}`,
    title: ['Back up Keep', 'Rotate the logs', 'Update the image'][number - 1],
    description: '',
    status: 'todo',
    priority: 'none',
    labels: [],
    links: [],
    assignee: null,
    writer: { kind: 'person', id: 'admin', name: 'Admin', trusted: true },
    createdBy: 'Admin',
    createdAt: '2030-01-01T10:00:00.000Z',
    updatedAt: '2030-01-01T10:00:00.000Z',
  }));
  for (const number of [1, 2, 3]) state.events.set(number, []);
  await page.goto('/tickets');
  const column = (name: string) => page.getByRole('region', { name, exact: true });
  const card = (number: number) => page.getByRole('button', { name: new RegExp(`^HOME-${number}\\b`) });
  const keys = async (name: string) =>
    (
      await column(name)
        .getByRole('button', { name: /^HOME-\d+/ })
        .allTextContents()
    ).map(text => text.slice(0, 6));
  await expect(card(1)).toBeVisible();
  return { state, column, card, keys };
}

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
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, top: box.y, bottom: box.y + box.height };
};

test('tickets board: drag a card to another column and within one, saved like a status change', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const { state, column, card, keys } = await seededBoard(page);
  expect(await keys('Todo')).toEqual(['HOME-3', 'HOME-2', 'HOME-1']);

  // To In progress: the empty column takes it, saved as the detail's status change with a place.
  const target = await center(column('In progress'));
  await drag(page, await center(card(1)), { x: target.x, y: target.top + 80 });
  await expect(column('In progress').getByRole('button', { name: /^HOME-1\b/ })).toBeVisible();
  expect(state.bodies.at(-1)).toEqual({ status: 'progress', place: {} });
  expect(state.events.get(1)!.at(-1)).toMatchObject({ text: 'moved it Todo → In progress' });
  // Within Todo: HOME-2 above HOME-3.
  const top = await center(card(3));
  await drag(page, await center(card(2)), { x: top.x, y: top.top + 4 });
  await expect.poll(() => keys('Todo')).toEqual(['HOME-2', 'HOME-3']);
  expect(state.bodies.at(-1)).toEqual({ place: { before: 3 } });
  // Both are saved: after a reload the board shows the same.
  await page.reload();
  await expect.poll(() => keys('Todo')).toEqual(['HOME-2', 'HOME-3']);
  expect(await keys('In progress')).toEqual(['HOME-1']);
  // A click (no movement) still opens the ticket.
  await card(1).click();
  await expect(page).toHaveURL(/\/tickets\/HOME-1$/);
});

test('tickets board: a keyboard drag, and a failed save puts the card back with a message', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const { state, column, card, keys } = await seededBoard(page);
  // Space picks up, the arrows move, Space drops (Enter alone opens it); each step is announced.
  const announced = (text: string) => expect(page.getByRole('status').filter({ hasText: text })).toHaveCount(1);
  await card(2).focus();
  await page.keyboard.press('Space');
  await announced('Picked up HOME-2 “Rotate the logs” in Todo, position 2 of 3.');
  // dnd-kit starts listening for the arrows on its next task; a person is never that quick.
  await page.waitForTimeout(100);
  await page.keyboard.press('ArrowRight');
  await announced('HOME-2 “Rotate the logs”: In progress, position 1 of 1.');
  await page.keyboard.press('Space');
  await announced('Dropped HOME-2 “Rotate the logs” in In progress, position 1 of 1.');
  await expect(page.locator('.ticket-lift')).toHaveCount(0);
  await expect(column('In progress').getByRole('button', { name: /^HOME-2\b/ })).toBeVisible();
  expect(state.bodies.at(-1)).toMatchObject({ status: 'progress' });
  await expect(page).toHaveURL(/\/tickets$/);

  state.failNext = true;
  const target = await center(column('In review'));
  await drag(page, await center(card(3)), { x: target.x, y: target.top + 80 });
  await expect(page.getByRole('alert')).toContainText('HOME-3 could not be moved to In review');
  expect(await keys('Todo')).toEqual(['HOME-3', 'HOME-1']);
  expect(await keys('In review')).toEqual([]);
});

test('tickets: turned on for an organization, a ticket assigned to an agent, its status changed', async ({ page }) => {
  const state = await mockTickets(page);
  // Tickets are set up in the Organization tab (the organization in view).
  await page.goto('/organization');
  const nav = page.getByRole('tablist', { name: 'Main navigation' });
  await expect(nav.getByRole('tab', { name: 'Organization' })).toHaveAttribute('aria-selected', 'true');
  await expect(nav.getByRole('tab', { name: 'Tickets' })).toHaveCount(0);

  // Off by default; turning it on shows the options and the tab.
  const section = page.getByRole('region', { name: 'Tickets' });
  await section.scrollIntoViewIfNeeded();
  await section.getByRole('switch', { name: 'Tickets for Home lab' }).click();
  await expect(section.getByRole('switch', { name: 'Assigning an agent wakes it' })).toBeChecked();
  await nav.getByRole('tab', { name: 'Tickets' }).click();
  await expect(page).toHaveURL(/\/tickets/);
  const board = page.getByRole('region', { name: 'Tickets' });
  await expect(board.getByRole('region', { name: 'In progress', exact: true })).toBeVisible();

  // New ticket, assigned to Avery: she is woken (the hint says so) and the ticket opens.
  await board.getByRole('button', { name: 'New ticket' }).click();
  const dialog = page.getByRole('dialog', { name: 'New ticket' });
  await dialog.getByLabel('Title').fill('Fix the flaky avatar test');
  await dialog.getByLabel('Description').fill('Done when it passes 20 runs in a row.');
  await dialog.getByRole('radio', { name: 'Avery' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Avery is woken right away with this ticket.');
  await dialog.getByRole('button', { name: 'Create ticket' }).click();
  await expect(dialog).toBeHidden();
  expect(state.bodies[0]).toMatchObject({ title: 'Fix the flaky avatar test', assignee: { agentId: 'avery' } });

  const ticket = page.getByRole('region', { name: 'Ticket HOME-1' });
  await expect(page).toHaveURL(/\/tickets\/HOME-1/);
  await expect(ticket.getByRole('heading', { name: 'Fix the flaky avatar test' })).toBeVisible();
  await expect(ticket.getByRole('button', { name: /Avery/, pressed: true })).toBeVisible();
  await expect(ticket.getByText('was woken by the assignment')).toBeVisible();

  // Status changes save at once and show in the activity.
  await ticket.getByRole('radio', { name: 'In progress' }).click();
  await expect(ticket.getByRole('radio', { name: 'In progress' })).toBeChecked();
  await expect(ticket.getByText('moved it Todo → In progress')).toBeVisible();
  expect(state.bodies.at(-1)).toEqual({ status: 'progress' });

  // Back on the board, it sits in its column.
  await ticket.getByRole('button', { name: 'Tickets' }).first().click();
  await expect(
    page
      .getByRole('region', { name: 'In progress', exact: true })
      .getByRole('button', { name: /HOME-1.*Fix the flaky avatar test/ }),
  ).toBeVisible();
});

test('tickets: an agent’s ticket tools are off until granted, then save with the page', async ({ page }) => {
  let body: unknown;
  await page.route('**/api/agents/avery', route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    body = route.request().postDataJSON();
    return route.fulfill({ json: { ...sampleAgents[0], ticketTools: ['ticket_list', 'ticket_read'] } });
  });
  await page.goto('/agents/avery');
  const settingsPage = page.getByRole('region', { name: 'Settings for Avery' });
  const section = settingsPage.getByRole('region', { name: 'Tickets' });
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole('switch', { name: 'ticket_read' })).not.toBeChecked();
  await section.getByRole('switch', { name: 'ticket_list' }).click();
  await section.getByRole('switch', { name: 'ticket_read' }).click();
  await settingsPage.getByRole('button', { name: 'Save changes' }).click();
  await expect(section.getByRole('status')).toContainText('next turn');
  expect(body).toEqual({ ticketTools: ['ticket_list', 'ticket_read'] });
});
