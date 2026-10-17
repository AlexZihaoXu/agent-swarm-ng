import { expect, it } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from '../test-database';
import { Organizations } from '../organizations';
import { AgentTimers } from '../agent-timers';
import { Tickets, type Actor } from './store';
import { dayStart } from './due';

/** Sub-issues, relations, due dates and comment edits (docs/tickets.md). */
async function setup() {
  const db = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const wakes: { agentId: string; text: string; human: boolean; eventId: string }[] = [];
  const clock = { now: Date.parse('2026-10-17T12:00:00Z') };
  const make = () =>
    new Tickets(db, {
      wake: async (agentId, text, human, eventId) => {
        wakes.push({ agentId, text, human, eventId });
        return true;
      },
      now: () => clock.now,
    });
  const tickets = make();
  const agent = (name: string, organizationId = 'personal') =>
    db.createAgent({ name, endpointId: 'm', model: 'm', thinkingLevel: 'off', organizationId });
  const owner: Actor = { kind: 'person', userId: 'admin', name: 'Admin' };
  const as = (row: { id: string; name: string }): Actor => ({ kind: 'agent', agentId: row.id, name: row.name });
  await tickets.updateSettings('personal', { enabled: true, prefix: 'HOME' });
  return { db, tickets, make, wakes, clock, agent, owner, as, orgs: new Organizations(db) };
}

it('keeps sub-issues in one organization, without cycles and at most three levels deep', async () => {
  const { db, tickets, owner, agent, as, orgs } = await setup();
  try {
    const aether = await agent('Aether');
    await tickets.create('personal', owner, { title: 'Release', assignee: { agentId: aether.id } });
    const child = await tickets.create('personal', owner, { title: 'Changelog', parent: 1 });
    expect(child.ticket.parent).toMatchObject({ number: 1, key: 'HOME-1', title: 'Release' });
    expect(child.events.map(event => event.text)).toContain('made it a sub-issue of HOME-1');
    await tickets.create('personal', owner, { title: 'Tag', parent: 2 });
    await tickets.update('personal', 2, owner, { status: 'Done' });
    const parent = await tickets.get('personal', 1);
    expect(parent.children.map(item => [item.key, item.state.name])).toEqual([['HOME-2', 'Done']]);
    expect((await tickets.list('personal')).tickets.find(item => item.number === 1)?.subIssues).toEqual({
      done: 1,
      total: 1,
    });
    // No cycles, no deeper than three levels, never itself.
    await expect(tickets.update('personal', 1, owner, { parent: 3 })).rejects.toThrow('own sub-issue');
    await expect(tickets.update('personal', 1, owner, { parent: 1 })).rejects.toThrow('own sub-issue');
    await expect(tickets.create('personal', owner, { title: 'Too deep', parent: 3 })).rejects.toThrow('three levels');
    const loose = await tickets.create('personal', owner, { title: 'Loose' });
    await expect(tickets.update('personal', 1, owner, { parent: loose.ticket.number })).rejects.toThrow('three levels');
    // Another organization's ticket is not found here (numbers are per organization).
    const lab = await orgs.create('Lab', 'admin');
    await tickets.updateSettings(lab, { enabled: true });
    await tickets.create(lab, owner, { title: 'Lab one' });
    await tickets.create(lab, owner, { title: 'Lab two' });
    await expect(tickets.create(lab, owner, { title: 'Sneaky', parent: 3 })).rejects.toThrow('No ticket 3');
    // Agents split their own work, not someone else's.
    const sub = await tickets.create('personal', as(aether), { title: 'Mine too', parent: 1 });
    expect(sub.ticket.parent?.number).toBe(1);
    await expect(tickets.create('personal', as(aether), { title: 'Nope', parent: 4 })).rejects.toThrow('unassigned');
    // Removing the parent; deleting a parent keeps its sub-issues.
    await tickets.update('personal', sub.ticket.number, owner, { parent: null });
    expect((await tickets.get('personal', sub.ticket.number)).ticket.parent).toBeNull();
    await tickets.remove('personal', 1);
    expect((await tickets.get('personal', 2)).ticket.parent).toBeNull();
  } finally {
    await db.close();
  }
});

