import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { buildApp } from '../app';
import { EndpointStore } from '../endpoint-store';
import { prepareDatabase } from '../test-database';
import { SESSION_COOKIE } from '../auth/sessions';

const PASSWORD = 'correct horse battery';

async function fixture() {
  const root = join(process.env.SQLITE_TEST_ROOT!, crypto.randomUUID());
  const database = await prepareDatabase(`${root}.db`);
  const app = await buildApp({
    database,
    endpointStore: new EndpointStore(`${root}-endpoints.json`),
    computerController: null,
    requireLogin: true,
  });
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { host: '127.0.0.1:19090', origin: 'http://127.0.0.1:19090', cookie },
      ...(payload ? { payload } : {}),
    });
  const cookieOf = (response: Awaited<ReturnType<typeof app.inject>>) =>
    `${SESSION_COOKIE}=${response.cookies.find(found => found.name === SESSION_COOKIE)!.value}`;
  const login = (path: string, name: string) =>
    app.inject({
      method: 'POST',
      url: path,
      headers: { host: '127.0.0.1:19090' },
      payload: { name, password: PASSWORD },
    });
  const admin = cookieOf(await login('/api/auth/setup', 'Admin'));
  const sam = (await call('POST', '/api/users', admin, { name: 'Sam', password: PASSWORD })).json() as {
    organizations: { id: string }[];
  };
  const samCookie = cookieOf(await login('/api/auth/login', 'Sam'));
  return { app, database, call, admin, samCookie, samOrg: sam.organizations[0]!.id };
}

