import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ControllerError, type ComputerController } from './computer-controller-client';
import { ComputerStore, controllerName } from './computer-store';
import type { PlatformStore } from './platform-store';

/**
 * Settings → Computers → Storage: the host folders new computers keep their files in. Keep holds code, settings and
 * what a computer installs; Cache holds what can be fetched again. Unset means each computer's own Docker volumes.
 * A host folder is accepted only when it exists and contains its marker file, which only someone with shell access
 * on the host can create, so the dashboard can never point a computer at an arbitrary host path. Existing
 * computers stay where they were created.
 */
export const STORAGE_MARKERS = { keep: '.agent-swarm-keep-root', cache: '.agent-swarm-cache-root' } as const;

export async function computerStorageFolders(platform: PlatformStore) {
  await platform.initialize();
  const row = await platform.client.swarmSettings.findUnique({
    where: { id: 1 },
    select: { computerKeepFolder: true, computerCacheFolder: true },
  });
  return { keepFolder: row?.computerKeepFolder ?? null, cacheFolder: row?.computerCacheFolder ?? null };
}

const folder = Type.Union([Type.String({ minLength: 1, maxLength: 1024 }), Type.Null()]);
const settingsSchema = Type.Object({
  keepFolder: folder,
  cacheFolder: folder,
  markers: Type.Object({ keep: Type.String(), cache: Type.String() }),
});
const errorSchema = Type.Object({ message: Type.String() });
const errors = { 400: errorSchema, 404: errorSchema, 409: errorSchema, 503: errorSchema };
const idParams = Type.Object({ id: Type.String({ minLength: 1, maxLength: 80 }) });
const usageSchema = Type.Object({
  // How the computer's last start went: "ok", "running" or "failed: …", then a time; null if never started.
  lastStart: Type.Union([Type.String(), Type.Null()]),
  storage: Type.Array(
    Type.Object({
      kind: Type.Union([Type.Literal('keep'), Type.Literal('cache')]),
      bytes: Type.Number(),
      folder: Type.Union([Type.String(), Type.Null()]),
    }),
  ),
});

function failed(reply: FastifyReply, error: unknown) {
  if (error instanceof ControllerError)
    return reply.code([400, 404, 409].includes(error.status) ? error.status : 503).send({ message: error.message });
  return reply.code(503).send({ message: 'Computer management is unavailable. Retry when the controller is healthy.' });
}

export function registerComputerStorageRoutes(
  app: FastifyInstance,
  platform: PlatformStore,
  controller: ComputerController | null,
) {
  const store = new ComputerStore(platform);
  const settings = async () => ({ ...(await computerStorageFolders(platform)), markers: { ...STORAGE_MARKERS } });

  app.get(
    '/api/computer-storage',
    { schema: { operationId: 'getComputerStorage', response: { 200: settingsSchema } } },
    async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return settings();
    },
  );

  app.put<{ Body: { keepFolder: string | null; cacheFolder: string | null } }>(
    '/api/computer-storage',
    {
      schema: {
        operationId: 'setComputerStorage',
        body: Type.Object({ keepFolder: folder, cacheFolder: folder }, { additionalProperties: false }),
        response: { 200: settingsSchema, ...errors },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const next = {
        keepFolder: request.body.keepFolder?.trim() || null,
        cacheFolder: request.body.cacheFolder?.trim() || null,
      };
      const current = await computerStorageFolders(platform);
      try {
        for (const kind of ['keep', 'cache'] as const) {
          const chosen = kind === 'keep' ? next.keepFolder : next.cacheFolder;
          // Only a newly chosen folder is checked here; every computer start checks its own again.
          if (!chosen || chosen === (kind === 'keep' ? current.keepFolder : current.cacheFolder)) continue;
          if (!controller?.checkStorageFolder) return failed(reply, null);
          await controller.checkStorageFolder(kind, chosen);
        }
      } catch (error) {
        return failed(reply, error);
      }
      await platform.client.swarmSettings.upsert({
        where: { id: 1 },
        create: { id: 1, computerKeepFolder: next.keepFolder, computerCacheFolder: next.cacheFolder },
        update: { computerKeepFolder: next.keepFolder, computerCacheFolder: next.cacheFolder },
      });
      return settings();
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/computers/:id/storage',
    { schema: { operationId: 'getComputerStorageUsage', params: idParams, response: { 200: usageSchema, ...errors } } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const record = await store.get(request.params.id);
      if (!record || record.state === 'deleting') return reply.code(404).send({ message: 'Computer not found.' });
      if (!controller?.storageUsage) return failed(reply, null);
      try {
        return await controller.storageUsage(record.id, controllerName(record));
      } catch (error) {
        return failed(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/computers/:id/cache/clear',
    {
      schema: {
        operationId: 'clearComputerCache',
        params: idParams,
        response: { 200: Type.Object({ cleared: Type.Boolean() }), ...errors },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const record = await store.get(request.params.id);
      if (!record || record.state === 'deleting') return reply.code(404).send({ message: 'Computer not found.' });
      if (record.desiredState !== 'stopped')
        return reply.code(409).send({ message: 'Power off this computer before clearing its cache.' });
      if (!controller?.clearCache) return failed(reply, null);
      try {
        await controller.clearCache(record.id, controllerName(record));
        return { cleared: true };
      } catch (error) {
        return failed(reply, error);
      }
    },
  );
}
