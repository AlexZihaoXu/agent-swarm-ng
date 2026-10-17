import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PlatformStore } from '../platform-store';
import { viewerOf } from '../users/reach';
import { TicketSettings } from '../organization-routes';
import {
  COMMENT_MAX,
  DESCRIPTION_MAX,
  LABEL_MAX,
  LABELS_MAX,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TITLE_MAX,
  TicketError,
  type Tickets,
} from './store';

const error = Type.Object({ message: Type.String() });
const org = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) });
const one = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }), number: Type.Integer({ minimum: 1 }) });
const Status = Type.Union(TICKET_STATUSES.map(value => Type.Literal(value)));
const Priority = Type.Union(TICKET_PRIORITIES.map(value => Type.Literal(value)));
const Labels = Type.Array(Type.String({ maxLength: LABEL_MAX * 2 }), { maxItems: LABELS_MAX * 2 });
/** The owner, one of the organization's agents, or nobody. */
const Assignee = Type.Union([
  Type.Object({ owner: Type.Literal(true) }, { additionalProperties: false }),
  Type.Object({ agentId: Type.String({ minLength: 1, maxLength: 64 }) }, { additionalProperties: false }),
  Type.Null(),
]);
const Link = Type.Object({
  kind: Type.Union([Type.Literal('computer'), Type.Literal('file')]),
  id: Type.String(),
  label: Type.String(),
});
const Summary = Type.Object({
  id: Type.String(),
  number: Type.Integer(),
  /** As shown: the organization's prefix and the number (HOME-14). */
  key: Type.String(),
  title: Type.String(),
  status: Status,
  priority: Priority,
  labels: Type.Array(Type.String()),
  links: Type.Array(Link),
  assignee: Type.Union([
    Type.Object({
      kind: Type.Union([Type.Literal('owner'), Type.Literal('agent')]),
      id: Type.String(),
      name: Type.String(),
    }),
    Type.Null(),
  ]),
  /** Who wrote its title and description; `trusted` when that is the organization's owner. */
  writer: Type.Object({
    kind: Type.Union([Type.Literal('person'), Type.Literal('agent')]),
    id: Type.String(),
    name: Type.String(),
    trusted: Type.Boolean(),
  }),
  createdBy: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
const Detail = Type.Object({
  ticket: Type.Intersect([Summary, Type.Object({ description: Type.String() })]),
  events: Type.Array(
    Type.Object({
      sequence: Type.Integer(),
      id: Type.String(),
      /** comment, or an activity entry: created, status, assignee, priority, labels, link, title, description, woken. */
      kind: Type.String(),
      author: Type.Object({
        kind: Type.Union([Type.Literal('person'), Type.Literal('agent'), Type.Literal('platform')]),
        id: Type.String(),
        name: Type.String(),
      }),
      text: Type.String(),
      trusted: Type.Boolean(),
      createdAt: Type.String(),
    }),
  ),
  olderEvents: Type.Boolean(),
});
const Create = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: TITLE_MAX }),
    description: Type.Optional(Type.String({ maxLength: DESCRIPTION_MAX })),
    status: Type.Optional(Status),
    priority: Type.Optional(Priority),
    labels: Type.Optional(Labels),
    assignee: Type.Optional(Assignee),
  },
  { additionalProperties: false },
);
const Patch = Type.Object(
  {
    title: Type.Optional(Type.String({ minLength: 1, maxLength: TITLE_MAX })),
    description: Type.Optional(Type.String({ maxLength: DESCRIPTION_MAX })),
    status: Type.Optional(Status),
    priority: Type.Optional(Priority),
    labels: Type.Optional(Labels),
    assignee: Type.Optional(Assignee),
    /** Links one of the organization's computers. */
    linkComputer: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    /** Removes a link by its id. */
    unlink: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  },
  { additionalProperties: false, minProperties: 1 },
);

