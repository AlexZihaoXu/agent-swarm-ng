import { expect, type Page } from './fixtures';
import { sampleAgents } from './sample-agents';

export type Ticket = Record<string, any>;
const settings = (enabled: boolean) => ({
  enabled,
  prefix: 'HOME',
  wakeOnAssign: true,
  agentsCreate: true,
  agentsPickUp: false,
  archiveAfterDays: 30,
});

/** The default workflow (docs/tickets.md#workflow); the mock's state ids are the old status keys. */
export const defaultStates = () => [
  { id: 'backlog', name: 'Backlog', color: 'gray', category: 'backlog', notifyOnEnter: false },
  { id: 'todo', name: 'Todo', color: 'silver', category: 'unstarted', notifyOnEnter: false },
  { id: 'progress', name: 'In progress', color: 'amber', category: 'started', notifyOnEnter: false },
  { id: 'review', name: 'In review', color: 'sky', category: 'started', notifyOnEnter: true },
  { id: 'done', name: 'Done', color: 'emerald', category: 'completed', notifyOnEnter: false },
  { id: 'cancelled', name: 'Cancelled', color: 'slate', category: 'canceled', notifyOnEnter: false },
];
const CATEGORIES = ['backlog', 'unstarted', 'started', 'completed', 'canceled'];
const INVERSE: Record<string, string> = {
  blocks: 'blocked_by',
  blocked_by: 'blocks',
  related: 'related',
  duplicate_of: 'duplicated_by',
  duplicated_by: 'duplicate_of',
};
/** A ticket as the list route answers it (docs/tickets.md), with these fields set; `status` is its state's id. */
export const ticketOf = (number: number, fields: Ticket = {}): Ticket => ({
  id: `ticket-${number}`,
  number,
  key: `HOME-${number}`,
  title: `Ticket ${number}`,
  description: '',
  status: 'todo',
  priority: 'none',
  labels: [],
  links: [],
  assignee: null,
  parent: null,
  due: null,
  archived: null,
  writer: { kind: 'person', id: 'admin', name: 'Admin', trusted: true },
  createdBy: 'Admin',
  createdAt: '2030-01-01T10:00:00.000Z',
  updatedAt: '2030-01-01T10:00:00.000Z',
  ...fields,
});

/**
 * A stateful stand-in for the organization and ticket routes (docs/tickets.md): the board (with `q`), one ticket
 * with its sub-issues and relations, changes, comments (edit, delete), and the reference lookup for chips.
 */
