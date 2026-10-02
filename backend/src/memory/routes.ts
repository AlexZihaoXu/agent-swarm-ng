import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PlatformStore } from '../platform-store';
import { MemoryError, MEMORY_TYPES, type MemoryStore, type MemoryType } from './store';
import type { SleepScheduler } from './sleep';
import type { SwarmSettingsStore } from '../swarm-settings';
import type { AgentMemory } from '../generated/prisma/client';

const error = Type.Object({ message: Type.String() });
const params = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) });
const named = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 64 }),
  name: Type.String({ minLength: 1, maxLength: 80 }),
});
const type = Type.Union(MEMORY_TYPES.map(item => Type.Literal(item)));
const memory = Type.Object({
  name: Type.String(),
  type: Type.String(),
  title: Type.String(),
  text: Type.String(),
  by: Type.String(),
  trust: Type.String(),
  channelId: Type.Union([Type.String(), Type.Null()]),
  recalls: Type.Integer(),
  lastRecalledAt: Type.Union([Type.String(), Type.Null()]),
  faded: Type.Boolean(),
  conflict: Type.Boolean(),
  forgottenAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
const clock = Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' });
const overview = Type.Object({
  index: Type.String(),
  memories: Type.Array(memory),
  forgotten: Type.Array(memory),
  maxCount: Type.Integer(),
  sleep: Type.Object({
    from: Type.String(),
    to: Type.String(),
    activeFrom: Type.String(),
    activeTo: Type.String(),
    sleeping: Type.Boolean(),
    sleptAt: Type.Union([Type.String(), Type.Null()]),
    lastNight: Type.String(),
  }),
});
const versions = Type.Array(
  Type.Object({
    title: Type.String(),
    text: Type.String(),
    type: Type.String(),
    changedBy: Type.String(),
    createdAt: Type.String(),
  }),
);
const changes = Type.Object(
  {
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    text: Type.Optional(Type.String({ minLength: 1, maxLength: 20000 })),
    type: Type.Optional(type),
    faded: Type.Optional(Type.Boolean()),
    conflict: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const view = (item: AgentMemory) => ({
  name: item.name,
  type: item.type,
  title: item.title,
  text: item.text,
  by: item.by,
  trust: item.trust,
  channelId: item.channelId,
  recalls: item.recalls,
  lastRecalledAt: item.lastRecalledAt?.toISOString() ?? null,
  faded: item.faded,
  conflict: item.conflict,
  forgottenAt: item.deletedAt?.toISOString() ?? null,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
});

/**
 * Agents → agent → Memory: the owner sees what an agent remembers (its index, its memories by type, what last night
 * changed), edits or forgets a memory (versions kept), restores one, erases everything, sets when it sleeps when it is
 * active all day, and can let it sleep now. Trusted dashboard surface.
 */
export function registerMemoryRoutes(
  app: FastifyInstance,
  database: PlatformStore,
  store: MemoryStore,
  sleeper: SleepScheduler,
  settings: SwarmSettingsStore,
) {
  const guard = async (reply: FastifyReply, agentId: string, work: () => Promise<unknown>) => {
    reply.header('Cache-Control', 'no-store');
    if (!(await database.hasAgent(agentId))) return reply.code(404).send({ message: 'Agent not found.' });
    try {
      return await work();
    } catch (caught) {
      if (caught instanceof MemoryError)
        return reply.code(/^No /.test(caught.message) ? 404 : 400).send({ message: caught.message });
      throw caught;
    }
  };
  const read = async (agentId: string) => {
    const agent = await database.client.agent.findUniqueOrThrow({ where: { id: agentId } });
    const [memories, forgotten, { memoryMaxCount }] = await Promise.all([
      store.list(agentId),
      store.list(agentId, { forgotten: true }),
      settings.get(),
    ]);
    return {
      index: agent.memoryIndex,
      memories: memories.map(view),
      forgotten: forgotten.slice(0, 200).map(view),
      maxCount: memoryMaxCount,
      sleep: {
        from: agent.sleepFrom,
        to: agent.sleepTo,
        // Active hours count only while the heartbeat is on.
        activeFrom: agent.heartbeatEnabled ? agent.heartbeatFrom : '',
        activeTo: agent.heartbeatEnabled ? agent.heartbeatTo : '',
        sleeping: sleeper.sleeping.has(agentId),
        sleptAt: agent.sleptAt?.toISOString() ?? null,
        lastNight: agent.sleepNote,
      },
    };
  };

  app.get<{ Params: Static<typeof params> }>(
    '/api/agents/:id/memory',
    { schema: { operationId: 'getAgentMemory', params, response: { 200: overview, 404: error } } },
    (request, reply) => guard(reply, request.params.id, () => read(request.params.id)),
  );
  app.patch<{ Params: Static<typeof named>; Body: Static<typeof changes> }>(
    '/api/agents/:id/memory/:name',
    {
      schema: {
        operationId: 'updateAgentMemory',
        params: named,
        body: changes,
        response: { 200: memory, 400: error, 404: error },
      },
    },
    (request, reply) =>
      guard(reply, request.params.id, async () =>
        view(
          await store.revise(
            request.params.id,
            request.params.name,
            { ...request.body, type: request.body.type as MemoryType | undefined },
            'owner',
          ),
        ),
      ),
  );
  app.delete<{ Params: Static<typeof named> }>(
    '/api/agents/:id/memory/:name',
    { schema: { operationId: 'forgetAgentMemory', params: named, response: { 204: Type.Null(), 404: error } } },
    (request, reply) =>
      guard(reply, request.params.id, async () => {
        await store.forget(request.params.id, request.params.name, 'owner');
        return reply.code(204).send();
      }),
  );
  app.post<{ Params: Static<typeof named> }>(
    '/api/agents/:id/memory/:name/restore',
    { schema: { operationId: 'restoreAgentMemory', params: named, response: { 200: memory, 404: error } } },
    (request, reply) =>
      guard(reply, request.params.id, async () => view(await store.restore(request.params.id, request.params.name))),
  );
  app.get<{ Params: Static<typeof named> }>(
    '/api/agents/:id/memory/:name/versions',
    { schema: { operationId: 'agentMemoryVersions', params: named, response: { 200: versions, 404: error } } },
    (request, reply) =>
      guard(reply, request.params.id, async () =>
        (await store.versions(request.params.id, request.params.name)).map(item => ({
          title: item.title,
          text: item.text,
          type: item.type,
          changedBy: item.changedBy,
          createdAt: item.createdAt.toISOString(),
        })),
      ),
  );
  app.delete<{ Params: Static<typeof params> }>(
    '/api/agents/:id/memory',
    { schema: { operationId: 'eraseAgentMemory', params, response: { 204: Type.Null(), 404: error } } },
    (request, reply) =>
      guard(reply, request.params.id, async () => {
        await store.eraseAll(request.params.id);
        return reply.code(204).send();
      }),
  );
  app.put<{ Params: Static<typeof params>; Body: { from: string; to: string } }>(
    '/api/agents/:id/memory/sleep-window',
    {
      schema: {
        operationId: 'setAgentSleepWindow',
        params,
        body: Type.Object({ from: clock, to: clock }, { additionalProperties: false }),
        response: { 200: overview, 400: error, 404: error },
      },
    },
    (request, reply) =>
      guard(reply, request.params.id, async () => {
        if (request.body.from === request.body.to)
          throw new MemoryError('Sleep needs a window: from and until differ.');
        await database.client.agent.update({
          where: { id: request.params.id },
          data: { sleepFrom: request.body.from, sleepTo: request.body.to },
        });
        return read(request.params.id);
      }),
  );
  app.post<{ Params: Static<typeof params> }>(
    '/api/agents/:id/memory/sleep',
    { schema: { operationId: 'sleepAgentNow', params, response: { 202: overview, 409: error, 404: error } } },
    (request, reply) =>
      guard(reply, request.params.id, async () => {
        if (!sleeper.run(request.params.id)) return reply.code(409).send({ message: 'It is already asleep.' });
        return reply.code(202).send(await read(request.params.id));
      }),
  );
}
