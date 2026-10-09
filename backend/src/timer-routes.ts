import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { PlatformStore } from './platform-store';
import { TIMER_NOTE_MAX, TimerError, type AgentTimers } from './agent-timers';

const error = Type.Object({ message: Type.String() });
const params = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) });
const timer = Type.Object({
  id: Type.String(),
  kind: Type.Union([Type.Literal('timer'), Type.Literal('reminder')]),
  note: Type.String(),
  nextAt: Type.String(),
  everySeconds: Type.Optional(Type.Number()),
  fired: Type.Optional(Type.Integer()),
  total: Type.Optional(Type.Union([Type.Integer(), Type.Literal('unlimited')])),
  createdAt: Type.String(),
});
const listing = Type.Object({ timers: Type.Array(timer) });
const Change = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 64 }),
    cancel: Type.Optional(Type.Literal(true)),
    note: Type.Optional(Type.String({ maxLength: TIMER_NOTE_MAX })),
    nextAt: Type.Optional(Type.String({ format: 'date-time' })),
    everySeconds: Type.Optional(Type.Number({ minimum: 1 })),
    total: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
  },
  { additionalProperties: false },
);

/**
 * The owner's view of an agent's timers and reminders (Agents → agent → Timers, docs/agent-time.md#owner-changes),
 * with changes saved all at once. The agent is told what changed, in its next turn, as a platform event with the
 * owner's authority (it may answer in the private chat).
 */
export function registerTimerRoutes(
  app: FastifyInstance,
  database: PlatformStore,
  timers: AgentTimers,
  notify: (agentId: string, text: string) => Promise<unknown>,
) {
  app.get<{ Params: Static<typeof params> }>(
    '/api/agents/:id/timers',
    { schema: { operationId: 'listAgentTimers', params, response: { 200: listing, 404: error } } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!(await database.findAgent(request.params.id))) return reply.code(404).send({ message: 'Agent not found.' });
      return { timers: await timers.list(request.params.id) };
    },
  );
  app.put<{ Params: Static<typeof params>; Body: { changes: Static<typeof Change>[] } }>(
    '/api/agents/:id/timers',
    {
      schema: {
        operationId: 'changeAgentTimers',
        params,
        body: Type.Object(
          { changes: Type.Array(Change, { minItems: 1, maxItems: 25 }) },
          { additionalProperties: false },
        ),
        response: { 200: listing, 400: error, 404: error },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const agentId = request.params.id;
      if (!(await database.findAgent(agentId))) return reply.code(404).send({ message: 'Agent not found.' });
      let said: string[];
      try {
        said = await timers.edit(agentId, request.body.changes);
      } catch (failure) {
        if (failure instanceof TimerError) return reply.code(400).send({ message: failure.message });
        throw failure;
      }
      if (said.length)
        // Told after the change is saved; a notice that cannot start now is not worth failing the save for.
        await notify(
          agentId,
          `Your owner changed your timers and reminders from your settings:\n${said.map(line => `- ${line}`).join('\n')}\nlist_timers shows them now. Adjust your plans to match; message your owner only if something needs their attention.`,
        ).catch(() => {});
      return { timers: await timers.list(agentId) };
    },
  );
}
