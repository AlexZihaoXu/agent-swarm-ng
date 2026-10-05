import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildApp } from '../app';
import { EndpointStore } from '../endpoint-store';
import { prepareDatabase } from '../test-database';
import { SESSION_COOKIE } from '../auth/sessions';
import { MODEL_RETRY } from '../chat-runtime';
import type { PushRequest } from './sender';
import { subscriber } from './push-test-helpers';
import { lookOf } from './routes';

const PASSWORD = 'correct horse battery';
const FCM = 'https://fcm.googleapis.com/fcm/send/';
// A 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

MODEL_RETRY.baseDelayMs = 5;
MODEL_RETRY.maxRetries = 0;

/** Push requests the app made, decrypted with the device's keys. */
function capture() {
  const sent: PushRequest[] = [];
  return { sent, transport: async (request: PushRequest) => (sent.push(request), 201) };
}

async function fixture() {
  // Its own data folder (the VAPID keys live beside the database).
  const root = join(process.env.SQLITE_TEST_ROOT!, crypto.randomUUID(), 'platform');
  await mkdir(dirname(root), { recursive: true });
  const database = await prepareDatabase(`${root}.db`);
  const { sent, transport } = capture();
  const app = await buildApp({
    database,
    endpointStore: new EndpointStore(`${root}-endpoints.json`),
    computerController: null,
    requireLogin: true,
    pushTransport: transport,
  });
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, cookie?: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: {
        host: '127.0.0.1:19090',
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
        ...(cookie ? { cookie } : {}),
      },
      ...(payload ? { payload } : {}),
    });
  const cookieOf = (response: Awaited<ReturnType<typeof call>>) =>
    `${SESSION_COOKIE}=${response.cookies.find(found => found.name === SESSION_COOKIE)!.value}`;
  const admin = cookieOf(await call('POST', '/api/auth/setup', undefined, { name: 'Admin', password: PASSWORD }));
  const sam = (await call('POST', '/api/users', admin, { name: 'Sam', password: PASSWORD })).json() as {
    id: string;
    organizations: { id: string }[];
  };
  const samCookie = cookieOf(await call('POST', '/api/auth/login', undefined, { name: 'Sam', password: PASSWORD }));
  return { app, database, call, admin, sam, samCookie, sent };
}

