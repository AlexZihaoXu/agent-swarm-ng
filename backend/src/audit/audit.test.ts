import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { buildApp } from '../app';
import { prepareDatabase } from '../test-database';
import { EndpointStore } from '../endpoint-store';
import { SESSION_COOKIE } from '../auth/sessions';

async function fixture() {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const endpoints = new EndpointStore(join(await mkdtemp(join(process.env.SQLITE_TEST_ROOT!, 'ep-')), 'e.json'));
  await endpoints.save({ id: 'endpoint', name: 'Mock', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'test-key' });
  const app = await buildApp({ database, computerController: null, endpointStore: endpoints, requireLogin: true });
  let cookie = '';
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, ip = '203.0.113.7') =>
    app.inject({
      method,
      url,
      headers: { host: '127.0.0.1:19090', 'x-real-ip': ip, ...(cookie ? { cookie } : {}) },
      ...(payload ? { payload } : {}),
    });
  const setup = await call('POST', '/api/auth/setup', { name: 'Admin', password: 'correct horse battery' });
  cookie = `${SESSION_COOKIE}=${setup.cookies.find(found => found.name === SESSION_COOKIE)!.value}`;
  const events = async (category?: string) =>
    (await call('GET', `/api/audit${category ? `?category=${category}` : ''}`)).json().events as Record<string, any>[];
  return { app, database, call, events, signOut: () => (cookie = '') };
}

describe('audit log', { timeout: 60_000 }, () => {
  it('records sign-in attempts with the name given, the address and the millisecond, ok or not', async () => {
    const { app, call, signOut } = await fixture();
    try {
      signOut();
      await call('POST', '/api/auth/login', { name: 'admin', password: 'wrong password!' }, '198.51.100.4');
      await call('POST', '/api/auth/login', { name: 'Mallory', password: 'guess guess' }, '198.51.100.9');
      const ok = await call(
        'POST',
        '/api/auth/login',
        { name: 'Admin', password: 'correct horse battery' },
        '198.51.100.4',
      );
      expect(ok.statusCode).toBe(200);
      const cookie = `${SESSION_COOKIE}=${ok.cookies.find(found => found.name === SESSION_COOKIE)!.value}`;
      const list = await app.inject({
        method: 'GET',
        url: '/api/audit?category=signin',
        headers: { host: '127.0.0.1:19090', cookie },
      });
      const signins = list.json().events as Record<string, any>[];
      expect(
        signins.map(event => [event.kind, event.outcome, event.actor, event.ip, event.detail?.reason ?? null]),
      ).toEqual([
        ['auth.login', 'ok', 'Admin', '198.51.100.4', null],
        ['auth.login', 'failed', 'Mallory', '198.51.100.9', 'wrong name or password'],
        ['auth.login', 'failed', 'admin', '198.51.100.4', 'wrong name or password'],
        ['auth.setup', 'ok', 'Admin', '203.0.113.7', null],
      ]);
      // Millisecond timestamps, newest first.
      expect(signins[0]!.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
      expect(Date.parse(signins[0]!.at)).toBeGreaterThanOrEqual(Date.parse(signins[1]!.at));
    } finally {
      await app.close();
    }
  });

  it('records organizations and agents being created, edited and deleted, with names and changed fields only', async () => {
    const { app, call, events } = await fixture();
    try {
      expect((await call('POST', '/api/organizations', { name: 'Lab' })).statusCode).toBe(200);
      const org = (await call('GET', '/api/organizations')).json().organizations.find((o: any) => o.name === 'Lab');
      await call('PATCH', `/api/organizations/${org.id}`, { name: 'Lab 2' });
      const agent = (
        await call('POST', '/api/agents', {
          name: 'Ada',
          endpointId: 'endpoint',
          model: 'test-model',
          thinkingLevel: 'off',
        })
      ).json();
      await call('PATCH', `/api/agents/${agent.id}`, { name: 'Ada Lovelace', instructions: 'secret plans' });
      // A move preview changes nothing; applying it does.
      await call('POST', `/api/organizations/${org.id}/move`, { kind: 'agent', id: agent.id, apply: false });
      await call('POST', `/api/organizations/${org.id}/move`, { kind: 'agent', id: agent.id, apply: true });
      await call('DELETE', `/api/agents/${agent.id}`, { confirmation: 'Ada Lovelace' });
      await call('DELETE', `/api/organizations/${org.id}`);
      const seen = (await events())
        .filter(event => !event.kind.startsWith('auth.'))
        .reverse()
        .map(event => [event.kind, event.outcome, event.actor, event.targetName, event.detail]);
      expect(seen).toEqual([
        ['organization.create', 'ok', 'Admin', 'Lab', {}],
        ['organization.update', 'ok', 'Admin', 'Lab', { fields: ['name'] }],
        ['agent.create', 'ok', 'Admin', 'Ada', {}],
        [
          'agent.update',
          'ok',
          'Admin',
          'Ada',
          { section: 'agent', fields: ['name', 'instructions'], newName: 'Ada Lovelace' },
        ],
        ['organization.move', 'ok', 'Admin', 'Lab 2', { fields: ['kind', 'id', 'apply'], moved: `agent ${agent.id}` }],
        ['agent.delete', 'ok', 'Admin', 'Ada Lovelace', {}],
        ['organization.delete', 'ok', 'Admin', 'Lab 2', {}],
      ]);
      // Values are never logged.
      expect(JSON.stringify(await events())).not.toContain('secret plans');
    } finally {
      await app.close();
    }
  });

  it('pages and filters, and records the platform starting', async () => {
    const { app, call } = await fixture();
    try {
      await app.audit.record({ kind: 'system.start', outcome: 'ok', actor: 'system' });
      for (let i = 0; i < 5; i++) await call('POST', '/api/organizations', { name: `Org ${i}` });
      const first = (await call('GET', '/api/audit?category=organizations&limit=3')).json();
      expect(first.events.map((event: any) => event.targetName)).toEqual(['Org 4', 'Org 3', 'Org 2']);
      const second = (await call('GET', `/api/audit?category=organizations&limit=3&before=${first.next}`)).json();
      expect(second.events.map((event: any) => event.targetName)).toEqual(['Org 1', 'Org 0']);
      expect(second.next).toBeNull();
      const system = (await call('GET', '/api/audit?category=system')).json().events;
      expect(system.map((event: any) => event.kind)).toEqual(['system.start']);
      // Signed out, the log is closed like everything else.
      expect(
        (await app.inject({ method: 'GET', url: '/api/audit', headers: { host: '127.0.0.1:19090' } })).statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });
});
