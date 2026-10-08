import { describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareDatabase } from '../test-database';
import { Reach } from '../users/reach';
import { AgentRuns, type RunEvent } from '../agent-runs';
import { plainText } from './preview';
import { DEFAULT_SUBJECT, loadVapidKeys, vapidSubject } from './vapid';
import { deviceLabel, isPushEndpoint, MAX_DEVICES, MAX_FAILURES, PushStore } from './store';
import { encodePayload, fetchTransport, PAYLOAD_LIMIT, PushSender, SEND_CONCURRENCY } from './sender';
import { Presence, PRESENCE_MS } from './presence';
import { PushNotifier } from './notifier';
import { fakePushService, subscriber, verifyVapid } from './push-test-helpers';

const silent = { warn: () => {} };
const FCM = 'https://fcm.googleapis.com/fcm/send/';

it('turns Markdown into one short line of plain text', () => {
  expect(plainText('# Done\n\n**Bold** and _soft_ `code`, a [link](https://x.test) and ||secret||.')).toBe(
    'Done Bold and soft code, a link and (spoiler).',
  );
  expect(plainText('<b>Bold</b> <https://x.test> a <br/>line')).toBe('Bold https://x.test a line');
  expect(plainText('x'.repeat(100_000))).toHaveLength(160);
  expect(plainText('- one\n- two\n\n> quoted\n```ts\nconst a = 1;\n```')).toBe('one two quoted const a = 1;');
  const long = plainText('word '.repeat(100));
  expect(Array.from(long)).toHaveLength(160);
  expect(long.endsWith('…')).toBe(true);
});

it('names devices from their user agent and accepts only real push services', () => {
  expect(
    deviceLabel(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    ),
  ).toBe('Safari on iPhone');
  expect(
    deviceLabel(
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
    ),
  ).toBe('Chrome on Android');
  expect(
    deviceLabel(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
    ),
  ).toBe('Edge on Windows');
  expect(deviceLabel(undefined)).toBe('Browser');
  for (const good of [
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://web.push.apple.com/QK1',
    'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://wns2-by3p.notify.windows.com/w/?token=1',
  ])
    expect(isPushEndpoint(good), good).toBe(true);
  for (const bad of [
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://127.0.0.1/x',
    'https://localhost/x',
    'https://evil.example/fcm.googleapis.com',
    'https://fcm.googleapis.com.evil.example/x',
    'https://user:pw@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'not a url',
  ])
    expect(isPushEndpoint(bad), bad).toBe(false);
});

it('makes the VAPID key pair once, private to the platform, and keeps it', async () => {
  const folder = await mkdtemp(join(process.env.SQLITE_TEST_ROOT!, 'vapid-'));
  const keys = await loadVapidKeys(folder);
  expect(Buffer.from(keys.publicKey, 'base64url')).toHaveLength(65);
  expect((await stat(join(folder, 'push', 'vapid.json'))).mode & 0o777).toBe(0o600);
  expect((await stat(join(folder, 'push'))).mode & 0o777).toBe(0o700);
  expect(await loadVapidKeys(folder)).toEqual(keys);
  expect(JSON.parse(await readFile(join(folder, 'push', 'vapid.json'), 'utf8'))).toEqual(keys);
  expect(vapidSubject({})).toBe(DEFAULT_SUBJECT);
  expect(vapidSubject({ PUSH_SUBJECT: 'https://agents.example.org' })).toBe('https://agents.example.org/');
  for (const refused of ['mailto:someone@example.org', 'http://agents.example.org', 'https://localhost', 'nonsense'])
    expect(vapidSubject({ PUSH_SUBJECT: refused })).toBe(DEFAULT_SUBJECT);
});