it('relates tickets and wakes the assigned agent once the last open blocker is closed', async () => {
  const { db, tickets, wakes, owner, agent, as } = await setup();
  try {
    const [aether, morgan] = [await agent('Aether'), await agent('Morgan')];
    await tickets.create('personal', owner, { title: 'Migrate the database' });
    await tickets.create('personal', owner, { title: 'Back up first' });
    await tickets.create('personal', owner, { title: 'Ship it', assignee: { agentId: aether.id } });
    wakes.length = 0;
    const blocked = await tickets.update('personal', 3, owner, {
      addRelations: [
        { kind: 'blocked_by', number: 1 },
        { kind: 'blocked_by', number: 2 },
      ],
    });
    expect(blocked.relations.map(item => [item.kind, item.key])).toEqual([
      ['blocked_by', 'HOME-1'],
      ['blocked_by', 'HOME-2'],
    ]);
    expect((await tickets.get('personal', 1)).relations).toMatchObject([{ kind: 'blocks', key: 'HOME-3' }]);
    expect((await tickets.list('personal')).tickets.find(item => item.number === 3)?.blocked).toBe(true);
    await expect(
      tickets.update('personal', 3, owner, { addRelations: [{ kind: 'related', number: 3 }] }),
    ).rejects.toThrow('itself');
    await expect(
      tickets.update('personal', 1, owner, { addRelations: [{ kind: 'blocked_by', number: 3 }] }),
    ).rejects.toThrow('already blocks');
    await expect(
      tickets.update('personal', 3, owner, { addRelations: [{ kind: 'related', number: 99 }] }),
    ).rejects.toThrow('No ticket 99');

    // One blocker closed: still blocked, nobody woken. The last one: Aether hears, durably.
    await tickets.update('personal', 1, owner, { status: 'Done' });
    expect(wakes).toHaveLength(0);
    await tickets.update('personal', 2, owner, { status: 'Cancelled' });
    expect(wakes).toHaveLength(1);
    expect(wakes[0]).toMatchObject({ agentId: aether.id, human: true });
    expect(wakes[0]!.text).toContain('HOME-3 "Ship it" is no longer blocked');
    expect(await db.client.pendingTimerEvent.findUnique({ where: { id: wakes[0]!.eventId } })).toMatchObject({
      kind: 'ticket',
    });
    expect((await tickets.get('personal', 3)).events.at(-1)).toMatchObject({
      kind: 'woken',
      text: 'was woken: no longer blocked',
    });
    expect((await tickets.list('personal')).tickets.find(item => item.number === 3)?.blocked).toBe(false);

    // Agents relate only tickets they may change, to tickets of their organization.
    const mine = await tickets.update('personal', 3, as(aether), {
      addRelations: [{ kind: 'related', number: 1 }],
      removeRelations: [{ kind: 'blocked_by', number: 2 }],
    });
    expect(mine.relations.map(item => [item.kind, item.number])).toEqual([
      ['blocked_by', 1],
      ['related', 1],
    ]);
    await expect(
      tickets.update('personal', 1, as(morgan), { addRelations: [{ kind: 'duplicate_of', number: 3 }] }),
    ).rejects.toThrow('unassigned');
  } finally {
    await db.close();
  }
});

