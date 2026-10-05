import { checkMemoryCap } from './users/store';
import { viewerOf } from './users/reach';
import { Organizations } from './organizations';
import { SwarmSettingsStore } from './swarm-settings';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { PlatformStore } from './platform-store';
import { ComputerStore, ComputerStoreError, storageOf, type ComputerSettings } from './computer-store';
import { computerStorageFolders } from './computer-storage-routes';
import { ControllerError, type ComputerController, type ComputerObservation } from './computer-controller-client';
import type { ComputerUseService } from './computer-use/service';
import { registerComputerFileRoutes } from './computer-file-routes';

const idParams = Type.Object({ id: Type.String({ minLength: 1, maxLength: 80 }) });
const errorSchema = Type.Object({ message: Type.String() });
const errors = { 400: errorSchema, 404: errorSchema, 409: errorSchema, 503: errorSchema };
const boundedChoice = Type.Object({ min: Type.Integer(), max: Type.Integer(), default: Type.Integer() });
const limitsSchema = Type.Object({
  cpuCores: boundedChoice,
  memoryGiB: boundedChoice,
  timezoneDefault: Type.String(),
  maxComputers: Type.Optional(Type.Integer()),
});
const viewSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  /** The organization it belongs to (organizations.ts): only that organization's agents can be assigned it. */
  organizationId: Type.String(),
  state: Type.String(),
  createdAt: Type.Number(),
  cpuCores: Type.Union([Type.Integer(), Type.Null()]),
  memoryGiB: Type.Union([Type.Integer(), Type.Null()]),
  timezone: Type.Union([Type.String(), Type.Null()]),
  cpuPercent: Type.Union([Type.Number(), Type.Null()]),
  memoryBytes: Type.Union([Type.Number(), Type.Null()]),
  // Dial denominators come from the enforced container quotas, never the browser.
  memoryLimitBytes: Type.Union([Type.Number(), Type.Null()]),
  // Docker sums CPU across cores, so the count is needed for an honest fraction.
  cpuCount: Type.Union([Type.Number(), Type.Null()]),
  // True for GNOME/X11 computers (no screen-share consent step), false for Wayland, null when unknown (controller offline).
  portalFree: Type.Union([Type.Boolean(), Type.Null()]),
  // Its Keep and Cache folders on the host (null = its own Docker volumes) and the paths it keeps.
  keepFolder: Type.Union([Type.String(), Type.Null()]),
  cacheFolder: Type.Union([Type.String(), Type.Null()]),
  keptPaths: Type.Array(Type.String()),
  // Made from an older image than the current one (Update image); null when unknown.
  outdated: Type.Union([Type.Boolean(), Type.Null()]),
  // Running, but its own memory/CPU view (LXCFS) is broken until it restarts; null when unknown.
  resourceViewStale: Type.Union([Type.Boolean(), Type.Null()]),
});

function view(
  record: {
    id: string;
    name: string;
    organizationId: string;
    state: string;
    createdAt: Date;
    cpuCores: number | null;
    memoryGiB: number | null;
    timezone: string | null;
    keepFolder: string | null;
    cacheFolder: string | null;
    keptPaths: string;
  },
  observed?: ComputerObservation,
) {
  return {
    ...storageOf(record),
    outdated: observed ? (observed.outdated ?? false) : null,
    resourceViewStale: observed ? (observed.resourceViewStale ?? false) : null,
    id: record.id,
    name: record.name,
    organizationId: record.organizationId,
    cpuCores: observed?.cpuCount ?? record.cpuCores ?? null,
    memoryGiB:
      observed?.memoryLimitBytes && Number.isInteger(observed.memoryLimitBytes / 1024 ** 3)
        ? observed.memoryLimitBytes / 1024 ** 3
        : record.memoryGiB,
    timezone: record.timezone,
    state: record.state === 'running' ? (observed?.status ?? 'unavailable') : record.state,
    createdAt: record.createdAt.getTime(),
    cpuPercent: observed?.cpuPercent ?? null,
    memoryBytes: observed?.memoryBytes ?? null,
    memoryLimitBytes: observed?.memoryLimitBytes ?? null,
    cpuCount: observed?.cpuCount ?? null,
    portalFree: observed?.displayServer ? observed.displayServer === 'x11' : null,
  };
}
function unavailable(reply: FastifyReply) {
  return reply.code(503).send({ message: 'Computer management is unavailable. Retry when the controller is healthy.' });
}
function failure(reply: FastifyReply, error: unknown) {
  if (error instanceof ComputerStoreError) {
    return reply
      .code(error.code === 'missing' ? 404 : error.code === 'conflict' ? 409 : 400)
      .send({ message: error.message });
  }
  if (error instanceof ControllerError) {
    // Controller messages are operator-safe; keep the real reason (cap reached, images not built, ...).
    return reply.code([400, 404, 409].includes(error.status) ? error.status : 503).send({ message: error.message });
  }
  return unavailable(reply);
}

