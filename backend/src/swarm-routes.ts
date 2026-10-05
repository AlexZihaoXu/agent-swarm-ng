import { viewerOf } from './users/reach';
import { AroundParam } from './search/schema';
import type { FastifyInstance } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { messageText } from './message-text';
import { AvatarSchema } from './agent-avatar';
import { SwarmError, type SwarmStore } from './swarm-store';
import type { PlatformStore } from './platform-store';
import { dmReply } from './reply-preview';
import { FileSchema } from './files/routes';
import type { FileStore } from './files/store';
const Id = Type.String({ minLength: 1, maxLength: 100 });
const Params = Type.Object({ id: Id });
const ErrorResponse = Type.Object({ message: Type.String() });
const Settings = Type.Object({
  avatar: Type.Union([AvatarSchema, Type.Null()]),
  allowedDmAgents: Type.Array(Type.Object({ id: Type.String(), name: Type.String() })),
});
const Update = Type.Object(
  {
    avatar: Type.Optional(AvatarSchema),
    allowedDmAgentIds: Type.Optional(Type.Array(Id, { maxItems: 100, uniqueItems: true })),
  },
  { additionalProperties: false, minProperties: 1 },
);
const DmReply = Type.Union([
  Type.Object({ id: Type.String(), senderId: Type.String(), senderName: Type.String(), text: Type.String() }),
  Type.Null(),
]);
const DmMessage = Type.Object({
  id: Type.String(),
  sequence: Type.Integer(),
  conversationId: Type.String(),
  senderId: Type.String(),
  recipientId: Type.String(),
  senderName: Type.String(),
  recipientName: Type.String(),
  text: Type.String(),
  status: Type.String(),
  timestamp: Type.Number(),
  replyTo: DmReply,
  files: Type.Optional(Type.Array(FileSchema)),
});
export function registerSwarmRoutes(
  app: FastifyInstance,
  swarm: SwarmStore,
  database: PlatformStore,
  active: Set<string>,
  closing: () => boolean,
  files: FileStore,
) {
  app.get<{ Params: { id: string } }>(
    '/api/agents/:id/settings',
    {
      schema: {
        operationId: 'getAgentSettings',
        params: Params,
        response: { 200: Settings, 404: ErrorResponse, 503: ErrorResponse },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return await swarm.settings(request.params.id);
      } catch (error) {
        return reply
          .code(error instanceof SwarmError && error.code === 'missing' ? 404 : 503)
          .send({ message: 'Could not load agent settings.' });
      }
    },
  );
  app.patch<{ Params: { id: string }; Body: Static<typeof Update> }>(
    '/api/agents/:id/settings',
    {
      schema: {
        operationId: 'updateAgentSettings',
        params: Params,
        body: Update,
        response: { 200: Settings, 400: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 503: ErrorResponse },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const id = request.params.id;
      if (closing()) return reply.code(503).send({ message: 'The backend is shutting down.' });
      if (active.has(id)) return reply.code(409).send({ message: 'The agent is being updated. Try again shortly.' });
      active.add(id);
      try {
        return await swarm.updateSettings(id, request.body);
      } catch (error) {
        if (error instanceof SwarmError)
          return reply.code(error.code === 'missing' ? 404 : 400).send({ message: error.message });
        return reply.code(503).send({ message: 'Could not save agent settings.' });
      } finally {
        active.delete(id);
      }
    },
  );
  app.get<{ Params: { id: string }; Querystring: { after?: number } }>(
    '/api/agents/:id/dm-peers',
    {
      schema: {
        operationId: 'listAgentDmConversations',
        params: Params,
        querystring: Type.Object({ after: Type.Optional(Type.Integer({ minimum: 1 })) }),
        response: {
          200: Type.Object({
            peers: Type.Array(
              Type.Object({
                id: Type.String(),
                name: Type.String(),
                avatar: Type.Union([AvatarSchema, Type.Null()]),
                channelId: Type.String(),
              }),
            ),
            nextCursor: Type.Union([Type.Integer(), Type.Null()]),
          }),
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!(await database.findAgent(request.params.id))) return reply.code(404).send({ message: 'Agent not found.' });
      const page = await swarm.dmPeers(request.params.id, request.query.after);
      // Only peers the person reaches (docs/users.md): a DM with another owner's agent (from before a move) is not theirs.
      const viewer = viewerOf(request);
      const peers = [];
      for (const peer of page.peers) if (await app.reach.agent(viewer, peer.id)) peers.push(peer);
      return {
        peers: peers.map(peer => ({
          id: peer.id,
          name: peer.name,
          avatar: peer.avatar ? JSON.parse(peer.avatar) : null,
          channelId: peer.channels[0].id,
        })),
        nextCursor: page.nextCursor,
      };
    },
  );
  app.get<{ Params: { id: string }; Querystring: { before?: number } }>(
    '/api/agents/:id/dm-inbox',
    {
      schema: {
        operationId: 'listReceivedAgentMessages',
        params: Params,
        querystring: Type.Object({ before: Type.Optional(Type.Integer({ minimum: 1 })) }),
        response: {
          200: Type.Object({
            messages: Type.Array(
              Type.Object({
                id: Type.String(),
                sequence: Type.Integer(),
                conversationId: Type.String(),
                senderId: Type.String(),
                senderName: Type.String(),
                senderAvatar: Type.Union([AvatarSchema, Type.Null()]),
                preview: Type.String(),
                status: Type.String(),
                timestamp: Type.Number(),
                replyTo: DmReply,
              }),
            ),
            nextCursor: Type.Union([Type.Integer(), Type.Null()]),
          }),
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!(await database.findAgent(request.params.id))) return reply.code(404).send({ message: 'Agent not found.' });
      const page = await swarm.received(request.params.id, request.query.before);
      const viewer = viewerOf(request);
      const messages = [];
      for (const message of page.messages) if (await app.reach.agent(viewer, message.senderId)) messages.push(message);
      return {
        messages: messages.map(message => ({
          id: message.id,
          sequence: message.sequence,
          conversationId: message.conversationId,
          senderId: message.senderId,
          senderName: message.sender.name,
          senderAvatar: message.sender.avatar ? JSON.parse(message.sender.avatar) : null,
          preview: messageText(message.text, 0, 320).text + (message.text.length > 320 ? '…' : ''),
          status: message.status,
          timestamp: message.createdAt.getTime(),
          replyTo: dmReply(message),
        })),
        nextCursor: page.nextCursor,
      };
    },
  );
  app.get<{
    Params: { id: string; peerId: string };
    Querystring: { before?: number; limit?: number; around?: string };
  }>(
    '/api/agents/:id/dms/:peerId',
    {
      schema: {
        operationId: 'listAgentDirectMessages',
        params: Type.Object({ id: Id, peerId: Id }),
        querystring: Type.Object({
          before: Type.Optional(Type.Integer({ minimum: 1 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 40 })),
          around: Type.Optional(AroundParam),
        }),
        response: {
          200: Type.Object({ messages: Type.Array(DmMessage), nextCursor: Type.Union([Type.Integer(), Type.Null()]) }),
          400: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (request.params.id === request.params.peerId)
        return reply.code(400).send({ message: 'Choose another agent.' });
      if (!(await database.findAgent(request.params.id)) || !(await database.findAgent(request.params.peerId)))
        return reply.code(404).send({ message: 'Agent not found.' });
      const page = request.query.around
        ? await swarm.historyAround(
            request.params.id,
            request.params.peerId,
            request.query.around,
            request.query.before,
          )
        : await swarm.history(request.params.id, request.params.peerId, request.query.before, request.query.limit);
      if (!page) return reply.code(404).send({ message: 'Message not found in this conversation.' });
      const attached = await files.forMessages(
        'dm',
        page.messages.map(message => message.id),
      );
      return {
        messages: page.messages.map(message => ({
          id: message.id,
          sequence: message.sequence,
          conversationId: message.conversationId,
          senderId: message.senderId,
          recipientId: message.recipientId,
          senderName: message.sender.name,
          recipientName: message.recipient.name,
          text: message.text,
          status: message.status,
          timestamp: message.createdAt.getTime(),
          replyTo: dmReply(message),
          ...(attached.has(message.id) ? { files: attached.get(message.id) } : {}),
        })),
        nextCursor: page.nextCursor,
      };
    },
  );
}
