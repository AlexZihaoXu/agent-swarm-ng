import { expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { PlatformStore } from '../platform-store';
import { prepareDatabase } from '../test-database';
import { Organizations } from '../organizations';
import { createTicketTools } from './tools';
import { TICKET_TOOLS, Tickets, type Actor, type TicketChange } from './store';
import type { FileStore } from '../files/store';

const DAY = 86_400_000;

async function setup() {
  const db = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const wakes: { agentId: string; text: string; human: boolean; eventId: string }[] = [];
  const changes: TicketChange[] = [];
  let now = Date.parse('2030-01-01T12:00:00.000Z');
  const tickets = new Tickets(db, {
    wake: async (agentId, text, human, eventId) => {
      wakes.push({ agentId, text, human, eventId });
      return true;
    },
    changed: (_organizationId, change) => changes.push(change),
    now: () => now,
  });
  const agent = (name: string) =>
    db.createAgent({ name, endpointId: 'm', model: 'm', thinkingLevel: 'off', organizationId: 'personal' });
  const owner: Actor = { kind: 'person', userId: 'admin', name: 'Admin' };
  const as = (row: { id: string; name: string }): Actor => ({ kind: 'agent', agentId: row.id, name: row.name });
  const stateId = async (name: string) => (await tickets.states('personal')).find(state => state.name === name)!.id;
  const later = (ms: number) => (now += ms);
  await tickets.updateSettings('personal', { enabled: true, prefix: 'HOME' });
  return { db, tickets, wakes, changes, agent, owner, as, stateId, later };
}

it('seeds every board with the default states and edits them: add, rename, recolour, reorder, notify', async () => {
  const { db, tickets, owner, stateId } = await setup();
  try {
    expect((await tickets.states('personal')).map(state => `${state.name}:${state.category}`)).toEqual([
      'Backlog:backlog',
      'Todo:unstarted',
      'In progress:started',
      'In review:started',
      'Done:completed',
      'Cancelled:canceled',
    ]);
    // In review notifies, as the old "push on In review" option did by default.
    expect((await tickets.states('personal')).find(state => state.name === 'In review')?.notifyOnEnter).toBe(true);
    // A new organization gets them the first time its board is used.
    const lab = await new Organizations(db).create('Lab', 'admin');
    expect(await tickets.states(lab)).toHaveLength(6);
    await tickets.updateSettings(lab, { enabled: true });

    const added = await tickets.addState('personal', { name: 'QA', category: 'started' });
    expect(added.map(state => state.name)).toEqual([
      'Backlog',
      'Todo',
      'In progress',
      'In review',
      'QA',
      'Done',
      'Cancelled',
    ]);
    expect(added.find(state => state.name === 'QA')).toMatchObject({ color: 'amber', notifyOnEnter: false });
    await expect(tickets.addState('personal', { name: 'qa', category: 'backlog' })).rejects.toThrow('already');
    await expect(tickets.addState('personal', { name: 'X', category: 'started', color: 'plaid' })).rejects.toThrow(
      'palette',
    );
    const qa = await stateId('QA');
    // Reordered within its category only: QA first among the started states.
    const moved = await tickets.updateState('personal', qa, { name: 'Testing', color: 'violet', position: 0 });
    expect(moved.filter(state => state.category === 'started').map(state => state.name)).toEqual([
      'Testing',
      'In progress',
      'In review',
    ]);
    expect(moved.find(state => state.id === qa)).toMatchObject({ color: 'violet' });
    await expect(tickets.updateState('personal', qa, { name: 'In Review' })).rejects.toThrow('already');
    await expect(tickets.updateState(lab, qa, { notifyOnEnter: true })).rejects.toThrow('not on this board');
    // Tickets go by name (any case) or id.
    const made = await tickets.create('personal', owner, { title: 'One', status: 'testing' });
    expect(made.ticket.state).toMatchObject({ id: qa, name: 'Testing', category: 'started' });
    await expect(tickets.create('personal', owner, { title: 'Two', status: 'Nowhere' })).rejects.toThrow(
      'No state "Nowhere"',
    );
  } finally {
    await db.close();
  }
});

it('deletes a state only with a place for its tickets, and keeps an unstarted and a completed one', async () => {
  const { db, tickets, owner, stateId, later } = await setup();
  try {
    const [todo, done, review] = [await stateId('Todo'), await stateId('Done'), await stateId('In review')];
    await tickets.create('personal', owner, { title: 'Waiting', status: 'In review' });
    await tickets.create('personal', owner, { title: 'Archived', status: 'In review' });
    await tickets.update('personal', 2, owner, { archived: true });
    await expect(tickets.deleteState('personal', review, owner)).rejects.toThrow('Choose where its 2 tickets go');
    await expect(tickets.deleteState('personal', review, owner, review)).rejects.toThrow('another state');
    later(1000);
    const left = await tickets.deleteState('personal', review, owner, done);
    expect(left.map(state => state.name)).not.toContain('In review');
    // Its tickets (archived ones too) moved, each with an activity entry, and count as closed from now on.
    for (const number of [1, 2]) {
      const { ticket, events } = await tickets.get('personal', number);
      expect(ticket.state.name).toBe('Done');
      expect(events.at(-1)?.text).toBe('moved it In review → Done (In review was deleted)');
    }
    expect((await db.client.ticket.findFirst({ where: { number: 1 } }))?.closedAt?.getTime()).toBe(
      Date.parse('2030-01-01T12:00:01.000Z'),
    );
    await expect(tickets.deleteState('personal', todo, owner, done)).rejects.toThrow('at least one unstarted');
    await expect(tickets.deleteState('personal', done, owner, todo)).rejects.toThrow('at least one completed');
    // An empty state needs no replacement.
    await tickets.deleteState('personal', await stateId('Backlog'), owner);
    expect((await tickets.states('personal')).map(state => state.name)).toEqual([
      'Todo',
      'In progress',
      'Done',
      'Cancelled',
    ]);
  } finally {
    await db.close();
  }
});

it('applies the agents’ rules by category, also to custom states', async () => {
  const { db, tickets, wakes, owner, agent, as } = await setup();
  try {
    await tickets.addState('personal', { name: 'QA', category: 'started' });
    await tickets.addState('personal', { name: 'Shipped', category: 'completed' });
    const aether = await agent('Aether');
    await tickets.create('personal', owner, { title: 'Blocker', assignee: { agentId: aether.id } });
    await tickets.create('personal', owner, { title: 'Blocked', assignee: { agentId: aether.id } });
    await tickets.update('personal', 2, owner, { addRelations: [{ kind: 'blocked_by', number: 1 }] });
    await tickets.create('personal', owner, { title: 'Child', parent: 2 });
    const refused = (work: Promise<unknown>, text: string) => expect(work).rejects.toThrow(text);

    expect((await tickets.update('personal', 1, as(aether), { status: 'qa' })).ticket.state.name).toBe('QA');
    await refused(tickets.update('personal', 1, as(aether), { status: 'Shipped' }), 'completed state');
    await refused(tickets.create('personal', as(aether), { title: 'X', status: 'Shipped' }), 'completed state');
    await refused(tickets.update('personal', 1, as(aether), { archived: true }), 'do not archive');
    // A custom completed state closes: the blocked ticket's agent is woken, sub-issue progress counts it.
    wakes.length = 0;
    await tickets.update('personal', 1, owner, { status: 'Shipped' });
    expect(wakes.map(wake => wake.text)).toEqual([expect.stringContaining('is no longer blocked')]);
    expect(wakes[0]!.text).toContain('to Shipped');
    expect((await tickets.get('personal', 2)).ticket.blocked).toBe(false);
    await tickets.update('personal', 3, owner, { status: 'Shipped' });
    expect((await tickets.get('personal', 2)).ticket.subIssues).toEqual({ done: 1, total: 1 });
    // Closed is the owner's: an agent cannot reopen it.
    await refused(tickets.update('personal', 1, as(aether), { status: 'QA' }), 'only your owner reopens it');
    // Open = not completed or canceled.
    expect((await tickets.list('personal', { open: true })).tickets.map(ticket => ticket.number)).toEqual([2]);
  } finally {
    await db.close();
  }
});

it('wakes a ticket’s agent once when it leaves the backlog, not for its own move, an archived ticket or the option off', async () => {
  const { db, tickets, wakes, owner, agent, as, stateId } = await setup();
  try {
    const [aether, morgan] = [await agent('Aether'), await agent('Morgan')];
    expect(await tickets.settings('personal')).toMatchObject({ wakeOnLeaveBacklog: true });
    await db.client.agent.update({ where: { id: aether.id }, data: { ticketTools: '["ticket_read"]' } });
    await tickets.create('personal', owner, { title: 'Later', status: 'Backlog', assignee: { agentId: aether.id } });
    wakes.length = 0;
    // The owner moves it to Todo: one durable event with the owner's authority.
    const moved = await tickets.update('personal', 1, owner, { status: 'Todo' });
    expect(wakes).toHaveLength(1);
    expect(wakes[0]).toMatchObject({ agentId: aether.id, human: true });
    expect(wakes[0]!.text).toContain('[Tickets · Personal] Your owner moved HOME-1 "Later" from Backlog to Todo');
    expect(wakes[0]!.text).toContain('ticket_read({"id":"HOME-1"}) and start on it');
    expect(await db.client.pendingTimerEvent.findUnique({ where: { id: wakes[0]!.eventId } })).toMatchObject({
      kind: 'ticket',
      agentId: aether.id,
    });
    expect(moved.events.at(-1)).toMatchObject({ kind: 'woken', text: 'was woken: moved out of the backlog' });
    // Not out of the backlog (Todo → In progress, Backlog → another backlog state), nor the agent's own move.
    await tickets.update('personal', 1, owner, { status: 'In progress' });
    await tickets.addState('personal', { name: 'Icebox', category: 'backlog' });
    await tickets.create('personal', owner, { title: 'Mine', status: 'Backlog', assignee: { agentId: aether.id } });
    wakes.length = 0;
    await tickets.update('personal', 2, owner, { status: 'Icebox' });
    await tickets.update('personal', 2, as(aether), { status: 'In progress' });
    expect(wakes).toHaveLength(0);
    // Assigned and moved out in one change: one event saying both.
    await tickets.create('personal', owner, { title: 'Both', status: 'Backlog' });
    await tickets.update('personal', 3, owner, { status: 'Todo', assignee: { agentId: morgan.id } });
    expect(wakes.map(wake => wake.text)).toEqual([
      expect.stringContaining('Your owner assigned you HOME-3 "Both" and moved it from Backlog to Todo'),
    ]);
    // Archived: no wake. The option off: no wake.
    await tickets.create('personal', owner, { title: 'Shelved', status: 'Backlog', assignee: { agentId: morgan.id } });
    await tickets.update('personal', 4, owner, { archived: true });
    wakes.length = 0;
    await tickets.update('personal', 4, owner, { status: 'Todo' });
    expect(wakes).toHaveLength(0);
    await tickets.create('personal', owner, { title: 'Off', status: 'Backlog', assignee: { agentId: morgan.id } });
    await tickets.updateSettings('personal', { wakeOnLeaveBacklog: false });
    wakes.length = 0;
    await tickets.update('personal', 5, owner, { status: 'Todo' });
    expect(wakes).toHaveLength(0);
    // Deleting a backlog state wakes each agent once for the tickets it moved out (option on again).
    await tickets.updateSettings('personal', { wakeOnLeaveBacklog: true });
    await tickets.update('personal', 5, owner, { status: 'Icebox' });
    await tickets.create('personal', owner, { title: 'Too', status: 'Icebox', assignee: { agentId: morgan.id } });
    wakes.length = 0;
    await tickets.deleteState('personal', await stateId('Icebox'), owner, await stateId('Todo'));
    expect(wakes).toHaveLength(1);
    expect(wakes[0]).toMatchObject({ agentId: morgan.id, human: true });
    expect(wakes[0]!.text).toContain('deleted the Icebox state, moving your 2 tickets out of the backlog to Todo');
    expect((await tickets.get('personal', 6)).events.at(-1)?.text).toBe('was woken: moved out of the backlog');
  } finally {
    await db.close();
  }
});

it('counts an agent moving another agent’s ticket out of the backlog toward the hourly cap', async () => {
  const { db, tickets, wakes, owner, agent, as } = await setup();
  try {
    const [aether, morgan] = [await agent('Aether'), await agent('Morgan')];
    await tickets.updateSettings('personal', { wakeOnAssign: false });
    await tickets.create('personal', owner, { title: 'Hand off', status: 'Backlog', assignee: { agentId: aether.id } });
    for (let i = 0; i < 9; i++) await tickets.comment('personal', 1, as(aether), `@Morgan ping ${i}`);
    wakes.length = 0;
    // With waking on assignment off, the move still wakes Morgan, as untrusted (not the owner's).
    await tickets.update('personal', 1, as(aether), { status: 'Todo', assignee: { agentId: morgan.id } });
    expect(wakes).toEqual([expect.objectContaining({ agentId: morgan.id, human: false })]);
    expect(wakes[0]!.text).toContain(
      'Agent "Aether" (another agent, not your owner) moved HOME-1 "Hand off" from Backlog to Todo (assigned to you,',
    );
    // That was the tenth this hour: the next one wakes nobody.
    const last = await tickets.comment('personal', 1, as(aether), '@Morgan once more');
    expect(last.notWoken).toEqual(['Morgan']);
  } finally {
    await db.close();
  }
});

it('tells the owner when someone else moves a ticket into a state that notifies', async () => {
  const { db, tickets, changes, owner, agent, as, stateId } = await setup();
  try {
    const aether = await agent('Aether');
    await tickets.create('personal', owner, { title: 'Spec', assignee: { agentId: aether.id } });
    await tickets.addState('personal', { name: 'QA', category: 'started' });
    await tickets.updateState('personal', await stateId('QA'), { notifyOnEnter: true });
    changes.length = 0;
    await tickets.update('personal', 1, as(aether), { status: 'In progress' });
    await tickets.update('personal', 1, as(aether), { status: 'QA' });
    expect(changes).toEqual([
      { number: 1 },
      { number: 1, entered: { key: 'HOME-1', title: 'Spec', by: 'Aether', state: 'QA' } },
    ]);
    // The owner's own moves, and states that do not notify, tell nobody.
    changes.length = 0;
    await tickets.update('personal', 1, owner, { status: 'In review' });
    await tickets.updateState('personal', await stateId('In review'), { notifyOnEnter: false });
    await tickets.update('personal', 1, as(aether), { status: 'QA' });
    await tickets.update('personal', 1, as(aether), { status: 'In review' });
    expect(changes.filter(change => change.entered)).toEqual([
      { number: 1, entered: expect.objectContaining({ state: 'QA' }) },
    ]);
  } finally {
    await db.close();
  }
});

it('archives by hand and automatically, hiding archived tickets unless asked for', async () => {
  const { db, tickets, owner, agent, later } = await setup();
  try {
    const aether = await agent('Aether');
    await db.client.agent.update({ where: { id: aether.id }, data: { ticketTools: JSON.stringify(TICKET_TOOLS) } });
    const call = async (name: string, input: unknown) => {
      const tool = createTicketTools({
        database: db,
        tickets,
        files: {} as FileStore,
        agentId: aether.id,
        granted: TICKET_TOOLS,
      }).find(item => item.name === name)!;
      const result = await tool.execute('call', input as never, undefined, undefined, undefined as never);
      return JSON.parse((result.content[0] as { text: string }).text);
    };
    for (const title of ['Kept', 'Shelved', 'Finished']) await tickets.create('personal', owner, { title });
    // By hand: archived and restored, each in the activity; editing does not restore it.
    const shelved = await tickets.update('personal', 2, owner, { archived: true });
    expect(shelved.ticket.archived).toEqual({ at: '2030-01-01T12:00:00.000Z', by: 'Admin' });
    await tickets.update('personal', 2, owner, { priority: 'high' });
    expect((await tickets.get('personal', 2)).ticket.archived).not.toBeNull();
    const numbers = async (archived?: boolean) =>
      (await tickets.list('personal', { archived })).tickets.map(ticket => ticket.number).sort();
    expect(await numbers()).toEqual([1, 3]);
    expect(await numbers(true)).toEqual([1, 2, 3]);
    expect(await tickets.refs('personal', [2])).toEqual([expect.objectContaining({ number: 2, archived: true })]);
    expect((await call('ticket_list', {})).tickets.map((ticket: { id: string }) => ticket.id)).toEqual([
      'HOME-3',
      'HOME-1',
    ]);
    expect((await call('ticket_list', { include_archived: true })).tickets).toContainEqual(
      expect.objectContaining({ id: 'HOME-2', archived: '2030-01-01T12:00:00.000Z' }),
    );
    expect(await call('ticket_read', { id: 'HOME-2' })).toMatchObject({ id: 'HOME-2', archived: expect.any(String) });
    const restored = await tickets.update('personal', 2, owner, { archived: false });
    expect(restored.ticket.archived).toBeNull();
    expect(restored.events.slice(-3).map(event => event.text)).toEqual([
      'archived it',
      'set priority High',
      'restored it from the archive',
    ]);

    // Automatically: closed for the organization's days (30 by default), once, with an activity entry.
    await tickets.update('personal', 3, owner, { status: 'Done' });
    await tickets.update('personal', 1, owner, { status: 'Cancelled' });
    later(29 * DAY);
    expect(await tickets.archiveClosed()).toBe(0);
    // Reopened and closed again: counted from the new close.
    await tickets.update('personal', 1, owner, { status: 'Todo' });
    await tickets.update('personal', 1, owner, { status: 'Cancelled' });
    later(DAY);
    expect(await tickets.archiveClosed()).toBe(1);
    expect(await tickets.archiveClosed()).toBe(0);
    const auto = await tickets.get('personal', 3);
    expect(auto.ticket.archived).toMatchObject({ by: 'Platform' });
    expect(
      auto.events.filter(event => event.kind === 'archived').map(event => [event.author.kind, event.text]),
    ).toEqual([['platform', 'archived it automatically: closed for 30 days']]);
    // Never (0), or off for the organization: nothing more is archived.
    later(60 * DAY);
    await tickets.updateSettings('personal', { archiveAfterDays: 0 });
    expect(await tickets.archiveClosed()).toBe(0);
    await tickets.updateSettings('personal', { archiveAfterDays: 7 });
    expect(await tickets.archiveClosed()).toBe(1);
    await expect(tickets.updateSettings('personal', { archiveAfterDays: -1 })).rejects.toThrow('Auto-archive');
  } finally {
    await db.close();
  }
});

it('migrates old fixed statuses to each organization’s seeded states, keeping order and the push option', async () => {
  const url = pathToFileURL(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`)).href;
  const client = createClient({ url });
  const migrations = new URL('../../prisma/migrations/', import.meta.url);
  const names = (await readdir(migrations)).filter(name => name !== 'migration_lock.toml').sort();
  const workflow = names.indexOf('20261017040000_ticket_workflow');
  for (const name of names.slice(0, workflow))
    await client.executeMultiple(await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8'));
  const old = (number: number, status: string, org = 'personal', position = 0) =>
    `INSERT INTO "Ticket" ("id", "organizationId", "number", "title", "status", "position", "writerKind", "writerId", "writerName", "createdByName", "updatedAt") VALUES ('t-${org}-${number}', '${org}', ${number}, 'T${number}', '${status}', ${position}, 'person', 'admin', 'Admin', 'Admin', '2030-01-0${number}T00:00:00.000Z');`;
  await client.executeMultiple(`
    UPDATE "Organization" SET "ticketsEnabled" = true WHERE "id" = 'personal';
    INSERT INTO "Organization" ("id", "name", "ownerId", "ticketsEnabled", "ticketPushReview") VALUES ('lab', 'Lab', 'admin', true, false);
    ${old(1, 'backlog')} ${old(2, 'todo', 'personal', 1)} ${old(3, 'todo', 'personal', 0)} ${old(4, 'progress')}
    ${old(5, 'review')} ${old(6, 'done')} ${old(7, 'cancelled')} ${old(8, 'odd')} ${old(1, 'review', 'lab')}`);
  for (const name of names.slice(workflow))
    await client.executeMultiple(await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8'));
  client.close();
  const db = new PlatformStore(url);
  await db.initialize();
  const tickets = new Tickets(db);
  try {
    const board = await tickets.list('personal', { order: 'board' });
    expect(board.states.map(state => state.name)).toEqual([
      'Backlog',
      'Todo',
      'In progress',
      'In review',
      'Done',
      'Cancelled',
    ]);
    expect(board.tickets.map(ticket => `${ticket.number}:${ticket.state.name}`).sort()).toEqual([
      '1:Backlog',
      '2:Todo',
      '3:Todo',
      '4:In progress',
      '5:In review',
      '6:Done',
      '7:Cancelled',
      '8:Todo',
    ]);
    // The column keeps its manual order.
    const todo = board.tickets.filter(ticket => ticket.state.name === 'Todo').map(ticket => ticket.number);
    expect(todo.indexOf(3)).toBeLessThan(todo.indexOf(2));
    // Closed ones count as closed since their last change; open ones not at all.
    const rows = await db.client.ticket.findMany({ where: { organizationId: 'personal' }, orderBy: { number: 'asc' } });
    expect(rows.map(row => row.closedAt?.toISOString() ?? null)).toEqual([
      null,
      null,
      null,
      null,
      null,
      '2030-01-06T00:00:00.000Z',
      '2030-01-07T00:00:00.000Z',
      null,
    ]);
    // Each organization has its own states; In review notifies as its old option said.
    const lab = await tickets.list('lab');
    expect(lab.tickets[0]?.state).toMatchObject({ name: 'In review', id: lab.states[3]!.id });
    expect(lab.states[3]?.notifyOnEnter).toBe(false);
    expect(board.states[3]?.notifyOnEnter).toBe(true);
    expect(lab.states.map(state => state.id)).not.toContain(board.states[3]!.id);
  } finally {
    await db.close();
  }
});
