import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { swarmKnowledge } from './entries';
import type { KnowledgeCatalog } from './catalog';

const Summary = Type.Object({
  id: Type.String(),
  title: Type.String(),
  summary: Type.String(),
  source: Type.String(),
  hasChildren: Type.Boolean(),
});
const ErrorResponse = Type.Object({ message: Type.String() });
const Offset = Type.Optional(Type.Integer({ minimum: 0 }));
const Limit = Type.Optional(Type.Integer({ minimum: 1, maximum: 20 }));
const NextOffset = Type.Union([Type.Integer(), Type.Null()]);
const errors = { 400: ErrorResponse, 404: ErrorResponse };

function invalid(reply: FastifyReply, error: unknown) {
  if (error instanceof Error && error.message.includes('not found'))
    return reply.code(404).send({ message: 'Knowledge entry not found.' });
  if (error instanceof Error && /Invalid|Too many/.test(error.message))
    return reply.code(400).send({ message: 'Invalid knowledge request.' });
  throw error;
}

/** Read-only operator review API. The existing dashboard has no app authentication. */
export function registerKnowledgeRoutes(app: FastifyInstance, catalog: KnowledgeCatalog = swarmKnowledge) {
  app.get<{ Querystring: { parentId?: string; offset?: number; limit?: number } }>(
    '/api/knowledge',
    {
      schema: {
        operationId: 'listKnowledge',
        querystring: Type.Object(
          { parentId: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })), offset: Offset, limit: Limit },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            parentId: Type.Union([Type.String(), Type.Null()]),
            entries: Type.Array(Summary),
            nextOffset: NextOffset,
          }),
          ...errors,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return catalog.list(request.query);
      } catch (error) {
        return invalid(reply, error);
      }
    },
  );
  app.get<{ Querystring: { query: string; offset?: number; limit?: number } }>(
    '/api/knowledge/search',
    {
      schema: {
        operationId: 'searchKnowledge',
        querystring: Type.Object(
          { query: Type.String({ minLength: 1, maxLength: 200 }), offset: Offset, limit: Limit },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            query: Type.String(),
            matches: Type.Array(Type.Object({ ...Summary.properties, snippet: Type.String() })),
            nextOffset: NextOffset,
          }),
          ...errors,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return catalog.search(request.query);
      } catch (error) {
        return invalid(reply, error);
      }
    },
  );
  app.get<{ Querystring: { id: string; offset?: number; length?: number } }>(
    '/api/knowledge/entry',
    {
      schema: {
        operationId: 'readKnowledgeEntry',
        querystring: Type.Object(
          {
            id: Type.String({ minLength: 1, maxLength: 120 }),
            offset: Offset,
            length: Type.Optional(Type.Integer({ minimum: 1, maximum: 6000 })),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            ...Summary.properties,
            parentId: Type.Union([Type.String(), Type.Null()]),
            breadcrumbs: Type.Array(Type.Object({ id: Type.String(), title: Type.String() })),
            movedFrom: Type.Optional(Type.String()),
            related: Type.Array(Type.Object({ id: Type.String(), title: Type.String(), summary: Type.String() })),
            text: Type.String(),
            offset: Type.Integer(),
            totalCharacters: Type.Integer(),
            nextOffset: NextOffset,
          }),
          ...errors,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return catalog.read(request.query);
      } catch (error) {
        return invalid(reply, error);
      }
    },
  );
}
