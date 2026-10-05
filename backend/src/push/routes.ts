import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import { AvatarSchema } from '../agent-avatar';
import { viewerOf } from '../users/reach';
import type { PlatformStore } from '../platform-store';
import type { PushNotifier } from './notifier';
import type { Presence } from './presence';
import { deviceLabel, isPushEndpoint, type PushStore } from './store';

const Message = Type.Object({ message: Type.String() });
const Device = Type.Object({
  id: Type.String(),
  label: Type.String(),
  createdAt: Type.String(),
  lastSuccessAt: Type.Union([Type.String(), Type.Null()]),
  paused: Type.Boolean(),
});
const Key = Type.String({ minLength: 16, maxLength: 200, pattern: '^[A-Za-z0-9_=-]+$' });
const Subscription = Type.Object(
  {
    endpoint: Type.String({ minLength: 1, maxLength: 1024 }),
    keys: Type.Object({ p256dh: Key, auth: Key }, { additionalProperties: true }),
    // What PushSubscription.toJSON() also carries.
    expirationTime: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    /** Save it again only if this person already has this device (a visit to Settings): never adds one back. */
    refresh: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
const Preferences = Type.Object({
  agentMessages: Type.Boolean(),
  groupChats: Type.Boolean(),
  agentProblems: Type.Boolean(),
  critical: Type.Boolean(),
  preview: Type.Boolean(),
  swarmUpdates: Type.Boolean(),
  swarmStarts: Type.Boolean(),
  swarmStops: Type.Boolean(),
});
const IdParams = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) });

/** A person may send one test notification this often. */
export const TEST_EVERY_MS = 10_000;

/** A saved avatar look (its JSON, '' for the default one) as a short hash: what the dashboard drew is checked against it. */
export const lookOf = (avatar: string | null) =>
  createHash('sha256')
    .update(avatar ?? '')
    .digest('hex')
    .slice(0, 16);

/** Avatar PNGs are drawn at 192 px; anything larger than this is not one. */
export const AVATAR_PNG_LIMIT = 64 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** A PNG of at most 512×512 (its IHDR), or null. */
export function pngSize(bytes: Buffer) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString('latin1', 12, 16) !== 'IHDR')
    return null;
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 && width <= 512 && height <= 512 ? { width, height } : null;
}

/**
 * Push notifications (docs/notifications.md): the VAPID public key, a person's own devices and preferences, a test,
 * and the dashboard's presence reports. Everything here is the signed-in person's own (users/rules.ts).
 */
