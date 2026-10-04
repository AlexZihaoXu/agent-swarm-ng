import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { buildApp } from '../app';
import { EndpointStore } from '../endpoint-store';
import { prepareDatabase } from '../test-database';
import { SESSION_COOKIE } from '../auth/sessions';
import { checkMemoryCap } from './store';

const PASSWORD = 'correct horse battery';

async function fixture() {
  const root = join(process.env.SQLITE_TEST_ROOT!, crypto.randomUUID());
  const database = await prepareDatabase(`${root}.db`);
  const endpointStore = new EndpointStore(`${root}-endpoints.json`);
  const app = await buildApp({ database, endpointStore, computerController: null, requireLogin: true });
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, cookie?: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { host: '127.0.0.1:19090', ...(cookie ? { cookie } : {}) },
      ...(payload ? { payload } : {}),
    });
  const cookieOf = (response: Awaited<ReturnType<typeof call>>) =>
    `${SESSION_COOKIE}=${response.cookies.find(found => found.name === SESSION_COOKIE)!.value}`;
  const admin = cookieOf(await call('POST', '/api/auth/setup', undefined, { name: 'Admin', password: PASSWORD }));
  const created = await call('POST', '/api/users', admin, { name: 'Sam', password: PASSWORD, memoryLimitGiB: 4 });
  expect(created.statusCode).toBe(200);
  const sam = created.json() as { id: string; organizations: { id: string; name: string }[] };
  const samCookie = cookieOf(await call('POST', '/api/auth/login', undefined, { name: 'Sam', password: PASSWORD }));
  const samOrg = sam.organizations[0]!.id;
  const agent = (name: string, organizationId: string) =>
    database.createAgent({ name, endpointId: 'mine', model: 'test', thinkingLevel: 'off', organizationId });
  const computer = (name: string, organizationId: string, memoryGiB: number) =>
    database.client.computer.create({
      data: { name, requestKey: crypto.randomUUID(), organizationId, memoryGiB, state: 'running' },
    });
  return { app, database, endpointStore, call, admin, sam, samCookie, samOrg, agent, computer };
}

