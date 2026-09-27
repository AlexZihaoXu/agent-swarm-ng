import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { PlatformStore } from './platform-store';
import { ActivityStore, ACTIVITY_PAGE_SIZE } from './activity-store';
import { ActivityEntrySchema } from './agent-activity';

const Params = Type.Object({ id: Type.String({ minLength: 1, maxLength: 100 }) });
const ErrorResponse = Type.Object({ message: Type.String() });
export function registerActivityRoutes(app: FastifyInstance, database: PlatformStore, activity = new ActivityStore(database)) {
  app.get<{ Params: { id: string }; Querystring: { before?: number } }>('/api/agents/:id/activity', {
    schema: { operationId: 'listAgentActivity', params: Params,
      querystring: Type.Object({ before: Type.Optional(Type.Integer({ minimum: 1 })) }),
      response: { 200: Type.Object({ entries: Type.Array(ActivityEntrySchema, { maxItems: ACTIVITY_PAGE_SIZE }), nextCursor: Type.Union([Type.Integer(), Type.Null()]), contextUsage: Type.Union([ActivityEntrySchema, Type.Null()]) }), 404: ErrorResponse } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!await database.hasAgent(request.params.id)) return reply.code(404).send({ message: 'Agent not found.' });
    return activity.page(request.params.id, request.query.before);
  });
  app.get<{ Params: { id: string }; Querystring: { entryId: string; offset?: number; revision?: number } }>('/api/agents/:id/activity/entry', {
    schema: { operationId: 'readAgentActivity', params: Params,
      querystring: Type.Object({ entryId: Type.String({ minLength: 1, maxLength: 512 }), offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 2147483646 })), revision: Type.Optional(Type.Integer({ minimum: 1 })) }),
      response: { 200: ActivityEntrySchema, 404: ErrorResponse, 409: ErrorResponse } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const entry = await activity.fragment(request.params.id, request.query.entryId, request.query.offset ?? 0, request.query.revision);
    if (!entry) return reply.code(404).send({ message: 'Activity entry not found.' });
    if (entry === 'changed') return reply.code(409).send({ message: 'Activity changed. Reload the entry before continuing.' });
    return entry;
  });
}