it('never puts a broken key file’s text or path into errors, and repairs loose permissions', async () => {
  const folder = await mkdtemp(join(process.env.SQLITE_TEST_ROOT!, 'vapid-'));
  await mkdir(join(folder, 'push'), { mode: 0o755 });
  await writeFile(join(folder, 'push', 'vapid.json'), '{"privateKey": "SECRETKEYMATERIAL', { mode: 0o644 });
  const error = await loadVapidKeys(folder).then(
    () => null,
    (failure: Error) => failure,
  );
  expect(error?.message).toMatch(/unreadable/);
  expect(error?.message).not.toContain('SECRETKEYMATERIAL');
  expect(error?.message).not.toContain(folder);
  await rm(join(folder, 'push', 'vapid.json'));
  const keys = await loadVapidKeys(folder);
  await chmod(join(folder, 'push', 'vapid.json'), 0o644);
  await chmod(join(folder, 'push'), 0o755);
  expect(await loadVapidKeys(folder)).toEqual(keys);
  expect((await stat(join(folder, 'push', 'vapid.json'))).mode & 0o777).toBe(0o600);
  expect((await stat(join(folder, 'push'))).mode & 0o777).toBe(0o700);
});

it('keeps every payload under 3 KB', () => {
  const huge = encodePayload({
    title: '"'.repeat(5000),
    body: '\u0000'.repeat(5000),
    tag: 'agent:x',
    url: '/chat/agents/x',
    timestamp: 1,
    renotify: true,
  });
  expect(Buffer.byteLength(huge)).toBeLessThanOrEqual(PAYLOAD_LIMIT);
  expect(JSON.parse(huge).tag).toBe('agent:x');
});

async function setup() {
  const root = await mkdtemp(join(process.env.SQLITE_TEST_ROOT!, 'push-'));
  const database = await prepareDatabase(join(root, 'platform.db'));
  const store = new PushStore(database);
  const keys = await loadVapidKeys(root);
  const sam = await database.client.user.create({ data: { name: 'Sam' } });
  const samOrg = await database.client.organization.create({ data: { name: "Sam's", ownerId: sam.id } });
  return { database, store, keys, sam, samOrg };
}