describe('push routes', { timeout: 120_000 }, () => {
  it('keeps each person to their own devices and preferences', async () => {
    const { app, database, call, admin, sam, samCookie, sent } = await fixture();
    try {
      expect(app.unruledRoutes).toEqual([]);
      const key = (await call('GET', '/api/push/key', samCookie)).json();
      expect(Buffer.from(key.publicKey, 'base64url')).toHaveLength(65);
      expect(JSON.stringify(key)).not.toMatch(/private/i);
      expect((await call('GET', '/api/push/key')).statusCode).toBe(401);

      const phone = subscriber();
      const subscription = (endpoint: string, keys = phone) => ({
        endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        expirationTime: null,
      });
      const added = await call('POST', '/api/push/subscriptions', samCookie, subscription(`${FCM}sam-phone`));
      expect(added.statusCode).toBe(200);
      expect(added.json()).toMatchObject({ label: 'Chrome on Linux', paused: false, lastSuccessAt: null });
      expect(JSON.stringify(added.json())).not.toContain('sam-phone');
      // Only push services: the backend never posts anywhere else.
      for (const endpoint of ['http://127.0.0.1:3000/api/agents', 'https://10.0.0.1/x', 'https://example.org/push'])
        expect((await call('POST', '/api/push/subscriptions', samCookie, subscription(endpoint))).statusCode).toBe(400);
      const adminDevice = (
        await call('POST', '/api/push/subscriptions', admin, subscription(`${FCM}admin-desk`, subscriber()))
      ).json();

      // Each sees only their own; nobody removes another person's.
      expect((await call('GET', '/api/push/subscriptions', samCookie)).json().devices).toHaveLength(1);
      expect((await call('GET', '/api/push/subscriptions', admin)).json().devices).toEqual([adminDevice]);
      expect((await call('DELETE', `/api/push/subscriptions/${adminDevice.id}`, samCookie)).statusCode).toBe(404);
      expect((await call('GET', '/api/push/subscriptions', admin)).json().devices).toHaveLength(1);

      // Preferences: all on by default, per person.
      expect((await call('GET', '/api/push/preferences', samCookie)).json()).toEqual({
        agentMessages: true,
        groupChats: true,
        agentProblems: true,
        critical: true,
        preview: true,
        swarmUpdates: true,
        swarmStarts: true,
        swarmStops: true,
      });
      expect(
        (await call('PATCH', '/api/push/preferences', samCookie, { preview: false, groupChats: false })).json(),
      ).toMatchObject({ preview: false, groupChats: false, agentMessages: true });
      expect((await call('GET', '/api/push/preferences', admin)).json().preview).toBe(true);
      expect((await call('PATCH', '/api/push/preferences', samCookie, { surprise: true })).json()).not.toHaveProperty(
        'surprise',
      );

      // A test goes to Sam's devices only, now, and is readable only by that device.
      expect((await call('POST', '/api/push/test', samCookie)).json()).toEqual({ delivered: 1, failed: 0, expired: 0 });
      expect((await call('POST', '/api/push/test', samCookie)).statusCode).toBe(429);
      expect(sent.map(request => request.endpoint)).toEqual([`${FCM}sam-phone`]);
      expect(JSON.parse(phone.decrypt(sent[0]!.body!))).toMatchObject({ title: 'Agent Swarm', tag: 'test' });

      expect((await call('POST', '/api/push/presence', samCookie, { tabId: 'tab-1', active: true })).statusCode).toBe(
        204,
      );
      const own = (await call('GET', '/api/push/subscriptions', samCookie)).json().devices[0];
      expect(own.lastSuccessAt).toBeTruthy();
      // A visit to Settings saves it again; once removed, a refresh does not bring it back.
      const refresh = { ...subscription(`${FCM}sam-phone`), refresh: true };
      expect((await call('POST', '/api/push/subscriptions', samCookie, refresh)).json().id).toBe(own.id);
      expect((await call('DELETE', `/api/push/subscriptions/${own.id}`, samCookie)).json()).toEqual({ ok: true });
      expect((await call('GET', '/api/push/subscriptions', samCookie)).json().devices).toEqual([]);
      expect((await call('POST', '/api/push/subscriptions', samCookie, refresh)).statusCode).toBe(404);
      expect((await call('GET', '/api/push/subscriptions', samCookie)).json().devices).toEqual([]);

      // Signing out ends the device's pushes with the session.
      await call('POST', '/api/push/subscriptions', samCookie, subscription(`${FCM}sam-phone`));
      await call('POST', '/api/auth/logout', samCookie);
      expect(await database.client.pushSubscription.count({ where: { userId: sam.id } })).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('answers 503 without details when the key file is broken', async () => {
    const { app, database, call, samCookie } = await fixture();
    try {
      await mkdir(join(database.dataDirectory, 'push'), { recursive: true, mode: 0o700 });
      await writeFile(join(database.dataDirectory, 'push', 'vapid.json'), 'SECRETKEYMATERIAL', { mode: 0o600 });
      const response = await call('GET', '/api/push/key', samCookie);
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        message: 'Notifications are unavailable: the server has no usable push keys.',
      });
    } finally {
      await app.close();
    }
  });

  it('stores agents’ avatar PNGs behind agent access and lists the ones to draw', async () => {
    const { app, database, call, admin, sam, samCookie } = await fixture();
    try {
      const mine = await database.createAgent({
        name: 'Bo',
        endpointId: 'x',
        model: 'm',
        thinkingLevel: 'off',
        organizationId: sam.organizations[0]!.id,
      });
      const admins = await database.createAgent({ name: 'Ada', endpointId: 'x', model: 'm', thinkingLevel: 'off' });
      const put = (id: string, cookie: string, body: Buffer, type = 'image/png', look = lookOf(null)) =>
        app.inject({
          method: 'PUT',
          url: `/api/agents/${id}/avatar.png?look=${look}`,
          headers: { host: '127.0.0.1:19090', cookie, 'content-type': type, origin: 'http://127.0.0.1:19090' },
          payload: body,
        });
      expect((await call('GET', '/api/push/avatars', samCookie)).json()).toEqual({
        stale: [{ id: mine.id, avatar: null, look: lookOf(null) }],
      });
      expect((await call('GET', `/api/agents/${mine.id}/avatar.png`, samCookie)).statusCode).toBe(404);
      // Drawn from another look than the agent's current one: not stored.
      expect((await put(mine.id, samCookie, PNG, 'image/png', lookOf('{"old":1}'))).statusCode).toBe(409);
      expect((await put(mine.id, samCookie, Buffer.from('<svg/>'))).statusCode).toBe(400);
      expect((await put(mine.id, samCookie, Buffer.from('<svg/>'), 'image/svg+xml')).statusCode).toBe(415);
      expect((await put(mine.id, samCookie, Buffer.alloc(70 * 1024))).statusCode).toBe(413);
      expect((await put(mine.id, samCookie, PNG)).json()).toEqual({ ok: true });
      const got = await call('GET', `/api/agents/${mine.id}/avatar.png`, samCookie);
      expect(got.headers['content-type']).toBe('image/png');
      expect(got.rawPayload.equals(PNG)).toBe(true);
      expect((await call('GET', '/api/push/avatars', samCookie)).json()).toEqual({ stale: [] });
      // Another organization's agent: not reachable either way.
      expect((await put(admins.id, samCookie, PNG)).statusCode).toBe(404);
      expect((await call('GET', `/api/agents/${admins.id}/avatar.png`, samCookie)).statusCode).toBe(404);
      expect(
        (await call('GET', '/api/push/avatars', admin)).json().stale.map((item: { id: string }) => item.id),
      ).toEqual([admins.id]);
      // A new look makes it stale again; deleting the agent deletes its image.
      const bean = '{"shape":"bean","color":"#38bdf8","seed":1}';
      await database.client.agent.update({ where: { id: mine.id }, data: { avatar: bean } });
      expect((await call('GET', '/api/push/avatars', samCookie)).json()).toEqual({
        stale: [{ id: mine.id, avatar: JSON.parse(bean), look: lookOf(bean) }],
      });
      await database.client.agent.delete({ where: { id: mine.id } });
      expect(await database.client.agentAvatarImage.count()).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('notifies admin of a lockdown and a failed sign-in burst', async () => {
    const { app, call, admin, sent } = await fixture();
    try {
      const desk = subscriber();
      await call('POST', '/api/push/subscriptions', admin, {
        endpoint: `${FCM}admin`,
        keys: { p256dh: desk.p256dh, auth: desk.auth },
      });
      await call('PATCH', '/api/settings/swarm', admin, { lockdownFailures: 6 });
      for (let i = 0; i < 6; i++)
        await call('POST', '/api/auth/login', undefined, { name: 'Admin', password: `wrong password ${i}` });
      await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(2), { timeout: 5000 });
      const payloads = sent.map(request => JSON.parse(desk.decrypt(request.body!)));
      expect(payloads.map(payload => payload.tag).sort()).toEqual(['alert:lockdown', 'alert:signin-failures']);
      expect(payloads.find(payload => payload.tag === 'alert:lockdown')).toMatchObject({
        title: 'Sign-in is locked down',
        url: '/settings/audit?category=signin',
      });
    } finally {
      await app.close();
    }
  });
});

// A real chat turn: the mock model publishes with send_message (or fails), and the owner's device gets the push.
let model: Server;
let modelUrl = '';
let failModel = false;
beforeAll(async () => {
  model = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (failModel) return void response.writeHead(500).end('provider down');
    const system = body.messages.find((message: { role: string }) => message.role === 'system')?.content;
    const channelId = (typeof system === 'string' ? system : '').match(/channel is ([\w-]+)\./)?.[1];
    const replied = body.messages.some((message: { role: string }) => message.role === 'tool');
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta: object, finish: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({ id: 't', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
      );
    if (replied) chunk({ role: 'assistant', content: '' }, 'stop');
    else {
      const args = JSON.stringify({ channelId, text: 'The **report** is ready.', final: true });
      chunk({
        role: 'assistant',
        tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'send_message', arguments: args } }],
      });
      chunk({}, 'tool_calls');
    }
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve));
  modelUrl = `http://127.0.0.1:${(model.address() as { port: number }).port}/v1`;
});
afterAll(() => new Promise<void>(resolve => model.close(() => resolve())));

