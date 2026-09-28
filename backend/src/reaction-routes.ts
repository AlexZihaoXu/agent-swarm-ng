import type { FastifyInstance, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { MAX_REACTION_LENGTH, type ReactionStore } from './reaction-store';
import { SwarmError } from './swarm-store';

const Id = Type.String({ minLength: 1, maxLength: 120 });
const Summary = Type.Array(Type.Object({ emoji: Type.String(), count: Type.Integer(), mine: Type.Boolean() }));
const ErrorResponse = Type.Object({ message: Type.String() });
const errors = { 400: ErrorResponse, 404: ErrorResponse, 503: ErrorResponse };
async function respond(reply: FastifyReply, work: () => Promise<unknown>) {
  reply.header('Cache-Control', 'no-store');
  try {
    return await work();
  } catch (error) {
    return reply
      .code(error instanceof SwarmError ? (error.code === 'missing' ? 404 : 400) : 503)
      .send({ message: error instanceof SwarmError ? error.message : 'Could not update reactions.' });
  }
}
export function registerReactionRoutes(
  app: FastifyInstance,
  store: ReactionStore,
  changed: (channelId: string, messageId: string) => void,
  closing: () => boolean,
  notify: (channelId: string, messageId: string, emoji: string) => Promise<void>,
) {
  app.get<{ Params: { channelId: string }; Querystring: { ids: string[] } }>(
    '/api/chats/:channelId/reactions',
    {
      schema: {
        operationId: 'readMessageReactions',
        params: Type.Object({ channelId: Id }),
        querystring: Type.Object({ ids: Type.Array(Id, { minItems: 1, maxItems: 100, uniqueItems: true }) }),
        response: {
          200: Type.Object({ messages: Type.Array(Type.Object({ id: Type.String(), reactions: Summary })) }),
          ...errors,
        },
      },
    },
    (request, reply) =>
      respond(reply, async () => ({
        messages: Object.entries(await store.read(request.params.channelId, request.query.ids)).map(
          ([id, reactions]) => ({ id, reactions }),
        ),
      })),
  );
  app.put<{ Params: { channelId: string; messageId: string }; Body: { emoji: string; active: boolean } }>(
    '/api/chats/:channelId/messages/:messageId/reaction',
    {
      schema: {
        operationId: 'setMessageReaction',
        params: Type.Object({ channelId: Id, messageId: Id }),
        body: Type.Object(
          { emoji: Type.String({ minLength: 1, maxLength: MAX_REACTION_LENGTH }), active: Type.Boolean() },
          { additionalProperties: false },
        ),
        response: { 200: Type.Object({ reactions: Summary }), ...errors },
      },
    },
    (request, reply) =>
      respond(reply, async () => {
        if (closing()) throw new Error('Backend closing.');
        const { channelId, messageId } = request.params;
        const { reactions, changed: mutated } = await store.setDetailed(
          channelId,
          messageId,
          request.body.emoji,
          request.body.active,
        );
        if (mutated) changed(channelId, messageId);
        if (mutated && request.body.active)
          void Promise.resolve()
            .then(() => notify(channelId, messageId, request.body.emoji))
            .catch(() => {});
        return { reactions };
      }),
  );
}
