import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { FastifyRequest } from 'fastify';
import type { Connections } from './users/connections';
import { connectionOwner, viewerOf } from './users/reach';

const Status = Type.Object({
  connected: Type.Boolean(),
  models: Type.Array(Type.String()),
  login: Type.Object({
    state: Type.Union(['idle', 'starting', 'waiting', 'connected', 'error'].map(value => Type.Literal(value))),
    userCode: Type.Optional(Type.String()),
    verificationUri: Type.Optional(Type.String()),
    message: Type.Optional(Type.String()),
  }),
});
const ErrorResponse = Type.Object({ message: Type.String() });
/** Each person's own ChatGPT login (docs/users.md#model-connections). */
export function registerCodex(app: FastifyInstance, connections: Connections) {
  const schema = { response: { 200: Status, 403: ErrorResponse, 503: ErrorResponse } };
  const own = (request: FastifyRequest) => connections.codex(viewerOf(request).userId);
  app.addHook('onClose', async () => {
    await connections.close();
  });
  app.register(async routes => {
    routes.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const origin = request.headers.origin;
      if (
        request.headers['sec-fetch-site'] === 'cross-site' ||
        (origin &&
          (() => {
            try {
              return new URL(origin).hostname !== new URL(`http://${request.headers.host}`).hostname;
            } catch {
              return true;
            }
          })())
      )
        return reply.code(403).send({ message: 'Cross-site provider access is not allowed.' });
    });
    routes.get<{ Querystring: { organizationId?: string } }>(
      '/api/providers/openai-codex',
      {
        schema: {
          ...schema,
          operationId: 'getCodexProvider',
          // Whose login: this organization's owner's, for choosing an agent's model there (default: your own).
          querystring: Type.Object({ organizationId: Type.Optional(Type.String({ maxLength: 64 })) }),
        },
      },
      async (request, reply) => {
        try {
          const owner = await connectionOwner(connections.reach, viewerOf(request), request.query.organizationId);
          const status = await connections.codex(owner).status();
          // Someone else's sign-in in progress is theirs alone.
          return owner === viewerOf(request).userId ? status : { ...status, login: { state: 'idle' as const } };
        } catch {
          return reply.code(503).send({ message: 'Could not read provider connection.' });
        }
      },
    );
    routes.post(
      '/api/providers/openai-codex/login',
      {
        schema: {
          ...schema,
          operationId: 'connectCodexProvider',
          body: Type.Object({}, { additionalProperties: false }),
        },
      },
      async (request, reply) => {
        try {
          own(request).start();
          return await own(request).status();
        } catch {
          return reply.code(503).send({ message: 'Could not start provider sign-in.' });
        }
      },
    );
    routes.delete(
      '/api/providers/openai-codex/login',
      { schema: { ...schema, operationId: 'cancelCodexLogin' } },
      async (request, reply) => {
        try {
          await own(request).cancel();
          return await own(request).status();
        } catch {
          return reply.code(503).send({ message: 'Could not cancel sign-in.' });
        }
      },
    );
    routes.delete(
      '/api/providers/openai-codex',
      { schema: { ...schema, operationId: 'disconnectCodexProvider' } },
      async (request, reply) => {
        try {
          await own(request).disconnect();
          return await own(request).status();
        } catch {
          return reply.code(503).send({ message: 'Could not disconnect provider.' });
        }
      },
    );
  });
}
