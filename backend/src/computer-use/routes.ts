import { viewerOf } from '../users/reach';
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ComputerUseError, type ComputerUseService } from './service';
import type { ScreenshotPool } from './image-pool';
import { registerComputerTerminalRoutes } from '../computer-terminal-routes';
const params = Type.Object({ id: Type.String({ format: 'uuid' }) });
const error = Type.Object({ message: Type.String() });
const errors = { 400: error, 403: error, 404: error, 409: error, 503: error };
const holder = Type.Object({ id: Type.String(), name: Type.String() });
const computer = Type.Object({
  id: Type.String(),
  name: Type.String(),
  state: Type.String(),
  holder: Type.Union([holder, Type.Null()]),
  current: Type.Boolean(),
});

export function registerComputerUseRoutes(app: FastifyInstance, service: ComputerUseService, images: ScreenshotPool) {
  const recordingsView = () => {
    const groups = new Map<string, { computerId: string; agent: { id: string; name: string }; sources: string[] }>();
    for (const item of service.recordings?.all() ?? []) {
      const key = `${item.computerId}:${item.agentId}`;
      const group = groups.get(key) ?? {
        computerId: item.computerId,
        agent: { id: item.agentId, name: item.agentName },
        sources: [],
      };
      group.sources.push(item.label);
      groups.set(key, group);
    }
    return [...groups.values()];
  };
  registerComputerTerminalRoutes(app, service);
  app.get<{ Params: { id: string } }>(
    '/api/agents/:id/computers',
    {
      schema: {
        operationId: 'getAgentComputers',
        params,
        response: { 200: Type.Object({ computers: Type.Array(computer) }), ...errors },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return { computers: await service.list(request.params.id) };
      } catch (err) {
        return reply
          .code(err instanceof ComputerUseError ? err.status : 503)
          .send({ message: err instanceof ComputerUseError ? err.message : 'Computer access unavailable.' });
      }
    },
  );
  app.put<{ Params: { id: string }; Body: { computerIds: string[] } }>(
    '/api/agents/:id/computers',
    {
      schema: {
        operationId: 'assignAgentComputers',
        params,
        body: Type.Object(
          { computerIds: Type.Array(Type.String({ format: 'uuid' }), { maxItems: 100, uniqueItems: true }) },
          { additionalProperties: false },
        ),
        response: { 200: Type.Object({ saved: Type.Boolean() }), ...errors },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        await service.assign(request.params.id, request.body.computerIds);
        return { saved: true };
      } catch (err) {
        return reply
          .code(err instanceof ComputerUseError ? err.status : 503)
          .send({ message: err instanceof ComputerUseError ? err.message : 'Could not update computer assignments.' });
      }
    },
  );
  app.get(
    '/api/computers/control',
    {
      schema: {
        operationId: 'getComputerControl',
        response: {
          200: Type.Object({
            holders: Type.Array(Type.Object({ computerId: Type.String(), agent: holder })),
            /** Agents reading a computer without holding it (anyone assigned may read at any time). */
            readers: Type.Array(Type.Object({ computerId: Type.String(), agent: holder })),
            /** Agents recording a computer (start_recording), with the sources they record. */
            recordings: Type.Array(
              Type.Object({ computerId: Type.String(), agent: holder, sources: Type.Array(Type.String()) }),
            ),
          }),
          ...errors,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        const [holders, readers] = await Promise.all([service.holders(), service.readers()]);
        // Only the computers this person reaches (docs/users.md).
        const viewer = viewerOf(request);
        const mine = async <T extends { computerId: string }>(rows: T[]) => {
          const kept: T[] = [];
          for (const row of rows) if (await app.reach.computer(viewer, row.computerId)) kept.push(row);
          return kept;
        };
        return { holders: await mine(holders), readers: await mine(readers), recordings: await mine(recordingsView()) };
      } catch {
        return reply.code(503).send({ message: 'Could not read computer control.' });
      }
    },
  );
  // The human stops every recording on a computer: they are saved and their agents told.
  app.post<{ Params: { id: string } }>(
    '/api/computers/:id/recordings/stop',
    {
      schema: {
        operationId: 'stopComputerRecordings',
        params,
        body: Type.Object({}, { additionalProperties: false }),
        response: { 200: Type.Object({ stopped: Type.Integer() }), ...errors },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const count = service.recordings?.forComputer(request.params.id).length ?? 0;
      try {
        await service.recordings?.stopComputer(request.params.id, 'stopped by the human');
        return { stopped: count };
      } catch {
        return reply.code(503).send({ message: 'Could not stop the recordings.' });
      }
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/computers/:id/release',
    {
      schema: {
        operationId: 'forceReleaseComputer',
        params,
        body: Type.Object({}, { additionalProperties: false }),
        response: { 200: Type.Object({ released: Type.Boolean() }), ...errors },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        if (!(await service.database.client.computer.findUnique({ where: { id: request.params.id } })))
          return reply.code(404).send({ message: 'Computer not found.' });
        await service.forceRelease(request.params.id);
        return { released: true };
      } catch {
        return reply.code(503).send({
          message:
            'Could not settle computer operations; control has not been transferred. Retry release. If the runtime was lost, stop the computer before releasing it.',
        });
      }
    },
  );
  app.get<{ Params: { id: string; imageId: string } }>(
    '/api/agents/:id/screenshots/:imageId',
    {
      schema: {
        operationId: 'getAgentScreenshot',
        params: Type.Object({ id: Type.String({ format: 'uuid' }), imageId: Type.String({ format: 'uuid' }) }),
        response: { 200: Type.String({ format: 'binary' }), ...errors },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!(await service.database.hasAgent(request.params.id)))
        return reply.code(404).send({ message: 'Agent not found.' });
      const image = await images.read(request.params.id, request.params.imageId);
      if (!image)
        return reply.code(404).send({ message: 'Screenshot expired or unavailable. Its activity record is retained.' });
      return reply
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .type(image.mimeType)
        .send(image.data);
    },
  );
}
