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
          200: Type.Object({ holders: Type.Array(Type.Object({ computerId: Type.String(), agent: holder })) }),
          ...errors,
        },
      },
    },
    async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return { holders: await service.holders() };
      } catch {
        return reply.code(503).send({ message: 'Could not read computer control.' });
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