describe('ticket routes', { timeout: 120_000 }, () => {
  it('lets the owner turn tickets on and work the board; other people reach only their own', async () => {
    const { app, database, call, admin, samCookie, samOrg } = await fixture();
    try {
      const base = `/api/organizations/${samOrg}`;
      const bo = await database.createAgent({
        name: 'Bo',
        endpointId: 'm',
        model: 'm',
        thinkingLevel: 'off',
        organizationId: samOrg,
      });
      expect((await call('POST', `${base}/tickets`, samCookie, { title: 'Too early' })).statusCode).toBe(409);
      const enabled = await call('PATCH', base, samCookie, { tickets: { enabled: true, prefix: 'sam' } });
      expect(enabled.statusCode).toBe(200);
      expect(enabled.json().organizations[0].tickets).toMatchObject({
        enabled: true,
        prefix: 'SAM',
        agentsPickUp: false,
      });
      expect((await call('PATCH', base, samCookie, { tickets: { prefix: '1x' } })).statusCode).toBe(400);

      const made = await call('POST', `${base}/tickets`, samCookie, {
        title: 'Clean the cache',
        description: 'Only the Cache folder.',
        assignee: { agentId: bo.id },
        priority: 'medium',
      });
      expect(made.statusCode).toBe(200);
      expect(made.json().ticket).toMatchObject({ key: 'SAM-1', writer: { name: 'Sam', trusted: true } });
      // Bo is woken: its wake-up is saved (it cannot run here, so it waits for the next start).
      expect(await database.client.pendingTimerEvent.count({ where: { agentId: bo.id, kind: 'ticket' } })).toBe(1);

      const desk = await database.client.computer.create({
        data: { name: 'Desk', requestKey: 'k', state: 'running', organizationId: samOrg },
      });
      const moved = await call('PATCH', `${base}/tickets/1`, samCookie, { status: 'progress', linkComputer: desk.id });
      expect(moved.json().ticket).toMatchObject({ status: 'progress', links: [{ kind: 'computer', label: 'Desk' }] });
      const commented = await call('POST', `${base}/tickets/1/comments`, samCookie, { text: '@Bo thanks' });
      expect(commented.json().events.map((event: { kind: string }) => event.kind)).toEqual([
        'created',
        'assignee',
        'woken',
        'status',
        'link',
        'comment',
        'woken',
      ]);
      expect((await call('GET', `${base}/tickets`, samCookie)).json().tickets).toHaveLength(1);

      // Admin may act there too, but is not the owner: their text is untrusted for agents.
      const byAdmin = await call('POST', `${base}/tickets`, admin, { title: 'From admin' });
      expect(byAdmin.json().ticket.writer).toMatchObject({ name: 'Admin', trusted: false });
      // Sam reaches nothing of admin's organization, not even whether a ticket exists.
      await call('PATCH', '/api/organizations/personal', admin, { tickets: { enabled: true } });
      await call('POST', '/api/organizations/personal/tickets', admin, { title: 'Admin only' });
      for (const [method, url] of [
        ['GET', '/api/organizations/personal/tickets'],
        ['GET', '/api/organizations/personal/tickets/1'],
        ['PATCH', '/api/organizations/personal/tickets/1'],
        ['DELETE', '/api/organizations/personal/tickets/1'],
      ] as const)
        expect(
          (await call(method, url, samCookie, method === 'PATCH' ? { status: 'done' } : undefined)).statusCode,
        ).toBe(404);

      expect((await call('DELETE', `${base}/tickets/2`, samCookie)).json()).toEqual({ deleted: true });
      expect((await call('GET', `${base}/tickets/2`, samCookie)).statusCode).toBe(404);
      const audit = await database.client.auditEvent.findMany({
        where: { kind: { startsWith: 'ticket.' } },
        orderBy: { sequence: 'asc' },
      });
      // The refused first create too (tickets were off), and the ticket's number where there is one.
      const rows = audit.map(event => [
        event.kind,
        event.outcome,
        event.targetId,
        JSON.parse(event.detail ?? '{}').ticket,
      ]);
      expect(rows).toEqual([
        ['ticket.create', 'failed', samOrg, undefined],
        ['ticket.create', 'ok', samOrg, 1],
        ['ticket.update', 'ok', samOrg, 1],
        ['ticket.create', 'ok', samOrg, 2],
        ['ticket.create', 'ok', 'personal', 1],
        ['ticket.delete', 'ok', samOrg, 2],
      ]);
    } finally {
      await app.close();
    }
  });
  it('saves a board drag: order within a column and a move to another, through the update route', async () => {
    const { app, database, call, samCookie, samOrg } = await fixture();
    try {
      const base = `/api/organizations/${samOrg}`;
      await call('PATCH', base, samCookie, { tickets: { enabled: true, prefix: 'SAM' } });
      for (const title of ['One', 'Two', 'Three']) await call('POST', `${base}/tickets`, samCookie, { title });
      const board = async () =>
        ((await call('GET', `${base}/tickets`, samCookie)).json().tickets as { number: number; status: string }[]).map(
          ticket => `${ticket.status}:${ticket.number}`,
        );
      expect(await board()).toEqual(['todo:3', 'todo:2', 'todo:1']);
      // Within Todo: One goes between Three and Two.
      expect((await call('PATCH', `${base}/tickets/1`, samCookie, { place: { after: 3, before: 2 } })).statusCode).toBe(
        200,
      );
      expect(await board()).toEqual(['todo:3', 'todo:1', 'todo:2']);
      // To In review, below nothing: a status change with its activity, and the review rule as from the detail.
      const moved = await call('PATCH', `${base}/tickets/2`, samCookie, { status: 'review', place: {} });
      expect(moved.json().events.at(-1)).toMatchObject({ kind: 'status', text: 'moved it Todo → In review' });
      await call('PATCH', `${base}/tickets/3`, samCookie, { status: 'review', place: { after: 2 } });
      expect(await board()).toEqual(['todo:1', 'review:2', 'review:3']);
      expect((await call('PATCH', `${base}/tickets/1`, samCookie, { place: { after: 0 } })).statusCode).toBe(400);
      const audit = await database.client.auditEvent.findMany({ where: { kind: 'ticket.update' } });
      expect(audit.map(event => JSON.parse(event.detail ?? '{}').fields)).toContainEqual(['status', 'place']);
    } finally {
      await app.close();
    }
  });
  it('resolves references, searches, relates, links messages and edits comments only within reach', async () => {
    const { app, database, call, admin, samCookie, samOrg } = await fixture();
    try {
      const base = `/api/organizations/${samOrg}`;
      await call('PATCH', base, samCookie, { tickets: { enabled: true, prefix: 'SAM' } });
      await call('PATCH', '/api/organizations/personal', admin, { tickets: { enabled: true, prefix: 'HOME' } });
      await call('POST', '/api/organizations/personal/tickets', admin, { title: 'Admin only' });
      const agent = (name: string, organizationId: string) =>
        database.createAgent({ name, endpointId: 'm', model: 'm', thinkingLevel: 'off', organizationId });
      const message = async (agentId: string, text: string) => {
        const channel = await database.client.channel.create({ data: { agentId } });
        return database.client.message.create({ data: { channelId: channel.id, role: 'user', text } });
      };
      const [bo, rex] = [await agent('Bo', samOrg), await agent('Rex', 'personal')];
      const asked = await message(bo.id, 'Please rotate the logs on Desk every night');
      const made = await call('POST', `${base}/tickets`, samCookie, {
        title: 'Rotate the logs',
        due: '2026-11-02',
        linkMessage: asked.id,
      });
      expect(made.json().ticket).toMatchObject({
        due: '2026-11-02',
        links: [
          {
            kind: 'message',
            id: asked.id,
            label: 'Please rotate the logs on Desk every night',
            conversation: { kind: 'chat', agentId: bo.id, name: 'Bo' },
          },
        ],
      });
      // Another organization's message is refused.
      const elsewhere = await message(rex.id, 'Not yours');
      expect(
        (await call('POST', `${base}/tickets`, samCookie, { title: 'X', linkMessage: elsewhere.id })).statusCode,
      ).toBe(400);
      await call('POST', `${base}/tickets`, samCookie, { title: 'Clean the cache', parent: 1 });
      const related = await call('PATCH', `${base}/tickets/2`, samCookie, {
        addRelations: [{ kind: 'blocks', number: 1 }],
      });
      expect(related.json().relations).toEqual([
        { kind: 'blocks', number: 1, key: 'SAM-1', title: 'Rotate the logs', status: 'todo' },
      ]);
      const board = (await call('GET', `${base}/tickets`, samCookie)).json().tickets;
      expect(board.find((ticket: { number: number }) => ticket.number === 1)).toMatchObject({
        blocked: true,
        subIssues: { done: 0, total: 1 },
      });
      expect((await call('GET', `${base}/tickets?q=SAM-2`, samCookie)).json().tickets).toHaveLength(1);

      // References: only the organization named, and only for someone who reaches it.
      expect((await call('GET', `${base}/ticket-refs?numbers=1,2,9`, samCookie)).json().tickets).toEqual([
        { number: 1, key: 'SAM-1', title: 'Rotate the logs', status: 'todo' },
        { number: 2, key: 'SAM-2', title: 'Clean the cache', status: 'todo' },
      ]);
      expect((await call('GET', '/api/organizations/personal/ticket-refs?numbers=1', samCookie)).statusCode).toBe(404);
      expect((await call('GET', `${base}/ticket-refs?numbers=x`, samCookie)).statusCode).toBe(400);

      // Comments: one's own to edit; deleting, one's own or (the owner) anyone's.
      const own = (await call('POST', `${base}/tickets/1/comments`, samCookie, { text: 'Started' }))
        .json()
        .events.at(-1);
      const theirs = (await call('POST', `${base}/tickets/1/comments`, admin, { text: 'From admin' }))
        .json()
        .events.at(-1);
      const url = (id: string) => `${base}/tickets/1/comments/${id}`;
      expect((await call('PATCH', url(own.id), admin, { text: 'Taken over' })).statusCode).toBe(403);
      expect((await call('DELETE', url(own.id), admin)).statusCode).toBe(403);
      expect(
        (await call('PATCH', url(own.id), samCookie, { text: 'Started on Desk' })).json().events.at(-2),
      ).toMatchObject({
        text: 'Started on Desk',
        editedAt: expect.any(String),
      });
      expect((await call('DELETE', url(theirs.id), samCookie)).json().events.at(-1)).toMatchObject({
        text: '',
        deleted: { by: 'Sam' },
      });
      expect(
        (await call('PATCH', `/api/organizations/personal/tickets/1/comments/${own.id}`, samCookie, { text: 'x' }))
          .statusCode,
      ).toBe(404);
      const audit = await database.client.auditEvent.findMany({ where: { kind: 'ticket.update', targetId: samOrg } });
      expect(audit.map(event => JSON.parse(event.detail ?? '{}').fields)).toContainEqual(['addRelations']);
    } finally {
      await app.close();
    }
  });
});
