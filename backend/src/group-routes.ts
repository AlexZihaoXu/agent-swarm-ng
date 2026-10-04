import { viewerOf } from './users/reach';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { AvatarSchema } from './agent-avatar';
import { SwarmError } from './swarm-store';
import type { DmBroker } from './dm-broker';
import { groupMessageView } from './group-message';
import { GROUP_MEMBER_LIMIT } from './group-store';
import { FileSchema } from './files/routes';
import { FileError, type FileView } from './files/store';

const withGroupFiles = <T extends object>(view: T, files?: FileView[]) => (files?.length ? { ...view, files } : view);

const Id = Type.String({ minLength: 1, maxLength: 100 });
const Params = Type.Object({ id: Id });
const Cursor = Type.Union([Type.Integer(), Type.Null()]);
const ErrorResponse = Type.Object({ message: Type.String() });
const errors = { 400: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 503: ErrorResponse };
const Edit = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 80 }),
    agentIds: Type.Array(Id, { minItems: 1, maxItems: GROUP_MEMBER_LIMIT, uniqueItems: true }),
  },
  { additionalProperties: false },
);
const Create = Type.Object(
  {
    ...Edit.properties,
    /** Where it goes (default: the first organization); its members must all be in it. */
    organizationId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  },
  { additionalProperties: false },
);
export const GroupMessageSchema = Type.Object({
  id: Type.String(),
  sequence: Type.Integer(),
  groupId: Type.String(),
  role: Type.Union([Type.Literal('user'), Type.Literal('assistant')]),
  authorId: Type.Union([Type.String(), Type.Null()]),
  authorName: Type.String(),
  authorAvatar: Type.Union([AvatarSchema, Type.Null()]),
  text: Type.String(),
  timestamp: Type.Number(),
  files: Type.Optional(Type.Array(FileSchema)),
  replyTo: Type.Union([
    Type.Object({
      id: Type.String(),
      role: Type.Union([Type.Literal('user'), Type.Literal('assistant')]),
      authorId: Type.Union([Type.String(), Type.Null()]),
      authorName: Type.String(),
      text: Type.String(),
    }),
    Type.Null(),
  ]),
});
const Group = Type.Object({
  id: Type.String(),
  name: Type.String(),
  organizationId: Type.String(),
  createdAt: Type.Number(),
  members: Type.Array(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      avatar: Type.Union([AvatarSchema, Type.Null()]),
      channelId: Type.String(),
    }),
  ),
  lastMessage: Type.Union([GroupMessageSchema, Type.Null()]),
});
function groupView(
  group: Awaited<ReturnType<DmBroker['groups']['get']>> & {
    lastMessage?: Parameters<typeof groupMessageView>[0] | null;
  },
) {
  return {
    id: group.id,
    name: group.name,
    organizationId: group.organizationId,
    createdAt: group.createdAt.getTime(),
    members: group.members.map(({ agent }) => ({
      id: agent.id,
      name: agent.name,
      avatar: agent.avatar ? JSON.parse(agent.avatar) : null,
      channelId: agent.channels[0].id,
    })),
    lastMessage: group.lastMessage ? groupMessageView(group.lastMessage) : null,
  };
}
async function safely(reply: FastifyReply, operation: () => Promise<unknown>, status = 200) {
  reply.header('Cache-Control', 'no-store');
  try {
    return reply.code(status).send(await operation());
  } catch (error) {
    if (error instanceof SwarmError)
      return reply
        .code(error.code === 'missing' ? 404 : error.code === 'limit' ? 409 : 400)
        .send({ message: error.message });
    if (error instanceof FileError) return reply.code(error.status).send({ message: error.message });
    return reply
      .code(503)
      .send({ message: 'The group operation could not finish. Reload history before retrying a message.' });
  }
}
export function registerGroupRoutes(
  app: FastifyInstance,
  broker: DmBroker,
  announce: (groupId: string) => void,
  closing: () => boolean,
  announceDeleted: (groupId: string) => void,
) {
  const writable = () => {
    if (closing()) throw new Error('Backend closing.');
  };
  app.get<{ Querystring: { after?: number; limit?: number; search?: string } }>(
    '/api/groups',
    {
      schema: {
        operationId: 'listGroups',
        querystring: Type.Object({
          after: Type.Optional(Type.Integer({ minimum: 1 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 40 })),
          search: Type.Optional(Type.String({ maxLength: 80 })),
        }),
        response: { 200: Type.Object({ groups: Type.Array(Group), nextCursor: Cursor }), ...errors },
      },
    },
    (request, reply) =>
      safely(reply, async () => {
        const page = await broker.groups.list(
          undefined,
          request.query.after,
          request.query.limit,
          request.query.search,
          await app.reach.organizations(viewerOf(request)),
        );
        // The chat list previews a files-only last message by its files.
        const files = await broker.files.forMessages(
          'group',
          page.groups.flatMap(group => (group.lastMessage ? [group.lastMessage.id] : [])),
        );
        return {
          groups: page.groups.map(group => {
            const view = groupView(group);
            return view.lastMessage
              ? { ...view, lastMessage: withGroupFiles(view.lastMessage, files.get(view.lastMessage.id)) }
              : view;
          }),
          nextCursor: page.nextCursor,
        };
      }),
  );
  app.post<{ Body: Static<typeof Create> }>(
    '/api/groups',
    {
      schema: { operationId: 'createGroup', body: Create, response: { 200: Group, ...errors } },
    },
    (request, reply) =>
      safely(reply, async () => {
        writable();
        const organizationId = await broker.organizations
          .resolve(viewerOf(request), request.body.organizationId)
          .catch(() => {
            throw new SwarmError('missing', 'Organization not found.');
          });
        const group = await broker.groups.create(request.body.name, request.body.agentIds, organizationId);
        announce(group.id);
        return groupView(group);
      }),
  );
  app.get<{ Params: { id: string } }>(
    '/api/groups/:id',
    {
      schema: { operationId: 'getGroup', params: Params, response: { 200: Group, ...errors } },
    },
    (request, reply) => safely(reply, async () => groupView(await broker.groups.get(request.params.id))),
  );
  app.patch<{ Params: { id: string }; Body: Static<typeof Edit> }>(
    '/api/groups/:id',
    {
      schema: { operationId: 'updateGroup', params: Params, body: Edit, response: { 200: Group, ...errors } },
    },
    (request, reply) =>
      safely(reply, async () => {
        writable();
        const group = await broker.groups.update(request.params.id, request.body.name, request.body.agentIds);
        announce(group.id);
        return groupView(group);
      }),
  );
  app.delete<{ Params: { id: string }; Body: { confirmation: string } }>(
    '/api/groups/:id',
    {
      schema: {
        operationId: 'deleteGroup',
        params: Params,
        body: Type.Object(
          { confirmation: Type.String({ minLength: 1, maxLength: 80 }) },
          { additionalProperties: false },
        ),
        response: { 200: Type.Object({ deleted: Type.Boolean() }), ...errors },
      },
    },
    (request, reply) =>
      safely(reply, async () => {
        writable();
        await broker.groups.remove(request.params.id, request.body.confirmation);
        // The group's files go with it.
        await broker.files.deleteChannels([`group:${request.params.id}`]).catch(() => {});
        announceDeleted(request.params.id);
        return { deleted: true };
      }),
  );
  app.get<{ Params: { id: string }; Querystring: { before?: number; limit?: number } }>(
    '/api/groups/:id/messages',
    {
      schema: {
        operationId: 'listGroupMessages',
        params: Params,
        querystring: Type.Object({
          before: Type.Optional(Type.Integer({ minimum: 1 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 40 })),
        }),
        response: { 200: Type.Object({ messages: Type.Array(GroupMessageSchema), nextCursor: Cursor }), ...errors },
      },
    },
    (request, reply) =>
      safely(reply, async () => {
        const page = await broker.groups.history(
          request.params.id,
          undefined,
          request.query.before,
          request.query.limit,
        );
        const files = await broker.files.forMessages(
          'group',
          page.messages.map(message => message.id),
        );
        return {
          messages: page.messages.map(message => withGroupFiles(groupMessageView(message), files.get(message.id))),
          nextCursor: page.nextCursor,
        };
      }),
  );
  app.post<{
    Params: { id: string };
    Body: { message: string; clientMessageId: string; replyToMessageId?: string; fileIds?: string[] };
  }>(
    '/api/groups/:id/messages',
    {
      schema: {
        operationId: 'sendGroupMessage',
        params: Params,
        body: Type.Object(
          {
            message: Type.String({ maxLength: 20000 }),
            clientMessageId: Type.String({ format: 'uuid' }),
            replyToMessageId: Type.Optional(Id),
            fileIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 10 })),
          },
          { additionalProperties: false },
        ),
        response: { 202: Type.Object({ message: GroupMessageSchema, duplicate: Type.Boolean() }), ...errors },
      },
    },
    (request, reply) =>
      safely(
        reply,
        async () => {
          writable();
          const fileIds = request.body.fileIds ?? [];
          if (!request.body.message.trim() && !fileIds.length) throw new SwarmError('invalid', 'Message is empty.');
          const publication = await broker.sendHumanGroup(
            request.params.id,
            request.body.message,
            request.body.clientMessageId,
            request.body.replyToMessageId,
            fileIds,
            viewerOf(request).name,
          );
          const files = (await broker.files.forMessages('group', [publication.message.id])).get(publication.message.id);
          return {
            message: withGroupFiles(groupMessageView(publication.message), files),
            duplicate: publication.duplicate,
          };
        },
        202,
      ),
  );
}
