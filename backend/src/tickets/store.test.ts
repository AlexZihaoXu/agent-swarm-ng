import { expect, it } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from '../test-database';
import { Organizations } from '../organizations';
import { Tickets, TicketError, type Actor } from './store';

async function setup() {
  const db = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const wakes: { agentId: string; text: string; human: boolean; eventId: string }[] = [];
  const changes: unknown[] = [];
  const tickets = new Tickets(db, {
    wake: async (agentId, text, human, eventId) => {
      wakes.push({ agentId, text, human, eventId });
      return true;
    },
    changed: (organizationId, change) => changes.push({ organizationId, ...change }),
  });
  const agent = (name: string, organizationId = 'personal') =>
    db.createAgent({ name, endpointId: 'm', model: 'm', thinkingLevel: 'off', organizationId });
  const owner: Actor = { kind: 'person', userId: 'admin', name: 'Admin' };
  const as = (row: { id: string; name: string }): Actor => ({ kind: 'agent', agentId: row.id, name: row.name });
  return { db, tickets, wakes, changes, agent, owner, as, orgs: new Organizations(db) };
}

it('is off until the owner turns it on, then numbers tickets per organization with a prefix from its name', async () => {
  const { db, tickets, owner, orgs } = await setup();
  try {
    expect(await tickets.settings('personal')).toMatchObject({ enabled: false, prefix: 'PERS', wakeOnAssign: true });
    await expect(tickets.create('personal', owner, { title: 'A' })).rejects.toThrow('Tickets are off');
    await tickets.updateSettings('personal', { enabled: true });
    const first = await tickets.create('personal', owner, { title: '  Back up Keep  ' });
    const second = await tickets.create('personal', owner, {
      title: 'Second',
      priority: 'high',
      labels: ['Ops', 'ops'],
    });
    expect([first.ticket.key, second.ticket.key]).toEqual(['PERS-1', 'PERS-2']);
    expect(first.ticket).toMatchObject({ title: 'Back up Keep', status: 'todo', priority: 'none' });
    expect(second.ticket.labels).toEqual(['ops']);
    await tickets.updateSettings('personal', { prefix: 'home' });
    expect((await tickets.get('personal', 2)).ticket.key).toBe('HOME-2');
    await expect(tickets.updateSettings('personal', { prefix: 'no way' })).rejects.toThrow('prefix');
    // Another organization counts from 1 on its own.
    const lab = await orgs.create('Lab', 'admin');
    await tickets.updateSettings(lab, { enabled: true });
    expect((await tickets.create(lab, owner, { title: 'Elsewhere' })).ticket.key).toBe('LAB-1');
    expect((await tickets.list('personal')).tickets.map(item => item.number)).toEqual([2, 1]);
  } finally {
    await db.close();
  }
});

it('wakes an assigned agent durably, with its owner’s authority only when the owner assigned it', async () => {
  const { db, tickets, wakes, owner, agent, as } = await setup();
  try {
    await tickets.updateSettings('personal', { enabled: true, prefix: 'HOME' });
    const [aether, morgan] = [await agent('Aether'), await agent('Morgan')];
    const made = await tickets.create('personal', owner, {
      title: 'Fix the flaky avatar test',
      description: 'Done when it passes 20 runs.',
      priority: 'high',
      assignee: { agentId: aether.id },
    });
    expect(wakes).toHaveLength(1);
    expect(wakes[0]).toMatchObject({ agentId: aether.id, human: true });
    expect(wakes[0]!.text).toContain(
      'Your owner assigned you HOME-1 "Fix the flaky avatar test" (priority High, Todo)',
    );
    // Saved before it was handed over, so a restart delivers it again.
    expect(await db.client.pendingTimerEvent.findUnique({ where: { id: wakes[0]!.eventId } })).toMatchObject({
      kind: 'ticket',
      agentId: aether.id,
      human: true,
    });
    expect(made.events.map(event => event.kind)).toEqual(['created', 'assignee', 'woken']);
    // Aether hands it to Morgan: Morgan is woken, but not with the owner's authority.
    await tickets.update('personal', 1, as(aether), { assignee: { agentId: morgan.id } });
    expect(wakes[1]).toMatchObject({ agentId: morgan.id, human: false });
    expect(wakes[1]!.text).toContain('Agent "Aether" (another agent, not your owner) assigned you HOME-1');
    // Reassigning to the same agent, or with waking off, wakes nobody.
    await tickets.update('personal', 1, owner, { assignee: { agentId: morgan.id }, priority: 'low' });
    await tickets.updateSettings('personal', { wakeOnAssign: false });
    await tickets.update('personal', 1, owner, { assignee: { agentId: aether.id } });
    expect(wakes).toHaveLength(2);
  } finally {
    await db.close();
  }
});