export function registerPushRoutes(
  app: FastifyInstance,
  options: {
    keys: () => Promise<{ publicKey: string }>;
    store: PushStore;
    notifier: PushNotifier;
    presence: Presence;
    platform: PlatformStore;
  },
) {
  const { keys, store, notifier, presence, platform } = options;
  // One test notification per person per TEST_EVERY_MS.
  const lastTest = new Map<string, number>();

  app.get(
    '/api/push/key',
    {
      schema: {
        operationId: 'getPushKey',
        response: { 200: Type.Object({ publicKey: Type.String() }), 503: Message },
      },
    },
    async (request, reply) => {
      try {
        return { publicKey: (await keys()).publicKey };
      } catch (error) {
        request.log.error({ err: error instanceof Error ? error.message : 'unknown' }, 'Push: no VAPID keys');
        return reply.code(503).send({ message: 'Notifications are unavailable: the server has no usable push keys.' });
      }
    },
  );

  app.get(
    '/api/push/subscriptions',
    {
      schema: {
        operationId: 'listPushDevices',
        response: { 200: Type.Object({ devices: Type.Array(Device) }) },
      },
    },
    async request => ({ devices: await store.devices(viewerOf(request).userId) }),
  );

  app.post<{ Body: Static<typeof Subscription> }>(
    '/api/push/subscriptions',
    {
      schema: {
        operationId: 'addPushDevice',
        body: Subscription,
        response: { 200: Device, 400: Message, 404: Message },
      },
    },
    async (request, reply) => {
      const { endpoint, keys, refresh } = request.body;
      if (!isPushEndpoint(endpoint))
        return reply.code(400).send({ message: 'This browser’s push service is not one the dashboard sends to.' });
      const input = {
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        label: deviceLabel(request.headers['user-agent']),
      };
      // Tied to this browser session: signing out (or being signed out) ends the device's pushes.
      const session = request.signedIn?.tokenHash ?? null;
      const { userId } = viewerOf(request);
      if (!refresh) return store.subscribe(userId, session, input);
      return (
        (await store.refresh(userId, session, input)) ??
        reply.code(404).send({ message: 'Notifications are not on for this device.' })
      );
    },
  );

  app.delete<{ Params: Static<typeof IdParams> }>(
    '/api/push/subscriptions/:id',
    {
      schema: {
        operationId: 'removePushDevice',
        params: IdParams,
        response: { 200: Type.Object({ ok: Type.Literal(true) }), 404: Message },
      },
    },
    async (request, reply) =>
      (await store.remove(viewerOf(request).userId, request.params.id))
        ? { ok: true as const }
        : reply.code(404).send({ message: 'No such device.' }),
  );

  app.get(
    '/api/push/preferences',
    { schema: { operationId: 'getPushPreferences', response: { 200: Preferences } } },
    async request => store.preferences(viewerOf(request).userId),
  );

  app.patch<{ Body: Partial<Static<typeof Preferences>> }>(
    '/api/push/preferences',
    {
      schema: {
        operationId: 'setPushPreferences',
        body: Type.Partial(Preferences, { additionalProperties: false, minProperties: 1 }),
        response: { 200: Preferences },
      },
    },
    async request => store.setPreferences(viewerOf(request).userId, request.body),
  );

  app.post(
    '/api/push/test',
    {
      schema: {
        operationId: 'sendTestPush',
        response: {
          200: Type.Object({ delivered: Type.Integer(), failed: Type.Integer(), expired: Type.Integer() }),
          429: Message,
        },
      },
    },
    async (request, reply) => {
      const { userId } = viewerOf(request);
      const now = Date.now();
      if (now - (lastTest.get(userId) ?? -Infinity) < TEST_EVERY_MS)
        return reply.code(429).send({ message: 'Wait a few seconds before sending another test.' });
      lastTest.set(userId, now);
      return notifier.test(userId);
    },
  );

  app.post<{ Body: { tabId: string; active: boolean } }>(
    '/api/push/presence',
    {
      schema: {
        operationId: 'reportPresence',
        body: Type.Object(
          { tabId: Type.String({ minLength: 1, maxLength: 64 }), active: Type.Boolean() },
          { additionalProperties: false },
        ),
        response: { 204: Type.Null() },
      },
    },
    async (request, reply) => {
      presence.report(viewerOf(request).userId, request.body.tabId, request.body.active);
      return reply.code(204).send();
    },
  );

  // Agents' avatars as PNGs, drawn by the dashboard (it has the art), for notification icons.
  const currentLook = async (agentId: string) => {
    await platform.initialize();
    return platform.client.agent.findUnique({ where: { id: agentId }, select: { avatar: true } });
  };

  app.get<{ Params: Static<typeof IdParams> }>(
    '/api/agents/:id/avatar.png',
    { schema: { operationId: 'getAgentAvatarPng', params: IdParams } },
    async (request, reply) => {
      await platform.initialize();
      const image = await platform.client.agentAvatarImage.findUnique({ where: { agentId: request.params.id } });
      if (!image) return reply.code(404).send({ message: 'No avatar image yet.' });
      return reply
        .header('Content-Type', 'image/png')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'private, no-cache')
        .send(Buffer.from(image.png));
    },
  );

  // The PNG is the raw request body.
  void app.register(async scoped => {
    scoped.removeAllContentTypeParsers();
    scoped.addContentTypeParser('image/png', { parseAs: 'buffer', bodyLimit: AVATAR_PNG_LIMIT }, (_r, body, done) =>
      done(null, body),
    );
    scoped.put<{ Params: Static<typeof IdParams>; Querystring: { look: string }; Body: Buffer }>(
      '/api/agents/:id/avatar.png',
      {
        schema: {
          operationId: 'putAgentAvatarPng',
          params: IdParams,
          // The look it was drawn from (from GET /api/push/avatars).
          querystring: Type.Object(
            { look: Type.String({ pattern: '^[0-9a-f]{16}$' }) },
            { additionalProperties: false },
          ),
          response: { 200: Type.Object({ ok: Type.Literal(true) }), 400: Message, 404: Message, 409: Message },
        },
      },
      async (request, reply) => {
        const body = request.body;
        if (!Buffer.isBuffer(body) || !pngSize(body))
          return reply.code(400).send({ message: 'Send a PNG of at most 512×512 pixels.' });
        const agent = await currentLook(request.params.id);
        if (!agent) return reply.code(404).send({ message: 'No such agent.' });
        // Drawn from an older look (it changed meanwhile): not stored as the current one.
        if (lookOf(agent.avatar) !== request.query.look)
          return reply.code(409).send({ message: 'The avatar changed since; draw it again.' });
        const source = agent.avatar ?? '';
        await platform.client.agentAvatarImage.upsert({
          where: { agentId: request.params.id },
          create: { agentId: request.params.id, png: new Uint8Array(body), source },
          update: { png: new Uint8Array(body), source },
        });
        return { ok: true as const };
      },
    );
  });

  // Which of the person's agents have no PNG of their current look, with that look: the dashboard draws and uploads
  // those (null: the default avatar for its id).
  app.get(
    '/api/push/avatars',
    {
      schema: {
        operationId: 'listStaleAvatarPngs',
        response: {
          200: Type.Object({
            stale: Type.Array(
              Type.Object({ id: Type.String(), avatar: Type.Union([AvatarSchema, Type.Null()]), look: Type.String() }),
            ),
          }),
        },
      },
    },
    async request => {
      const organizations = await app.reach.organizations(viewerOf(request));
      await platform.initialize();
      const agents = await platform.client.agent.findMany({
        where: organizations ? { organizationId: { in: organizations } } : {},
        select: { id: true, avatar: true, avatarImage: { select: { source: true } } },
        orderBy: { sequence: 'asc' },
        take: 500,
      });
      return {
        stale: agents
          .filter(agent => agent.avatarImage?.source !== (agent.avatar ?? ''))
          .map(agent => ({
            id: agent.id,
            avatar: agent.avatar ? JSON.parse(agent.avatar) : null,
            look: lookOf(agent.avatar),
          })),
      };
    },
  );
}
