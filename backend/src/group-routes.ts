import type { FastifyInstance, FastifyReply } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { AvatarSchema } from './agent-avatar';
import { SwarmError } from './swarm-store';
import type { DmBroker } from './dm-broker';
import { groupMessageView } from './group-message';
import { GROUP_MEMBER_LIMIT } from './group-store';

const Id = Type.String({ minLength: 1, maxLength: 100 });
const Params = Type.Object({ id: Id });
const Cursor = Type.Union([Type.Integer(), Type.Null()]);
const ErrorResponse = Type.Object({ message: Type.String() });
const errors = { 400: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 503: ErrorResponse };
const Edit = Type.Object({ name: Type.String({ minLength: 1, maxLength: 80 }), agentIds: Type.Array(Id, { minItems: 1, maxItems: GROUP_MEMBER_LIMIT, uniqueItems: true }) }, { additionalProperties: false });
export const GroupMessageSchema = Type.Object({ id: Type.String(), sequence: Type.Integer(), groupId: Type.String(), role: Type.Union([Type.Literal('user'), Type.Literal('assistant')]), authorId: Type.Union([Type.String(), Type.Null()]), authorName: Type.String(), authorAvatar: Type.Union([AvatarSchema, Type.Null()]), text: Type.String(), timestamp: Type.Number() });
const Group = Type.Object({ id: Type.String(), name: Type.String(), createdAt: Type.Number(), members: Type.Array(Type.Object({ id: Type.String(), name: Type.String(), avatar: Type.Union([AvatarSchema, Type.Null()]), channelId: Type.String() })), lastMessage: Type.Union([GroupMessageSchema, Type.Null()]) });
function groupView(group: Awaited<ReturnType<DmBroker['groups']['get']>> & { lastMessage?: Parameters<typeof groupMessageView>[0] | null }) {
  return { id: group.id, name: group.name, createdAt: group.createdAt.getTime(), members: group.members.map(({ agent }) => ({ id: agent.id, name: agent.name, avatar: agent.avatar ? JSON.parse(agent.avatar) : null, channelId: agent.channels[0].id })), lastMessage: group.lastMessage ? groupMessageView(group.lastMessage) : null };
}
async function safely(reply: FastifyReply, operation: () => Promise<unknown>, status = 200) {
  reply.header('Cache-Control', 'no-store');
  try { return reply.code(status).send(await operation()); }
  catch (error) {
    if (error instanceof SwarmError) return reply.code(error.code === 'missing' ? 404 : error.code === 'limit' ? 409 : 400).send({ message: error.message });
    return reply.code(503).send({ message: 'The group operation could not finish. Reload history before retrying a message.' });
  }
}
export function registerGroupRoutes(app: FastifyInstance, broker: DmBroker, announce: (groupId: string) => void, closing: () => boolean) {
  const writable = () => { if (closing()) throw new Error('Backend closing.'); };
  app.get<{ Querystring: { after?: number; limit?: number; search?: string } }>('/api/groups', {
    schema: { operationId: 'listGroups', querystring: Type.Object({ after: Type.Optional(Type.Integer({ minimum: 1 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 40 })), search: Type.Optional(Type.String({ maxLength: 80 })) }), response: { 200: Type.Object({ groups: Type.Array(Group), nextCursor: Cursor }), ...errors } },
  }, (request, reply) => safely(reply, async () => {
    const page = await broker.groups.list(undefined, request.query.after, request.query.limit, request.query.search);
    return { groups: page.groups.map(groupView), nextCursor: page.nextCursor };
  }));
  app.post<{ Body: Static<typeof Edit> }>('/api/groups', {
    schema: { operationId: 'createGroup', body: Edit, response: { 200: Group, ...errors } },
  }, (request, reply) => safely(reply, async () => { writable(); const group = await broker.groups.create(request.body.name, request.body.agentIds); announce(group.id); return groupView(group); }));
  app.get<{ Params: { id: string } }>('/api/groups/:id', {
    schema: { operationId: 'getGroup', params: Params, response: { 200: Group, ...errors } },
  }, (request, reply) => safely(reply, async () => groupView(await broker.groups.get(request.params.id))));
  app.patch<{ Params: { id: string }; Body: Static<typeof Edit> }>('/api/groups/:id', {
    schema: { operationId: 'updateGroup', params: Params, body: Edit, response: { 200: Group, ...errors } },
  }, (request, reply) => safely(reply, async () => { writable(); const group = await broker.groups.update(request.params.id, request.body.name, request.body.agentIds); announce(group.id); return groupView(group); }));
  app.get<{ Params: { id: string }; Querystring: { before?: number; limit?: number } }>('/api/groups/:id/messages', {
    schema: { operationId: 'listGroupMessages', params: Params, querystring: Type.Object({ before: Type.Optional(Type.Integer({ minimum: 1 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 40 })) }), response: { 200: Type.Object({ messages: Type.Array(GroupMessageSchema), nextCursor: Cursor }), ...errors } },
  }, (request, reply) => safely(reply, async () => {
    const page = await broker.groups.history(request.params.id, undefined, request.query.before, request.query.limit);
    return { messages: page.messages.map(groupMessageView), nextCursor: page.nextCursor };
  }));
  app.post<{ Params: { id: string }; Body: { message: string; clientMessageId: string } }>('/api/groups/:id/messages', {
    schema: { operationId: 'sendGroupMessage', params: Params, body: Type.Object({ message: Type.String({ minLength: 1, maxLength: 20000 }), clientMessageId: Type.String({ format: 'uuid' }) }, { additionalProperties: false }), response: { 202: Type.Object({ message: GroupMessageSchema, duplicate: Type.Boolean() }), ...errors } },
  }, (request, reply) => safely(reply, async () => {
    writable(); const publication = await broker.sendHumanGroup(request.params.id, request.body.message, request.body.clientMessageId);
    return { message: groupMessageView(publication.message), duplicate: publication.duplicate };
  }, 202));
}