describe('push triggers from real runs', { timeout: 120_000 }, () => {
  async function chatFixture() {
    const root = join(process.env.SQLITE_TEST_ROOT!, crypto.randomUUID());
    const database = await prepareDatabase(`${root}.db`);
    const endpointStore = new EndpointStore(`${root}-endpoints.json`);
    await endpointStore.save({ id: 'endpoint', name: 'Mock', baseUrl: modelUrl, apiKey: 'test' });
    const { sent, transport } = capture();
    const app = await buildApp({ database, endpointStore, requireLogin: false, pushTransport: transport });
    const device = subscriber();
    await app.inject({
      method: 'POST',
      url: '/api/push/subscriptions',
      payload: { endpoint: `${FCM}admin`, keys: { p256dh: device.p256dh, auth: device.auth } },
    });
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/api/agents',
        payload: { name: 'Aether', endpointId: 'endpoint', model: 'test-model', thinkingLevel: 'off' },
      })
    ).json();
    const chat = () =>
      app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: { prefer: 'respond-async' },
        payload: { agentId: agent.id, clientMessageId: crypto.randomUUID(), message: 'Report please' },
      });
    const payloads = () => sent.map(request => JSON.parse(device.decrypt(request.body!)));
    return { app, agent, chat, payloads };
  }

  it('pushes an agent’s published reply to its owner', async () => {
    failModel = false;
    const { app, agent, chat, payloads } = await chatFixture();
    try {
      await chat();
      await vi.waitFor(() => expect(payloads()).toHaveLength(1), { timeout: 15_000 });
      expect(payloads()[0]).toMatchObject({
        title: 'Aether',
        body: 'The report is ready.',
        tag: `agent:${agent.id}`,
        url: `/chat/agents/${agent.id}`,
        icon: `/api/agents/${agent.id}/avatar.png`,
      });
    } finally {
      await app.close();
    }
  });

  it('pushes “couldn’t finish” when the run fails before replying', async () => {
    failModel = true;
    const { app, agent, chat, payloads } = await chatFixture();
    try {
      await chat();
      await vi.waitFor(() => expect(payloads()).toHaveLength(1), { timeout: 15_000 });
      expect(payloads()[0]).toMatchObject({ title: 'Aether couldn’t finish', tag: `stuck:${agent.id}` });
      expect(payloads()[0].body).toMatch(/model/i);
    } finally {
      failModel = false;
      await app.close();
    }
  });
});