export async function mockTickets(page: Page) {
  const state = {
    enabled: false,
    states: defaultStates(),
    tickets: [] as Ticket[],
    events: new Map<number, Ticket[]>(),
    /** Relations as [from, kind, to] seen from `from`. */
    relations: [] as [number, string, number][],
    bodies: [] as unknown[],
    queries: [] as string[],
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
  // The workflow editor: add, change (a position is the index within its category) and delete states.
  const ordered = () =>
    [...state.states].sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category));
  await page.route(/\/api\/organizations\/personal\/ticket-states(\/[^/?]+)?(\?.*)?$/, route => {
    const request = route.request();
    const url = new URL(request.url());
    const id = url.pathname.split('/')[5];
    const body = request.method() === 'DELETE' ? {} : request.postDataJSON();
    state.bodies.push({ [`${request.method()} state`]: id ?? null, ...body });
    if (request.method() === 'POST')
      state.states.push({ id: `state-${state.states.length + 1}`, color: 'amber', notifyOnEnter: false, ...body });
    const found = state.states.find(item => item.id === id);
    if (request.method() === 'PATCH' && found) {
      const { position, ...rest } = body;
      Object.assign(found, rest);
      if (position !== undefined) {
        const peers = ordered().filter(item => item.category === found.category && item !== found);
        peers.splice(position, 0, found);
        state.states = [...ordered().filter(item => item.category !== found.category), ...peers];
      }
    }
    if (request.method() === 'DELETE' && found) {
      const moveTo = url.searchParams.get('moveTo');
      for (const ticket of state.tickets.filter(item => item.status === id)) ticket.status = moveTo;
      state.states = state.states.filter(item => item !== found);
    }
    state.states = ordered();
    return route.fulfill({ json: { states: state.states } });
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
  const find = (number: number) => state.tickets.find(item => item.number === number);
  const stateOf = (id: string) => {
    const { notifyOnEnter: _, ...view } = state.states.find(item => item.id === id) ?? state.states[1]!;
    return view;
  };
  const closed = (id: string) => ['completed', 'canceled'].includes(stateOf(id).category);
  const brief = (ticket: Ticket) => ({
    number: ticket.number,
    key: ticket.key,
    title: ticket.title,
    state: stateOf(ticket.status),
    archived: Boolean(ticket.archived),
  });
  const relationsOf = (number: number) =>
    state.relations.flatMap(([from, kind, to]) => {
      const other = find(from === number ? to : from);
      if (!other || (from !== number && to !== number)) return [];
      return [{ kind: from === number ? kind : INVERSE[kind], ...brief(other), status: other.status }];
    });
  const summary = (ticket: Ticket) => {
    const children = state.tickets.filter(item => item.parent?.number === ticket.number);
    const counted = children.filter(item => stateOf(item.status).category !== 'canceled');
    const { status, ...rest } = ticket;
    return {
      ...rest,
      state: stateOf(status),
      parent: ticket.parent ? brief(find(ticket.parent.number) ?? ticket.parent) : null,
      subIssues: {
        done: counted.filter(item => stateOf(item.status).category === 'completed').length,
        total: counted.length,
      },
      blocked: relationsOf(ticket.number).some(rel => rel.kind === 'blocked_by' && !closed(rel.status)),
    };
  };
  const detail = (ticket: Ticket) => ({
    ticket: summary(ticket),
    children: state.tickets
      .filter(item => item.parent?.number === ticket.number)
      .map(item => ({ ...brief(item), assignee: item.assignee })),
    relations: relationsOf(ticket.number).map(({ status: _, ...rel }) => rel),
    events: state.events.get(ticket.number) ?? [],
    olderEvents: false,
  });
  await page.route(/\/api\/organizations\/personal\/ticket-refs\?/, route => {
    const numbers = (new URL(route.request().url()).searchParams.get('numbers') ?? '').split(',').map(Number);
    return route.fulfill({ json: { tickets: state.tickets.filter(item => numbers.includes(item.number)).map(brief) } });
  });
  await page.route(/\/api\/organizations\/personal\/tickets\/\d+\/comments\/[^/]+$/, route => {
    const request = route.request();
    const [, , , , , number, , commentId] = new URL(request.url()).pathname.split('/');
    const ticket = find(Number(number))!;
    const comment = state.events.get(ticket.number)!.find(item => item.id === commentId)!;
    if (request.method() === 'PATCH')
      Object.assign(comment, { text: request.postDataJSON().text, editedAt: '2030-01-01T11:00:00.000Z' });
    else Object.assign(comment, { text: '', deleted: { by: 'Admin', at: '2030-01-01T11:00:00.000Z' } });
    return route.fulfill({ json: detail(ticket) });
  });
  await page.route(/\/api\/organizations\/personal\/tickets(\/\d+)?(\/comments)?(\?.*)?$/, route => {
    const request = route.request();
    const url = new URL(request.url());
    const number = Number(url.pathname.split('/')[5] ?? 0);
    if (request.method() === 'GET' && !number) {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      if (q) state.queries.push(q);
      const archived = url.searchParams.get('archived') === '1';
      const shown = state.tickets.filter(
        item =>
          (archived || !item.archived) &&
          (!q ||
            item.title.toLowerCase().includes(q) ||
            item.description.toLowerCase().includes(q) ||
            item.key.toLowerCase() === q),
      );
      return route.fulfill({
        json: {
          settings: settings(state.enabled),
          states: state.states,
          tickets: shown.map(summary),
          truncated: false,
        },
      });
    }
    const ticket = find(number);
    if (request.method() === 'DELETE') {
      state.bodies.push({ DELETE: number });
      state.tickets = state.tickets.filter(item => item !== ticket);
      return route.fulfill({ json: { deleted: Boolean(ticket) } });
    }
    if (request.method() === 'GET')
      return ticket
        ? route.fulfill({ json: detail(ticket) })
        : route.fulfill({ status: 404, json: { message: 'No.' } });
    const body = request.postDataJSON();
    state.bodies.push(body);
    if (request.method() === 'POST' && url.pathname.endsWith('/comments')) {
      state.events.get(number)!.push(event('comment', body.text));
      return route.fulfill({ json: detail(ticket!) });
    }
    if (request.method() === 'POST') {
      const agent = sampleAgents.find(item => item.id === body.assignee?.agentId);
      const next = Math.max(0, ...state.tickets.map(item => item.number)) + 1;
      const parent = body.parent ? find(body.parent) : undefined;
      const made = ticketOf(next, {
        title: body.title,
        description: body.description ?? '',
        priority: body.priority ?? 'none',
        due: body.due ?? null,
        parent: parent ? brief(parent) : null,
        links: body.linkMessage
          ? [
              {
                kind: 'message',
                id: body.linkMessage,
                label: (body.description ?? '').slice(0, 80),
                conversation: { kind: 'chat', id: 'avery', agentId: 'avery', name: 'Avery' },
              },
            ]
          : [],
        assignee: agent ? { kind: 'agent', id: agent.id, name: agent.name } : null,
        updatedAt: new Date().toISOString(),
      });
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
      state.events
        .get(number)!
        .push(event('status', `moved it ${stateOf(ticket.status).name} → ${stateOf(body.status).name}`));
      ticket.status = body.status;
    }
    if (body.archived !== undefined) {
      ticket.archived = body.archived ? { at: '2030-01-01T11:00:00.000Z', by: 'Admin' } : null;
      state.events
        .get(number)!
        .push(
          event(
            body.archived ? 'archived' : 'restored',
            body.archived ? 'archived it' : 'restored it from the archive',
          ),
        );
    }
    if (body.due !== undefined) ticket.due = body.due;
    for (const rel of body.addRelations ?? []) state.relations.push([number, rel.kind, rel.number]);
    for (const rel of body.removeRelations ?? [])
      state.relations = state.relations.filter(
        ([from, kind, to]) =>
          !(from === number && kind === rel.kind && to === rel.number) &&
          !(to === number && from === rel.number && kind === INVERSE[rel.kind]),
      );
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
export async function seededBoard(page: Page) {
  const state = await mockTickets(page);
  state.enabled = true;
  state.tickets = [3, 2, 1].map(number =>
    ticketOf(number, { title: ['Back up Keep', 'Rotate the logs', 'Update the image'][number - 1] }),
  );
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
