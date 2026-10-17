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

/** A stateful stand-in for the organization and ticket routes (docs/tickets.md). */
async function mockTickets(page: Page) {
  const state = {
    enabled: false,
    tickets: [] as Ticket[],
    events: new Map<number, Ticket[]>(),
    bodies: [] as unknown[],
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
    if (body.status && body.status !== ticket.status) {
      state.events.get(number)!.push(event('status', `moved it Todo → In progress`));
      ticket.status = body.status;
    }
    return route.fulfill({ json: detail(ticket) });
  });
  return state;
}

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