describe('push delivery', { timeout: 60_000 }, () => {
  it('posts an encrypted, VAPID-signed message that only the device can read', async () => {
    const { database, store, keys } = await setup();
    const service = await fakePushService(path =>
      path.startsWith('/gone') ? 410 : path.startsWith('/down') ? 500 : 201,
    );
    try {
      const device = subscriber();
      const gone = subscriber();
      const down = subscriber();
      for (const [path, keys] of [
        ['/ok', device],
        ['/gone', gone],
        ['/down', down],
      ] as const)
        await store.subscribe('admin', null, { endpoint: `${service.origin}${path}`, ...keys, label: 'Test' });
      const sender = new PushSender(store, async () => keys, 'https://agents.example.org', silent, fetchTransport);
      const payload = {
        title: 'Aether',
        body: 'Hello there',
        tag: 'agent:a',
        url: '/chat/agents/a',
        timestamp: 5,
        renotify: true,
      };
      expect(await sender.send('admin', payload, 'high')).toEqual({ delivered: 1, failed: 1, expired: 1 });

      const ok = service.received.find(item => item.path === '/ok')!;
      expect(ok.headers['content-encoding']).toBe('aes128gcm');
      expect(ok.headers.urgency).toBe('high');
      expect(Number(ok.headers.ttl)).toBeGreaterThan(0);
      expect(ok.headers.topic).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
      const claims = verifyVapid(String(ok.headers.authorization), keys.publicKey);
      expect(claims).toMatchObject({ aud: service.origin, sub: 'https://agents.example.org' });
      // The body is ciphertext: the text is not in it, and only the device's keys decrypt it.
      expect(ok.body.includes(Buffer.from('Hello there'))).toBe(false);
      expect(JSON.parse(device.decrypt(ok.body))).toEqual(payload);
      expect(() => gone.decrypt(ok.body)).toThrow();

      // 410: the subscription is gone and deleted; 500: counted, and after MAX_FAILURES the device is paused.
      const devices = await store.devices('admin');
      expect(devices.map(item => item.label)).toHaveLength(2);
      expect(devices.find(item => item.lastSuccessAt)).toBeTruthy();
      for (let i = 1; i < MAX_FAILURES; i++) await sender.send('admin', payload);
      expect((await store.devices('admin')).filter(item => item.paused)).toHaveLength(1);
      const before = service.received.filter(item => item.path === '/down').length;
      await sender.send('admin', payload);
      expect(service.received.filter(item => item.path === '/down')).toHaveLength(before);
      // Subscribing again from that device starts it afresh.
      await store.subscribe('admin', null, { endpoint: `${service.origin}/down`, ...down, label: 'Test' });
      expect((await store.devices('admin')).some(item => item.paused)).toBe(false);
    } finally {
      await service.close();
      await database.close();
    }
  });

  it('sends to at most 5 devices at once', async () => {
    const { database, store, keys } = await setup();
    const service = await fakePushService(undefined, 60);
    try {
      for (let i = 0; i < 12; i++)
        await store.subscribe('admin', null, { endpoint: `${service.origin}/d${i}`, ...subscriber(), label: 'Test' });
      const sender = new PushSender(store, async () => keys, DEFAULT_SUBJECT, silent);
      const payload = { title: 't', body: 'b', tag: 't', url: '/', timestamp: 1, renotify: false };
      expect((await sender.send('admin', payload)).delivered).toBe(12);
      expect(service.load.max).toBe(SEND_CONCURRENCY);
    } finally {
      await service.close();
      await database.close();
    }
  });

  it('keeps 20 devices a person, refreshes only known ones, and skips disabled people and ended sessions', async () => {
    const { database, store, sam } = await setup();
    try {
      const add = (name: string, sessionId: string | null = null) =>
        store.subscribe(sam.id, sessionId, { endpoint: `${FCM}${name}`, ...subscriber(), label: name });
      for (let i = 0; i < MAX_DEVICES + 2; i++) await add(`d${i}`);
      const labels = (await store.devices(sam.id)).map(device => device.label);
      expect(labels).toHaveLength(MAX_DEVICES);
      expect(labels).not.toContain('d0');
      expect(labels).not.toContain('d1');
      expect(labels).toContain(`d${MAX_DEVICES + 1}`);

      // A refresh never adds a device back, nor un-pauses one.
      const keys = { ...subscriber(), label: 'again' };
      expect(await store.refresh(sam.id, null, { endpoint: `${FCM}d0`, ...keys })).toBeNull();
      const paused = (await store.devices(sam.id))[0]!;
      await database.client.pushSubscription.update({ where: { id: paused.id }, data: { failures: MAX_FAILURES } });
      const row = await database.client.pushSubscription.findUniqueOrThrow({ where: { id: paused.id } });
      expect((await store.refresh(sam.id, null, { endpoint: row.endpoint, ...keys }))?.paused).toBe(true);
      expect(await store.refresh('admin', null, { endpoint: row.endpoint, ...keys })).toBeNull();

      // Ending the session that subscribed a device removes it; a disabled person gets nothing.
      await database.client.pushSubscription.deleteMany({ where: { userId: sam.id } });
      const session = await database.client.userSession.create({
        data: { tokenHash: 'session-1', userId: sam.id, expiresAt: new Date(Date.now() + 3_600_000) },
      });
      await add('phone', session.tokenHash);
      await add('desk');
      expect(await store.targets(sam.id)).toHaveLength(2);
      await database.client.userSession.update({ where: { tokenHash: 'session-1' }, data: { expiresAt: new Date(0) } });
      expect((await store.targets(sam.id)).map(row => row.label)).toEqual(['desk']);
      await database.client.userSession.delete({ where: { tokenHash: 'session-1' } });
      expect((await store.devices(sam.id)).map(device => device.label)).toEqual(['desk']);
      await database.client.user.update({ where: { id: sam.id }, data: { disabledAt: new Date() } });
      expect(await store.targets(sam.id)).toEqual([]);
    } finally {
      await database.close();
    }
  });

  it('never throws when a push service is unreachable', async () => {
    const { database, store, keys } = await setup();
    try {
      await store.subscribe('admin', null, { endpoint: 'http://127.0.0.1:9/nothing', ...subscriber(), label: 'Test' });
      const sender = new PushSender(store, async () => keys, DEFAULT_SUBJECT, silent);
      const payload = { title: 't', body: 'b', tag: 't', url: '/', timestamp: 1, renotify: false };
      expect(await sender.send('admin', payload)).toEqual({ delivered: 0, failed: 1, expired: 0 });
    } finally {
      await database.close();
    }
  });
});