export function registerComputerRoutes(
  app: FastifyInstance,
  platform: PlatformStore,
  controller: ComputerController | null,
  use?: ComputerUseService,
  swarmSettings: SwarmSettingsStore = new SwarmSettingsStore(platform),
) {
  const store = new ComputerStore(platform);
  registerComputerFileRoutes(app, store, controller);
  app.get(
    '/api/computers',
    {
      schema: {
        operationId: 'listComputers',
        response: {
          200: Type.Object({ computers: Type.Array(viewSchema), controllerConnected: Type.Boolean() }),
          ...errors,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        const reachable = await app.reach.organizations(viewerOf(request));
        const records = (await store.list()).filter(record => !reachable || reachable.includes(record.organizationId));
        const observed = controller ? await controller.observe().catch(() => null) : null;
        const reconciled = await Promise.all(
          records.map(async record => {
            if (record.state !== 'creating') return record;
            if (observed?.get(record.id)?.status === 'running' && (await store.markRunning(record.id)))
              return { ...record, state: 'running' };
            // A backend crash can leave a completed or partial Docker operation
            // without its response. Once the 120s create deadline has elapsed,
            // expose a failed record for exact-name cleanup instead of a permanent
            // 'creating' row that the operator cannot delete.
            // Only conclude that a create failed when the controller actually answered: during an outage nothing is known.
            if (
              observed !== null &&
              Date.now() - record.createdAt.getTime() > 120_000 &&
              (await store.markFailed(record.id))
            )
              return { ...record, state: 'failed' };
            return record;
          }),
        );
        return {
          computers: reconciled.map(record => view(record, observed?.get(record.id))),
          controllerConnected: observed !== null,
        };
      } catch (error) {
        return failure(reply, error);
      }
    },
  );
  app.get(
    '/api/computers/settings-limits',
    {
      schema: { operationId: 'getComputerSettingsLimits', response: { 200: limitsSchema, ...errors } },
    },
    async (_, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!controller) return unavailable(reply);
      try {
        // The computer count comes from Settings → Swarm; CPU/RAM bounds from the host.
        return { ...(await controller.limits()), maxComputers: (await swarmSettings.get()).maxComputers };
      } catch (error) {
        return failure(reply, error);
      }
    },
  );
  app.post<{
    Body: {
      name: string;
      requestKey: string;
      cpuCores?: number;
      memoryGiB?: number;
      timezone?: string;
      organizationId?: string;
    };
  }>(
    '/api/computers',
    {
      schema: {
        operationId: 'createComputer',
        body: Type.Object(
          {
            name: Type.String({ minLength: 1, maxLength: 80 }),
            requestKey: Type.String({ format: 'uuid' }),
            cpuCores: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
            memoryGiB: Type.Optional(Type.Integer({ minimum: 1, maximum: 16 })),
            timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
            /** Where it goes (default: the first organization). */
            organizationId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
          },
          { additionalProperties: false },
        ),
        response: { 200: viewSchema, 201: viewSchema, ...errors },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!controller) return unavailable(reply);
      let recordId: string | undefined;
      try {
        const limits = await controller.limits();
        const settings: ComputerSettings = {
          cpuCores: request.body.cpuCores ?? limits.cpuCores.default,
          memoryGiB: request.body.memoryGiB ?? limits.memoryGiB.default,
          timezone: request.body.timezone ?? limits.timezoneDefault,
        };
        if (settings.cpuCores > limits.cpuCores.max || settings.memoryGiB > limits.memoryGiB.max) {
          throw new ComputerStoreError('invalid', 'Computer settings exceed this host’s capacity.');
        }
        // New computers use the Keep/Cache folders chosen in Settings now; they stay there afterwards.
        const folders = await computerStorageFolders(platform);
        const organizationId = await new Organizations(platform)
          .resolve(viewerOf(request), request.body.organizationId)
          .catch(() => {
            throw new ComputerStoreError('missing', 'Organization not found.');
          });
        // Its owner's RAM cap (docs/users.md); a retried create (same request key) is already counted.
        await platform.initialize();
        const retry = await platform.client.computer.findFirst({
          where: { requestKey: request.body.requestKey },
          select: { id: true },
        });
        const capped = await checkMemoryCap(platform, organizationId, settings.memoryGiB, retry?.id);
        if (capped) throw new ComputerStoreError('invalid', capped);
        const { computer, created } = await store.reserve(
          request.body.name,
          request.body.requestKey,
          settings,
          folders,
          organizationId,
        );
        recordId = computer.id;
        if (computer.state === 'deleting' || computer.state === 'failed')
          return reply
            .code(409)
            .send({ message: 'Delete the incomplete computer before reusing this create request.' });
        if (computer.state === 'creating') {
          await controller.create(
            computer.id,
            computer.name,
            settings,
            (await swarmSettings.get()).maxComputers,
            storageOf(computer),
          );
          await store.markRunning(computer.id);
        }
        const observed = await controller.observe();
        const current = await store.get(computer.id);
        if (!current) return unavailable(reply);
        return reply.code(created ? 201 : 200).send(view(current, observed.get(computer.id)));
      } catch (error) {
        if (recordId && error instanceof ControllerError && [400, 409].includes(error.status))
          await store.discardReservation(recordId).catch(() => {});
        else if (!(error instanceof ComputerStoreError) && recordId) await store.markFailed(recordId).catch(() => {});
        return failure(reply, error);
      }
    },
  );
  app.delete<{ Params: { id: string }; Body: { confirmation: string } }>(
    '/api/computers/:id',
    {
      schema: {
        operationId: 'deleteComputer',
        params: idParams,
        body: Type.Object(
          { confirmation: Type.String({ minLength: 1, maxLength: 80 }) },
          { additionalProperties: false },
        ),
        response: { 200: Type.Object({ deleted: Type.Boolean() }), ...errors },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!controller) return unavailable(reply);
      try {
        // Mark it deleting first: a computer that is not 'running' cannot be claimed, so no agent can take it again
        // between the release below and the removal.
        const record = await store.markDeleting(request.params.id, request.body.confirmation);
        // Its recordings end with it (their folders are deleted too); their agents are told.
        use?.recordings?.dropComputer(record.id);
        if ((await use?.holders())?.some(holder => holder.computerId === record.id)) await use?.forceRelease(record.id);
        await controller.remove(record.id, record.name, storageOf(record));
        if (!(await store.finalizeDelete(record.id, record.name)) && (await store.get(record.id)))
          return unavailable(reply);
        // A concurrent, identically confirmed deletion may already have removed
        // the record after this controller request was queued. Its effects are
        // complete, not a new failure that should prompt an unsafe retry.
        return { deleted: true };
      } catch (error) {
        return failure(reply, error);
      }
    },
  );
  app.post<{ Params: { id: string }; Body: { action: 'start' | 'stop' } }>(
    '/api/computers/:id/power',
    {
      schema: {
        operationId: 'powerComputer',
        params: idParams,
        body: Type.Object(
          { action: Type.Unsafe<'start' | 'stop'>({ type: 'string', enum: ['start', 'stop'] }) },
          { additionalProperties: false },
        ),
        response: {
          202: Type.Object({ accepted: Type.Boolean(), action: Type.String(), desiredState: Type.String() }),
          ...errors,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!controller) return unavailable(reply);
      try {
        const record = await store.get(request.params.id);
        if (!record) return reply.code(404).send({ message: 'Computer not found.' });
        if (record.state !== 'running') {
          return reply
            .code(409)
            .send({ message: 'This computer cannot change power state while its create or delete is unfinished.' });
        }
        // Record the operator's intent BEFORE touching Docker: a crash in between
        // then leaves a computer that is running but marked stopped, which startup
        // reconciliation stops again. The reverse order could silently revive it.
        const desired = request.body.action === 'start' ? 'running' : 'stopped';
        const updated = await store.setDesiredState(record.id, desired);
        if (request.body.action === 'start') {
          try {
            await controller.start(record.id, record.name);
          } catch (error) {
            // A refused start (its Keep/Cache disk is missing, say) leaves the computer off: say so, so it can still
            // be rebuilt or have its cache cleared. An unreachable controller may still start it: keep the intent.
            if (error instanceof ControllerError && error.status === 409)
              await store.setDesiredState(record.id, 'stopped').catch(() => {});
            throw error;
          }
        } else {
          // Recordings on it are saved before it goes (its /tmp, where they are cut, does not survive).
          await use?.recordings?.stopComputer(record.id, 'the computer was turned off').catch(() => {});
          await controller.stop(record.id, record.name);
        }
        return reply
          .code(202)
          .send({ accepted: true, action: request.body.action, desiredState: updated.desiredState });
      } catch (error) {
        return failure(reply, error);
      }
    },
  );
  app.patch<{ Params: { id: string }; Body: ComputerSettings }>(
    '/api/computers/:id/settings',
    {
      schema: {
        operationId: 'updateComputerSettings',
        params: idParams,
        body: Type.Object(
          {
            cpuCores: Type.Integer({ minimum: 1, maximum: 8 }),
            memoryGiB: Type.Integer({ minimum: 1, maximum: 16 }),
            timezone: Type.String({ minLength: 1, maxLength: 64 }),
          },
          { additionalProperties: false },
        ),
        response: { 200: viewSchema, ...errors },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!controller) return unavailable(reply);
      try {
        const record = await store.get(request.params.id);
        if (!record) return reply.code(404).send({ message: 'Computer not found.' });
        if (record.state !== 'running')
          return reply.code(409).send({ message: 'Computer creation or deletion is unfinished.' });
        if (request.body.timezone !== record.timezone) {
          return reply.code(409).send({
            message:
              'Changing timezone requires container replacement and a desktop restart. Confirm the restart separately before applying it.',
          });
        }
        const limits = await controller.limits();
        if (request.body.cpuCores > limits.cpuCores.max || request.body.memoryGiB > limits.memoryGiB.max) {
          throw new ComputerStoreError('invalid', 'Computer settings exceed this host’s capacity.');
        }
        const capped = await checkMemoryCap(platform, record.organizationId, request.body.memoryGiB, record.id);
        if (capped) throw new ComputerStoreError('invalid', capped);
        await controller.updateResources(record.id, record.name, request.body);
        const updated = await store.updateResources(record.id, request.body);
        const observed = await controller.observe();
        return view(updated, observed.get(record.id));
      } catch (error) {
        return failure(reply, error);
      }
    },
  );
  app.post<{
    Params: { id: string };
    Body: ComputerSettings & { confirmReplacement: true; keptPaths?: string[]; image?: 'current' | 'same' };
  }>(
    '/api/computers/:id/settings/replacement',
    {
      schema: {
        operationId: 'replaceStoppedComputerSettings',
        params: idParams,
        body: Type.Object(
          {
            cpuCores: Type.Integer({ minimum: 1, maximum: 8 }),
            memoryGiB: Type.Integer({ minimum: 1, maximum: 16 }),
            timezone: Type.String({ minLength: 1, maxLength: 64 }),
            confirmReplacement: Type.Literal(true),
            // Paths to keep beyond the home folder (validated by the controller); omitted = unchanged.
            keptPaths: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 255 }), { maxItems: 32 })),
            // 'current' rebuilds it on the current computer image (Update image).
            image: Type.Optional(Type.Union([Type.Literal('current'), Type.Literal('same')])),
          },
          { additionalProperties: false },
        ),
        response: { 200: viewSchema, ...errors },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!controller) return unavailable(reply);
      try {
        const record = await store.get(request.params.id);
        if (!record) return reply.code(404).send({ message: 'Computer not found.' });
        if (record.state !== 'running' || record.desiredState !== 'stopped') {
          return reply.code(409).send({ message: 'Power off this computer before rebuilding it.' });
        }
        const observed = await controller.observe();
        if (observed.get(record.id)?.status !== 'exited') {
          return reply
            .code(409)
            .send({ message: 'Wait for the computer to finish powering off before rebuilding it.' });
        }
        const limits = await controller.limits();
        if (request.body.cpuCores > limits.cpuCores.max || request.body.memoryGiB > limits.memoryGiB.max) {
          throw new ComputerStoreError('invalid', 'Computer settings exceed this host’s capacity.');
        }
        const capped = await checkMemoryCap(platform, record.organizationId, request.body.memoryGiB, record.id);
        if (capped) throw new ComputerStoreError('invalid', capped);
        const settings = {
          cpuCores: request.body.cpuCores,
          memoryGiB: request.body.memoryGiB,
          timezone: request.body.timezone,
        };
        await controller.replaceStopped(record.id, record.name, settings, {
          ...(request.body.image ? { image: request.body.image } : {}),
          ...(request.body.keptPaths ? { keptPaths: request.body.keptPaths } : {}),
        });
        // As the controller keeps them: in the given order, the home folder always included.
        const given = request.body.keptPaths ? [...new Set(request.body.keptPaths)] : undefined;
        const keptPaths = given && !given.includes('/home/agent') ? ['/home/agent', ...given] : given;
        const updated = await store.updateSettings(record.id, settings, keptPaths);
        const current = await controller.observe();
        return view(updated, current.get(record.id));
      } catch (error) {
        return failure(reply, error);
      }
    },
  );
  app.get<{ Params: { id: string }; Querystring: { full?: '1' } }>(
    '/api/computers/:id/preview',
    {
      schema: {
        operationId: 'getComputerPreview',
        params: idParams,
        querystring: Type.Object({ full: Type.Optional(Type.Literal('1')) }),
        response: { 200: Type.String({ format: 'binary' }), ...errors },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!controller) return unavailable(reply);
      const record = await store.get(request.params.id);
      if (!record) return reply.code(404).send({ message: 'Computer not found.' });
      if (record.state !== 'running') return unavailable(reply);
      try {
        const image = await controller.preview(record.id, request.query.full === '1');
        if (!image) return unavailable(reply);
        // Sudo in the computer controls these bytes. Never let a direct
        // navigation or script tag interpret a JPEG polyglot as executable.
        return reply.header('X-Content-Type-Options', 'nosniff').type('image/jpeg').send(Buffer.from(image));
      } catch (error) {
        return failure(reply, error);
      }
    },
  );
  app.post<{ Params: { id: string }; Body: { x: number; y: number } }>(
    '/api/computers/:id/desktop/input',
    {
      schema: {
        operationId: 'sendComputerDesktopPointer',
        params: idParams,
        body: Type.Object(
          { x: Type.Number({ minimum: 0, maximum: 1 }), y: Type.Number({ minimum: 0, maximum: 1 }) },
          { additionalProperties: false },
        ),
        response: { 202: Type.Object({ accepted: Type.Boolean() }), ...errors },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!controller) return unavailable(reply);
      const record = await store.get(request.params.id);
      if (!record) return reply.code(404).send({ message: 'Computer not found.' });
      if (record.state !== 'running') return unavailable(reply);
      try {
        await controller.pointer(record.id, request.body.x, request.body.y);
        return reply.code(202).send({ accepted: true });
      } catch (error) {
        return failure(reply, error);
      }
    },
  );
}