it('reminds the assigned agent once when its ticket is due, again after a restart, re-armed by a new date', async () => {
  const { db, tickets, make, wakes, clock, owner, agent } = await setup();
  try {
    await db.client.user.update({ where: { id: 'admin' }, data: { timeZone: 'America/Toronto' } });
    expect(dayStart('2026-10-20', 'America/Toronto').toISOString()).toBe('2026-10-20T04:00:00.000Z');
    expect(dayStart('2026-12-01', 'America/Toronto').toISOString()).toBe('2026-12-01T05:00:00.000Z');
    const aether = await agent('Aether');
    const made = await tickets.create('personal', owner, {
      title: 'Renew the certificate',
      due: '2026-10-20',
      assignee: { agentId: aether.id },
    });
    expect(made.ticket.due).toBe('2026-10-20');
    await expect(tickets.update('personal', 1, owner, { due: '2026-02-30' })).rejects.toThrow('date');
    await tickets.create('personal', owner, { title: 'Closed', due: '2026-10-19', assignee: { agentId: aether.id } });
    await tickets.update('personal', 2, owner, { status: 'Done' });
    wakes.length = 0;
    await tickets.checkDue();
    expect(wakes).toHaveLength(0);

    // The platform was down when it came due: the next start reminds, once, and saved first.
    clock.now = Date.parse('2026-10-20T09:00:00Z');
    const restarted = make();
    await restarted.checkDue();
    await restarted.checkDue();
    expect(wakes).toHaveLength(1);
    expect(wakes[0]!.text).toContain('HOME-1 "Renew the certificate" is due today (2026-10-20)');
    const saved = await db.client.pendingTimerEvent.findUnique({ where: { id: wakes[0]!.eventId } });
    expect(saved).toMatchObject({ kind: 'ticket', agentId: aether.id });
    // Not seen by a turn before another restart: delivered again, marked.
    const again: string[] = [];
    await new AgentTimers(db, async (_agent, _kind, text) => {
      again.push(text);
      return true;
    }).redeliver();
    expect(again[0]).toMatch(/^\[Delivered again: this ticket event arrived/);

    // A new date re-arms it.
    await tickets.update('personal', 1, owner, { due: '2026-10-22' });
    await tickets.checkDue();
    expect(wakes).toHaveLength(1);
    clock.now = Date.parse('2026-10-22T05:00:00Z');
    await tickets.checkDue();
    expect(wakes).toHaveLength(2);
    expect((await tickets.update('personal', 1, owner, { due: null })).ticket.due).toBeNull();
  } finally {
    await db.close();
  }
});

it('lets people edit their own comments and delete their own (the owner any), leaving a tombstone', async () => {
  const { db, tickets, owner, agent, as } = await setup();
  try {
    const aether = await agent('Aether');
    await tickets.create('personal', owner, { title: 'Spec' });
    const posted = await tickets.comment('personal', 1, owner, 'First tkae');
    const id = posted.events.at(-1)!.id;
    const edited = await tickets.editComment('personal', 1, id, owner, 'First take');
    expect(edited.events.at(-1)).toMatchObject({ text: 'First take', editedAt: expect.any(String) });
    const visitor: Actor = { kind: 'person', userId: 'someone', name: 'Sam' };
    await expect(tickets.editComment('personal', 1, id, visitor, 'Mine now')).rejects.toThrow('your own');
    await expect(tickets.deleteComment('personal', 1, id, visitor)).rejects.toThrow('your own');
    // The owner removes an agent's comment; it stays as a tombstone.
    const theirs = (await tickets.comment('personal', 1, as(aether), 'Agent note')).events.at(-1)!.id;
    const removed = await tickets.deleteComment('personal', 1, theirs, owner);
    expect(removed.events.at(-1)).toMatchObject({ kind: 'comment', text: '', deleted: { by: 'Admin' } });
    await expect(tickets.editComment('personal', 1, theirs, owner, 'Back')).rejects.toThrow('deleted');
    await expect(tickets.deleteComment('personal', 1, posted.events[0]!.id, owner)).rejects.toThrow('comment');
  } finally {
    await db.close();
  }
});

it('resolves ticket references and searches only within one organization', async () => {
  const { db, tickets, owner, orgs } = await setup();
  try {
    await tickets.create('personal', owner, { title: 'Back up Keep', description: 'nightly rsync' });
    await tickets.create('personal', owner, { title: 'Rotate logs' });
    const lab = await orgs.create('Lab', 'admin');
    await tickets.updateSettings(lab, { enabled: true });
    await tickets.create(lab, owner, { title: 'Lab only' });
    expect((await tickets.refs('personal', [1, 2, 99])).map(item => [item.key, item.title])).toEqual([
      ['HOME-1', 'Back up Keep'],
      ['HOME-2', 'Rotate logs'],
    ]);
    expect((await tickets.refs(lab, [1, 2])).map(item => item.title)).toEqual(['Lab only']);
    const search = async (query: string) =>
      (await tickets.list('personal', { query })).tickets.map(ticket => ticket.number);
    expect(await search('RSYNC')).toEqual([1]);
    expect(await search('HOME-2')).toEqual([2]);
    expect(await search('2')).toEqual([2]);
  } finally {
    await db.close();
  }
});