it('tells who is in front of the dashboard: any tab active within the last minute', () => {
  let now = 0;
  const presence = new Presence(() => now);
  presence.report('sam', 'phone', true);
  presence.report('sam', 'desk', true);
  expect(presence.present('sam')).toBe(true);
  expect(presence.present('admin')).toBe(false);
  presence.report('sam', 'phone', false);
  expect(presence.present('sam')).toBe(true);
  now = PRESENCE_MS;
  expect(presence.present('sam')).toBe(false);
});

it('tells a run’s end whether a person was waiting and who stopped it', async () => {
  const runs = new AgentRuns();
  const done: RunEvent[] = [];
  runs.subscribe(event => event.type === 'done' && done.push(event));
  const failing = runs.enqueue({ agentId: 'a', channelId: 'c', clientMessageId: 'm1', fromChat: true }, async () => {
    throw new Error('model down');
  });
  await failing.finished;
  let release = () => {};
  const waiting = runs.enqueue(
    { agentId: 'b', channelId: 'c', clientMessageId: 'm2', inputSource: 'agent' },
    ({ signal }) =>
      new Promise<void>(resolve => (release = resolve) && signal.addEventListener('abort', () => resolve())),
  );
  await new Promise(resolve => setTimeout(resolve, 20));
  await runs.stop('b', 'm2');
  await waiting.finished;
  release();
  expect(done.map(({ agentId, fromChat, stoppedBy }) => ({ agentId, fromChat, stoppedBy }))).toEqual([
    { agentId: 'a', fromChat: true, stoppedBy: undefined },
    { agentId: 'b', fromChat: false, stoppedBy: 'person' },
  ]);
});