describe('users', { timeout: 120_000 }, () => {
  it('gives every route a rule', async () => {
    const { app } = await fixture();
    try {
      expect(app.unruledRoutes).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('keeps a user inside their own organizations and admin everywhere', async () => {
    const { app, database, call, admin, sam, samCookie, samOrg, agent, computer } = await fixture();
    try {
      expect(sam.organizations.map(org => org.name)).toEqual(["Sam's Organization"]);
      const ada = await agent('Ada', 'personal');
      const bo = await agent('Bo', samOrg);
      const desk = await computer('Desk', 'personal', 2);
      const rig = await computer('Rig', samOrg, 1);

      // Lists show only Sam's.
      expect((await call('GET', '/api/agents', samCookie)).json().agents.map((a: any) => a.name)).toEqual(['Bo']);
      expect((await call('GET', '/api/agents', admin)).json().agents.map((a: any) => a.name)).toEqual(['Ada', 'Bo']);
      expect((await call('GET', '/api/organizations', samCookie)).json().organizations).toMatchObject([
        { id: samOrg, ownerId: sam.id, ownerName: 'Sam' },
      ]);
      expect((await call('GET', '/api/organizations', admin)).json().organizations).toHaveLength(2);

      // Anything of another organization is as if it did not exist.
      for (const url of [
        `/api/agents/${ada.id}/activity`,
        `/api/agents/${ada.id}/settings`,
        `/api/channels/${ada.channels[0].id}/messages`,
        `/api/computers/${desk.id}/storage`,
        `/api/dashboard?organization=personal`,
      ])
        expect((await call('GET', url, samCookie)).statusCode, url).toBe(404);
      expect((await call('GET', `/api/agents/${bo.id}/settings`, samCookie)).statusCode).toBe(200);
      expect((await call('GET', `/api/agents/${ada.id}/settings`, admin)).statusCode).toBe(200);
      expect(
        (await call('POST', `/api/organizations/personal/move`, samCookie, { kind: 'agent', id: bo.id, apply: false }))
          .statusCode,
      ).toBe(404);

      // Admin only.
      for (const url of ['/api/users', '/api/settings/swarm', '/api/audit', '/api/security', '/api/alerts'])
        expect((await call('GET', url, samCookie)).statusCode, url).toBe(403);

      // Desktops: Caddy's check names the computer.
      const check = (computerId: string, cookie: string) =>
        app.inject({
          method: 'GET',
          url: '/api/auth/check',
          headers: { host: '127.0.0.1:19090', cookie, 'x-computer-id': computerId },
        });
      expect((await check(desk.id, samCookie)).statusCode).toBe(404);
      expect((await check(rig.id, samCookie)).statusCode).toBe(204);
      expect((await check(desk.id, admin)).statusCode).toBe(204);
      // Without a computer named (a path Caddy cleaned differently), a user is refused.
      const unnamed = await app.inject({
        method: 'GET',
        url: '/api/auth/check',
        headers: { host: '127.0.0.1:19090', cookie: samCookie, 'x-forwarded-uri': `//computers/${desk.id}/desktop/` },
      });
      expect(unnamed.statusCode).toBe(404);

      // Terminal streams (WebSockets) follow the same rule: refused before the upgrade.
      const refused = await app
        .injectWS(`/api/computers/${desk.id}/terminals/main/stream`, {
          headers: { host: '127.0.0.1:19090', origin: 'http://127.0.0.1:19090', cookie: samCookie },
        })
        .then(
          socket => (socket.terminate(), 'opened'),
          (error: Error) => error.message,
        );
      expect(refused).toMatch(/404/);

      // A computer moving into Sam's organization counts against Sam's 4 GiB (1 GiB used).
      const big = await computer('Big', 'personal', 4);
      expect(
        (await call('POST', `/api/organizations/${samOrg}/move`, admin, { kind: 'computer', id: big.id, apply: true }))
          .statusCode,
      ).toBe(409);
      expect(await checkMemoryCap(database, samOrg, 3)).toBeNull();
      expect(await checkMemoryCap(database, samOrg, 4)).toContain('4 GiB');
      expect(await checkMemoryCap(database, samOrg, 4, rig.id)).toBeNull();

      // An agent moved to another owner leaves its old owner's endpoint behind; a ChatGPT choice stays.
      await database.client.agent.update({ where: { id: ada.id }, data: { endpointId: 'home' } });
      expect(
        (await call('POST', `/api/organizations/${samOrg}/move`, admin, { kind: 'agent', id: ada.id, apply: true }))
          .statusCode,
      ).toBe(200);
      expect((await database.client.agent.findUniqueOrThrow({ where: { id: ada.id } })).endpointId).toBe('');

      // Discord: another person's owner account and another organization's agent bots are people to Sam's agents.
      await database.client.discordAccount.createMany({
        data: [
          { discordUserId: '111111111111111111', role: 'owner', userId: 'admin', name: 'Admin on Discord' },
          { discordUserId: '222222222222222222', role: 'agent', agentId: ada.id, name: 'ada-bot' },
          {
            discordUserId: '333333333333333333',
            role: 'agent',
            agentId: (await agent('Cy', 'personal')).id,
            name: 'cy-bot',
          },
        ],
      });
      const { DiscordStore } = await import('../discord/store');
      const discord = new DiscordStore(database);
      expect(await discord.who('111111111111111111', bo.id)).toBeNull();
      expect(await discord.who('222222222222222222', bo.id)).toMatchObject({ role: 'agent' });
      expect(await discord.who('333333333333333333', bo.id)).toBeNull();

      // Sam keeps at least one organization.
      expect((await call('DELETE', `/api/organizations/${samOrg}`, samCookie)).statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });

  it("streams a user only their own organizations' events", async () => {
    const { app, database, admin, samCookie, samOrg, agent } = await fixture();
    try {
      const base = await app.listen({ port: 0, host: '127.0.0.1' });
      const ada = await agent('Ada', 'personal');
      const bo = await agent('Bo', samOrg);
      const said = async (channelId: string) => (await database.appendMessage(channelId, 'assistant', 'Hi')).id;
      const [adaMessage, boMessage] = [await said(ada.channels[0].id), await said(bo.channels[0].id)];
      const stream = await fetch(`${base}/api/events`, { headers: { cookie: samCookie } });
      const reader = stream.body!.getReader();
      const decoder = new TextDecoder();
      let text = '';
      const until = async (found: (text: string) => boolean) => {
        while (!found(text)) text += decoder.decode((await reader.read()).value, { stream: true });
      };
      await until(text => text.includes('"snapshot"'));
      const react = (channelId: string, messageId: string) =>
        fetch(`${base}/api/chats/${channelId}/messages/${messageId}/reaction`, {
          method: 'PUT',
          headers: { cookie: admin, 'content-type': 'application/json', origin: base },
          body: JSON.stringify({ emoji: '👍', active: true }),
        });
      expect((await react(ada.channels[0].id, adaMessage)).status).toBe(200);
      expect((await react(bo.channels[0].id, boMessage)).status).toBe(200);
      await until(text => text.includes(boMessage));
      expect(text).not.toContain(adaMessage);
      await reader.cancel();
    } finally {
      await app.close();
    }
  });

  it('keeps model connections and Discord accounts per person', async () => {
    const { app, call, admin, samCookie, endpointStore } = await fixture();
    try {
      const save = (cookie: string, id: string, baseUrl: string) =>
        call('POST', '/api/model-endpoints', cookie, { id, name: id, baseUrl, apiKey: 'secret' });
      expect((await save(admin, 'home', 'http://192.168.1.5:8080/v1')).statusCode).toBe(200);
      // A user's endpoint must be public: not the platform's services or private networks.
      for (const url of ['http://computer-controller:3101', 'http://127.0.0.1:3000', 'http://10.0.0.5/v1'])
        expect((await save(samCookie, 'inside', url)).statusCode, url).toBe(400);
      expect((await save(samCookie, 'home', 'https://203.0.113.5/v1')).statusCode).toBe(200);
      // The same id is each person's own.
      expect((await call('GET', '/api/model-endpoints', samCookie)).json()).toMatchObject([
        { id: 'home', baseUrl: 'https://203.0.113.5/v1' },
      ]);
      expect((await call('GET', '/api/model-endpoints', admin)).json()).toMatchObject([
        { id: 'home', baseUrl: 'http://192.168.1.5:8080/v1' },
      ]);
      expect((await endpointStore.read()).map(row => row.ownerId).sort()).toHaveLength(2);

      expect(
        (await call('PUT', '/api/discord/owner', samCookie, { accounts: [{ id: '111111111111111111', name: 'Sam' }] }))
          .statusCode,
      ).toBe(200);
      expect((await call('GET', '/api/discord/owner', admin)).json().accounts).toEqual([]);
      // Admin takes back an account a user claimed; a user cannot take admin's.
      expect(
        (await call('PUT', '/api/discord/owner', admin, { accounts: [{ id: '111111111111111111', name: 'Me' }] }))
          .statusCode,
      ).toBe(200);
      expect((await call('GET', '/api/discord/owner', samCookie)).json().accounts).toEqual([]);
      expect(
        (await call('PUT', '/api/discord/owner', samCookie, { accounts: [{ id: '111111111111111111', name: 'Sam' }] }))
          .statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('tells an agent when admin, not its owner, writes in its chat', async () => {
    const { app, database, samOrg, agent } = await fixture();
    try {
      const bo = await agent('Bo', samOrg);
      const channel = bo.channels[0].id;
      const owner = await database.client.user.findUniqueOrThrow({ where: { name: 'Sam' } });
      await database.appendMessage(channel, 'user', 'From Sam', undefined, undefined, {
        userId: owner.id,
        name: 'Sam',
      });
      await database.appendMessage(channel, 'user', 'From admin', undefined, undefined, {
        userId: 'admin',
        name: 'Admin',
      });
      const context = await database.context(channel);
      expect(context.map(message => [message.text, 'writer' in message ? message.writer : undefined])).toEqual([
        ['From Sam', undefined],
        ['From admin', 'Admin'],
      ]);
    } finally {
      await app.close();
    }
  });

  it('disables and deletes users: signed out, refused, their organizations handed to admin', async () => {
    const { app, database, call, admin, sam, samCookie, samOrg } = await fixture();
    try {
      expect((await call('PATCH', `/api/users/${sam.id}`, admin, { disabled: true })).json()).toMatchObject({
        disabled: true,
      });
      expect((await call('GET', '/api/auth/session', samCookie)).json()).toMatchObject({ signedIn: false });
      expect((await call('POST', '/api/auth/login', undefined, { name: 'Sam', password: PASSWORD })).statusCode).toBe(
        401,
      );
      expect((await call('PATCH', `/api/users/admin`, admin, { disabled: true })).statusCode).toBe(403);
      expect((await call('DELETE', `/api/users/${sam.id}`, admin)).statusCode).toBe(200);
      expect((await database.client.organization.findUniqueOrThrow({ where: { id: samOrg } })).ownerId).toBe('admin');
      // The refused attempt on admin is logged too, as failed.
      const events = (await call('GET', '/api/audit?category=users', admin)).json().events;
      expect(events.map((e: any) => [e.kind, e.outcome])).toEqual([
        ['user.delete', 'ok'],
        ['user.update', 'failed'],
        ['user.update', 'ok'],
        ['user.create', 'ok'],
      ]);
      expect(JSON.stringify(events)).not.toContain(PASSWORD);
    } finally {
      await app.close();
    }
  });
});