/**
 * The dashboard's Tickets (docs/tickets.md): an organization's board, read and changed by the people who reach it
 * (users/rules.ts checks the organization). Agents change tickets through their tools only.
 */
export function registerTicketRoutes(app: FastifyInstance, tickets: Tickets, database: PlatformStore) {
  const guard = async (reply: FastifyReply, work: () => Promise<unknown>) => {
    reply.header('Cache-Control', 'no-store');
    try {
      return await work();
    } catch (caught) {
      if (caught instanceof TicketError) return reply.code(caught.status).send({ message: caught.message });
      throw caught;
    }
  };
  const person = (request: Parameters<typeof viewerOf>[0]) => {
    const viewer = viewerOf(request);
    return { kind: 'person' as const, userId: viewer.userId, name: viewer.name };
  };
  app.get<{ Params: Static<typeof org> }>(
    '/api/organizations/:id/tickets',
    {
      schema: {
        operationId: 'listTickets',
        params: org,
        response: {
          200: Type.Object({ settings: TicketSettings, tickets: Type.Array(Summary), truncated: Type.Boolean() }),
          404: error,
        },
      },
    },
    (request, reply) => guard(reply, () => tickets.list(request.params.id)),
  );
  app.post<{ Params: Static<typeof org>; Body: Static<typeof Create> }>(
    '/api/organizations/:id/tickets',
    {
      schema: {
        operationId: 'createTicket',
        params: org,
        body: Create,
        response: { 200: Detail, 400: error, 404: error, 409: error },
      },
    },
    (request, reply) => guard(reply, () => tickets.create(request.params.id, person(request), request.body)),
  );
  app.get<{ Params: Static<typeof one> }>(
    '/api/organizations/:id/tickets/:number',
    { schema: { operationId: 'getTicket', params: one, response: { 200: Detail, 404: error } } },
    (request, reply) => guard(reply, () => tickets.get(request.params.id, request.params.number)),
  );
  app.patch<{ Params: Static<typeof one>; Body: Static<typeof Patch> }>(
    '/api/organizations/:id/tickets/:number',
    {
      schema: {
        operationId: 'updateTicket',
        params: one,
        body: Patch,
        response: { 200: Detail, 400: error, 404: error, 409: error },
      },
    },
    (request, reply) =>
      guard(reply, async () => {
        const { linkComputer, unlink, ...patch } = request.body;
        const computer = linkComputer
          ? await database.client.computer.findUnique({ where: { id: linkComputer }, select: { id: true, name: true } })
          : null;
        if (linkComputer && !computer) throw new TicketError('That computer is not in this organization.');
        return tickets.update(request.params.id, request.params.number, person(request), {
          ...patch,
          ...(computer ? { addLinks: [{ kind: 'computer' as const, id: computer.id, label: computer.name }] } : {}),
          ...(unlink ? { removeLinks: [unlink] } : {}),
        });
      }),
  );
  app.delete<{ Params: Static<typeof one> }>(
    '/api/organizations/:id/tickets/:number',
    {
      schema: {
        operationId: 'deleteTicket',
        params: one,
        response: { 200: Type.Object({ deleted: Type.Boolean() }), 404: error },
      },
    },
    (request, reply) =>
      guard(reply, async () => {
        await tickets.remove(request.params.id, request.params.number);
        return { deleted: true };
      }),
  );
  app.post<{ Params: Static<typeof one>; Body: { text: string } }>(
    '/api/organizations/:id/tickets/:number/comments',
    {
      schema: {
        operationId: 'commentOnTicket',
        params: one,
        body: Type.Object(
          { text: Type.String({ minLength: 1, maxLength: COMMENT_MAX }) },
          { additionalProperties: false },
        ),
        response: { 200: Detail, 400: error, 404: error, 409: error },
      },
    },
    (request, reply) =>
      guard(reply, () => tickets.comment(request.params.id, request.params.number, person(request), request.body.text)),
  );
}