describe('notifications', { timeout: 60_000 }, () => {
  async function notifierSetup() {
    const context = await setup();
    const sent: { userId: string; payload: Record<string, unknown>; urgency: string }[] = [];
    const sender = {
      send: async (userId: string, payload: object, urgency = 'normal') => {
        sent.push({ userId, payload: payload as Record<string, unknown>, urgency });
        return { delivered: 1, failed: 0, expired: 0 };
      },
    } as unknown as PushSender;
    let now = 1_000;
    const presence = new Presence(() => now);
    const notifier = new PushNotifier({
      platform: context.database,
      reach: new Reach(context.database),
      store: context.store,
      sender,
      presence,
      log: silent,
      debounceMs: 40,
      maxWaitMs: 400,
      now: () => now,
    });
    const aether = await context.database.createAgent({
      name: 'Aether',
      endpointId: 'x',
      model: 'm',
      thinkingLevel: 'off',
      organizationId: context.samOrg.id,
    });
    const settle = () => new Promise(resolve => setTimeout(resolve, 120));
    const event = (type: string, extra: object = {}, runId = 'run-1', agentId = aether.id) =>
      ({ type, eventId: crypto.randomUUID(), runId, agentId, channelId: 'chan', ...extra }) as RunEvent;
    return { ...context, notifier, sent, presence, aether, settle, event, tick: (ms: number) => (now += ms) };
  }

  it('sends an agent’s private messages to its organization’s owner, one per burst', async () => {
    const { database, notifier, sent, sam, aether, settle, event, store } = await notifierSetup();
    try {
      notifier.observe(event('channel_message', { role: 'assistant', text: '**Done** with the [report](https://x)' }));
      await settle();
      expect(sent).toEqual([
        {
          userId: sam.id,
          urgency: 'high',
          payload: expect.objectContaining({
            title: 'Aether',
            body: 'Done with the report',
            tag: `agent:${aether.id}`,
            url: `/chat/agents/${aether.id}`,
            icon: `/api/agents/${aether.id}/avatar.png`,
            renotify: true,
          }),
        },
      ]);
      // A burst: one notification, counted, with the latest text.
      sent.length = 0;
      for (const text of ['one', 'two', 'three'])
        notifier.observe(event('channel_message', { role: 'assistant', text }));
      await settle();
      expect(sent).toHaveLength(1);
      expect(sent[0]!.payload).toMatchObject({ title: 'Aether · 3 new messages', body: 'three' });
      // People's own messages, DMs between agents and Discord never notify.
      sent.length = 0;
      notifier.observe(event('user_message', { role: 'user', text: 'mine' }));
      notifier.observe(event('dm_updated', { conversationId: 'dm:a:b' }));
      notifier.observe(event('discord_message'));
      await settle();
      expect(sent).toEqual([]);
      // Preview off: no text on the lock screen.
      await store.setPreferences(sam.id, { preview: false });
      notifier.observe(event('channel_message', { role: 'assistant', text: 'private' }));
      await settle();
      expect(sent[0]!.payload).toMatchObject({ title: 'Aether', body: 'New message' });
      // Turned off: nothing.
      sent.length = 0;
      await store.setPreferences(sam.id, { agentMessages: false });
      notifier.observe(event('channel_message', { role: 'assistant', text: 'quiet' }));
      await settle();
      expect(sent).toEqual([]);
    } finally {
      notifier.close();
      await database.close();
    }
  });

  it('tells everyone who keeps it on that the Swarm updated, started or is stopping, presence or not', async () => {
    const { database, notifier, sent, sam, store, presence } = await notifierSetup();
    try {
      presence.report(sam.id, 'tab', true);
      await notifier.swarm('update', 'Agent Swarm updated', 'Now on abc1234: feat: x');
      expect(sent.map(item => item.userId).sort()).toEqual(
        (await database.client.user.findMany({ where: { disabledAt: null }, select: { id: true } }))
          .map(user => user.id)
          .sort(),
      );
      expect(sent.find(item => item.userId === sam.id)!.payload).toMatchObject({
        title: 'Agent Swarm updated',
        body: 'Now on abc1234: feat: x',
        tag: 'swarm',
        url: '/dashboard',
      });
      // Each kind is each person's own choice; disabled people get nothing.
      sent.length = 0;
      await store.setPreferences(sam.id, { swarmStops: false });
      await notifier.swarm('stop', 'Agent Swarm stopping', 'Back soon.');
      expect(sent.some(item => item.userId === sam.id)).toBe(false);
      sent.length = 0;
      await database.client.user.update({ where: { id: sam.id }, data: { disabledAt: new Date() } });
      await notifier.swarm('start', 'Agent Swarm started', 'Running again.');
      expect(sent.some(item => item.userId === sam.id)).toBe(false);
    } finally {
      notifier.close();
      await database.close();
    }
  });

  it('stays quiet while the person has the dashboard in front of them', async () => {
    const { database, notifier, sent, sam, presence, settle, event, tick } = await notifierSetup();
    try {
      presence.report(sam.id, 'tab', true);
      notifier.observe(event('channel_message', { role: 'assistant', text: 'seen in the app' }));
      await settle();
      expect(sent).toEqual([]);
      tick(PRESENCE_MS);
      notifier.observe(event('channel_message', { role: 'assistant', text: 'away now' }));
      await settle();
      expect(sent.map(item => item.payload.body)).toEqual(['away now']);
    } finally {
      notifier.close();
      await database.close();
    }
  });

  it('sends agents’ group messages to the group’s owner, with the author', async () => {
    const { database, notifier, sent, sam, samOrg, aether, settle, event } = await notifierSetup();
    try {
      const group = await database.client.groupChat.create({ data: { name: 'Launch', organizationId: samOrg.id } });
      const announce = (message: object) =>
        notifier.observe(
          event('group_updated', { groupId: group.id, publication: true, message }, 'platform', 'human'),
        );
      announce({ role: 'assistant', authorId: aether.id, authorName: 'Aether', text: 'Shipped _it_' });
      announce({ role: 'user', authorId: null, authorName: 'You', text: 'mine' });
      await settle();
      expect(sent).toEqual([
        expect.objectContaining({
          userId: sam.id,
          payload: expect.objectContaining({
            title: 'Launch',
            body: 'Aether: Shipped it',
            tag: `group:${group.id}`,
            url: `/chat/groups/${group.id}`,
            icon: `/api/agents/${aether.id}/avatar.png`,
          }),
        }),
      ]);
    } finally {
      notifier.close();
      await database.close();
    }
  });

  it('reports a run that failed before reaching the person waiting, and nothing else', async () => {
    const { database, notifier, sent, sam, aether, settle, event } = await notifierSetup();
    try {
      const reason = 'The model request failed. Check the endpoint, model, and tool-calling support.';
      const finish = (runId: string, done: object, published = false) => {
        notifier.observe(event('run_started', {}, runId));
        if (published) notifier.observe(event('channel_message', { role: 'assistant', text: 'partial' }, runId));
        notifier.observe(event('error', { message: reason }, runId));
        notifier.observe(event('done', done, runId));
      };
      finish('failed', { fromChat: true, stopped: false });
      await settle();
      expect(sent).toEqual([
        expect.objectContaining({
          userId: sam.id,
          payload: expect.objectContaining({
            title: 'Aether couldn’t finish',
            body: reason,
            tag: `stuck:${aether.id}`,
            url: `/chat/agents/${aether.id}`,
          }),
        }),
      ]);
      expect(sent[0]!.payload.icon).toBeUndefined();
      sent.length = 0;
      // Stopped by a person or a shutdown, not started from the private chat, or one that already replied: no.
      finish('stopped', { fromChat: true, stopped: true, stoppedBy: 'person' });
      finish('shutdown', { fromChat: true, stopped: true, stoppedBy: 'shutdown' });
      // Heartbeats, timers, Discord and group messages are not private-chat requests.
      finish('discord', { fromChat: false, stopped: false });
      finish('replied', { fromChat: true, stopped: false }, true);
      notifier.observe(event('run_started', {}, 'fine'));
      notifier.observe(event('done', { fromChat: true, stopped: false }, 'fine'));
      await settle();
      expect(sent.filter(item => item.payload.tag === `stuck:${aether.id}`)).toEqual([]);
    } finally {
      notifier.close();
      await database.close();
    }
  });

  it('tells the owner once when an agent drops off its #1 model', async () => {
    const { database, notifier, sent, sam, aether, settle, event } = await notifierSetup();
    try {
      notifier.observe(
        event('model_choice', { active: 1, from: 0, reason: 'authentication, HTTP 401' }, 'platform', aether.id),
      );
      await settle();
      expect(sent).toEqual([
        expect.objectContaining({
          userId: sam.id,
          payload: expect.objectContaining({
            title: 'Aether switched to model #2',
            body: 'Its #1 model failed (authentication, HTTP 401). It tries #1 again later; check the model connection.',
            tag: `model:${aether.id}`,
            url: `/agents/${aether.id}`,
          }),
        }),
      ]);
      sent.length = 0;
      // Moving further down, or back up, is not news.
      notifier.observe(event('model_choice', { active: 2, from: 1 }, 'platform', aether.id));
      notifier.observe(event('model_choice', { active: 0, from: 2 }, 'platform', aether.id));
      await settle();
      expect(sent).toEqual([]);
    } finally {
      notifier.close();
      await database.close();
    }
  });

  it('sends critical events to admin only', async () => {
    const { database, notifier, sent, store, settle } = await notifierSetup();
    try {
      notifier.critical({ kind: 'lockdown', title: 'Sign-in is locked down', detail: 'After 20 failed sign-ins.' });
      await settle();
      expect(sent).toEqual([
        expect.objectContaining({
          userId: 'admin',
          payload: expect.objectContaining({
            title: 'Sign-in is locked down',
            tag: 'alert:lockdown',
            url: '/settings/audit?category=signin',
          }),
        }),
      ]);
      // A sign-in burst's names (what an attacker typed) stay in the log.
      sent.length = 0;
      notifier.critical({
        kind: 'signin-failures',
        title: '6 failed sign-in attempts in the last hour',
        detail: 'Names tried: <script>evil</script> ×6. From: 192.0.2.1 ×6.',
      });
      await settle();
      expect(sent[0]!.payload).toMatchObject({ title: '6 failed sign-in attempts in the last hour' });
      expect(String(sent[0]!.payload.body)).not.toMatch(/evil|192\.0\.2\.1/);
      sent.length = 0;
      await store.setPreferences('admin', { critical: false });
      notifier.critical({ kind: 'outage', title: 'Possible power outage', detail: '…' });
      await settle();
      expect(sent).toEqual([]);
    } finally {
      notifier.close();
      await database.close();
    }
  });
});