it('enforces what agents may do: their own organization, their own tickets, never Done or another person', async () => {
  const { db, tickets, owner, agent, as, orgs } = await setup();
  try {
    await tickets.updateSettings('personal', { enabled: true });
    const lab = await orgs.create('Lab', 'admin');
    await tickets.updateSettings(lab, { enabled: true });
    const [aether, morgan, outsider] = [await agent('Aether'), await agent('Morgan'), await agent('Rex', lab)];
    const mine = await tickets.create('personal', owner, { title: 'Mine', assignee: { agentId: aether.id } });
    const open = await tickets.create('personal', owner, { title: 'Unassigned' });
    const theirs = await tickets.create('personal', owner, { title: 'Morgan’s', assignee: { agentId: morgan.id } });
    const refused = (work: Promise<unknown>, text: string) => expect(work).rejects.toThrow(text);

    await refused(tickets.update('personal', mine.ticket.number, as(aether), { status: 'done' }), 'In review');
    await refused(tickets.update('personal', mine.ticket.number, as(aether), { status: 'cancelled' }), 'In review');
    await refused(
      tickets.update('personal', mine.ticket.number, as(aether), { assignee: { agentId: outsider.id } }),
      'not an agent of this organization',
    );
    await refused(tickets.update('personal', theirs.ticket.number, as(aether), { priority: 'low' }), 'assigned to');
    await refused(tickets.update('personal', open.ticket.number, as(aether), { priority: 'low' }), 'pick up');
    await refused(tickets.get('personal', 1, as(outsider)), 'not found');
    await refused(tickets.create('personal', as(outsider), { title: 'Sneaky' }), 'not found');

    // Its own ticket: through In progress to In review, back to the owner.
    await tickets.update('personal', mine.ticket.number, as(aether), { status: 'progress' });
    const reviewed = await tickets.update('personal', mine.ticket.number, as(aether), {
      status: 'review',
      assignee: { owner: true },
    });
    expect(reviewed.ticket).toMatchObject({ status: 'review', assignee: { kind: 'owner' } });

    // Picking up unassigned work needs the owner's option.
    await tickets.updateSettings('personal', { agentsPickUp: true });
    await tickets.update('personal', open.ticket.number, as(aether), { assignee: { agentId: aether.id } });
    // Done is the owner's: an agent cannot reopen it either.
    await tickets.update('personal', open.ticket.number, owner, { status: 'done' });
    await refused(tickets.update('personal', open.ticket.number, as(aether), { status: 'todo' }), 'Done');

    await tickets.updateSettings('personal', { agentsCreate: false });
    await refused(tickets.create('personal', as(aether), { title: 'Follow-up' }), 'create');
    await tickets.updateSettings('personal', { agentsCreate: true });
    await refused(tickets.create('personal', as(aether), { title: 'Done already', status: 'done' }), 'In review');
    const filed = await tickets.create('personal', as(aether), {
      title: 'Follow-up',
      assignee: { agentId: morgan.id },
    });
    expect(filed.ticket).toMatchObject({ createdBy: 'Aether', writer: { kind: 'agent', trusted: false } });
    expect(mine.ticket.writer).toMatchObject({ kind: 'person', trusted: true });
  } finally {
    await db.close();
  }
});

it('wakes an agent mentioned in a comment, without reassigning, and bounds agents waking each other', async () => {
  const { db, tickets, wakes, owner, agent, as } = await setup();
  try {
    await tickets.updateSettings('personal', { enabled: true, prefix: 'HOME' });
    const [aether, morgan] = [await agent('Aether'), await agent('Morgan Lee')];
    await tickets.create('personal', owner, { title: 'Spec', assignee: { agentId: morgan.id } });
    wakes.length = 0;
    const after = await tickets.comment(
      'personal',
      1,
      owner,
      '@aether can you also check the export test? @Morgan Lee',
    );
    expect(wakes.map(wake => wake.agentId).sort()).toEqual([aether.id, morgan.id].sort());
    expect(wakes[0]!.text).toContain('Your owner mentioned you in a comment on HOME-1 "Spec"');
    expect(wakes[0]!.text).toContain('not an assignment');
    expect(after.ticket.assignee).toMatchObject({ kind: 'agent', id: morgan.id });
    // An agent's own mention of itself wakes nobody; agents waking each other on one ticket are capped.
    wakes.length = 0;
    await tickets.comment('personal', 1, as(morgan), 'Noted, @Morgan Lee will do it.');
    expect(wakes).toHaveLength(0);
    for (let i = 0; i < 12; i++) await tickets.comment('personal', 1, as(morgan), `@Aether ping ${i}`);
    expect(wakes).toHaveLength(10);
    const last = await tickets.comment('personal', 1, as(morgan), '@Aether once more');
    expect(last.notWoken).toEqual(['Aether']);
    await expect(tickets.comment('personal', 1, owner, '   ')).rejects.toBeInstanceOf(TicketError);
  } finally {
    await db.close();
  }
});

it('unassigns an agent that is deleted or moves to another organization', async () => {
  const { db, tickets, owner, agent, orgs } = await setup();
  try {
    await tickets.updateSettings('personal', { enabled: true });
    const [aether, morgan] = [await agent('Aether'), await agent('Morgan')];
    await tickets.create('personal', owner, { title: 'One', assignee: { agentId: aether.id } });
    await tickets.create('personal', owner, { title: 'Two', assignee: { agentId: morgan.id } });
    const lab = await orgs.create('Lab', 'admin');
    expect((await orgs.move('agent', aether.id, lab, false)).dropped).toContain('Ticket PERS-1: unassigned');
    await orgs.move('agent', aether.id, lab, true);
    expect((await tickets.get('personal', 1)).ticket.assignee).toBeNull();
    await db.client.agent.delete({ where: { id: morgan.id } });
    expect((await tickets.get('personal', 2)).ticket.assignee).toBeNull();
    expect((await tickets.get('personal', 2)).events.find(event => event.kind === 'assignee')?.text).toContain(
      'Morgan',
    );
  } finally {
    await db.close();
  }
});
