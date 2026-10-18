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
  REFS_MAX,
  RELATION_KINDS,
  RELATIONS_MAX,
  STATE_CATEGORIES,
  STATE_COLORS,
  STATE_NAME_MAX,
  TICKET_PRIORITIES,
  TITLE_MAX,
  TicketError,
  type Tickets,
} from './store';

const error = Type.Object({ message: Type.String() });
const org = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) });
const one = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }), number: Type.Integer({ minimum: 1 }) });
const comment = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 64 }),
  number: Type.Integer({ minimum: 1 }),
  commentId: Type.String({ minLength: 1, maxLength: 64 }),
});
const Number_ = Type.Integer({ minimum: 1 });
const Relation = Type.Union(RELATION_KINDS.map(value => Type.Literal(value)));
const RelationInput = Type.Object({ kind: Relation, number: Number_ }, { additionalProperties: false });
/** A due date: a calendar day in the owner's time zone. */
const Due = Type.Union([Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }), Type.Null()]);
/** A workflow state of the organization, by id or name (case-insensitive). */
const Status = Type.String({ minLength: 1, maxLength: 64 });
const Category = Type.Union(STATE_CATEGORIES.map(value => Type.Literal(value)));
const Color = Type.Union(STATE_COLORS.map(value => Type.Literal(value)));
/** A ticket's state: a column of the board, in a fixed category (docs/tickets.md#workflow). */
const State = Type.Object({ id: Type.String(), name: Type.String(), color: Type.String(), category: Category });
const States = Type.Object({
  states: Type.Array(Type.Intersect([State, Type.Object({ notifyOnEnter: Type.Boolean() })])),
});
const Priority = Type.Union(TICKET_PRIORITIES.map(value => Type.Literal(value)));
/** Another ticket in a list (a sub-issue, a relation, a reference). */
const Brief = Type.Object({
  number: Type.Integer(),
  key: Type.String(),
  title: Type.String(),
  state: State,
  archived: Type.Boolean(),
});
const Labels = Type.Array(Type.String({ maxLength: LABEL_MAX * 2 }), { maxItems: LABELS_MAX * 2 });
/** The owner, one of the organization's agents, or nobody. */
const Assignee = Type.Union([
  Type.Object({ owner: Type.Literal(true) }, { additionalProperties: false }),
  Type.Object({ agentId: Type.String({ minLength: 1, maxLength: 64 }) }, { additionalProperties: false }),
  Type.Null(),
]);
const Link = Type.Object({
  kind: Type.Union([Type.Literal('computer'), Type.Literal('file'), Type.Literal('message')]),
  id: Type.String(),
  label: Type.String(),
  /** A message's conversation: a private chat (its channel and agent) or a group chat. */
  conversation: Type.Optional(
    Type.Object({
      kind: Type.Union([Type.Literal('chat'), Type.Literal('group')]),
      id: Type.String(),
      agentId: Type.Optional(Type.String()),
      name: Type.String(),
    }),
  ),
});
const Summary = Type.Object({
  id: Type.String(),
  number: Type.Integer(),
  /** As shown: the organization's prefix and the number (HOME-14). */
  key: Type.String(),
  title: Type.String(),
  state: State,
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
  /** The ticket it is a sub-issue of. */
  parent: Type.Union([Brief, Type.Null()]),
  /** Its due date (YYYY-MM-DD, the owner's calendar day). */
  due: Type.Union([Type.String(), Type.Null()]),
  /** Archived (hidden from the board unless asked for): when and by whom. */
  archived: Type.Union([Type.Object({ at: Type.String(), by: Type.String() }), Type.Null()]),
  /** Its sub-issues: completed, of those not canceled. */
  subIssues: Type.Object({ done: Type.Integer(), total: Type.Integer() }),
  /** An open ticket blocks it. */
  blocked: Type.Boolean(),
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
  children: Type.Array(Type.Intersect([Brief, Type.Object({ assignee: Type.Index(Summary, ['assignee']) })])),
  relations: Type.Array(Type.Intersect([Brief, Type.Object({ kind: Relation })])),
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
      /** A comment its author edited. */
      editedAt: Type.Optional(Type.String()),
      /** A deleted comment (its text is gone): who deleted it and when. */
      deleted: Type.Optional(Type.Object({ by: Type.String(), at: Type.String() })),
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
    /** The parent ticket's number: a sub-issue of it. */
    parent: Type.Optional(Number_),
    due: Type.Optional(Due),
    /** Links a chat message of the organization (Create ticket from message). */
    linkMessage: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
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
    /** The parent ticket's number, or null for none. */
    parent: Type.Optional(Type.Union([Number_, Type.Null()])),
    due: Type.Optional(Due),
    addRelations: Type.Optional(Type.Array(RelationInput, { maxItems: RELATIONS_MAX })),
    removeRelations: Type.Optional(Type.Array(RelationInput, { maxItems: RELATIONS_MAX })),
    /** Archive (true) or restore (false); other changes leave an archived ticket archived. */
    archived: Type.Optional(Type.Boolean()),
    /** Tick or untick the description's checklist items (from 1, in order); its writer stays. */
    checklist: Type.Optional(
      Type.Array(
        Type.Object({ item: Type.Integer({ minimum: 1 }), done: Type.Boolean() }, { additionalProperties: false }),
        { minItems: 1, maxItems: 50 },
      ),
    ),
    /**
     * Where it lands in its (new) state's column (dragging on the board): right below the ticket numbered `after`,
     * else right above `before`, else on top.
     */
    place: Type.Optional(
      Type.Object(
        {
          after: Type.Optional(Type.Integer({ minimum: 1 })),
          before: Type.Optional(Type.Integer({ minimum: 1 })),
        },
        { additionalProperties: false },
      ),
    ),
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
  app.get<{ Params: Static<typeof org>; Querystring: { q?: string; archived?: '1' } }>(
    '/api/organizations/:id/tickets',
    {
      schema: {
        operationId: 'listTickets',
        params: org,
        /** `q`: words in the title or description, or a ticket as shown (HOME-14); `archived=1`: archived ones too. */
        querystring: Type.Object(
          { q: Type.Optional(Type.String({ maxLength: 200 })), archived: Type.Optional(Type.Literal('1')) },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            settings: TicketSettings,
            /** The board's workflow states, in board order (by category, then position). */
            states: States.properties.states,
            tickets: Type.Array(Summary),
            truncated: Type.Boolean(),
          }),
          404: error,
        },
      },
    },
    (request, reply) =>
      guard(reply, () =>
        tickets.list(request.params.id, {
          order: 'board',
          query: request.query.q,
          archived: request.query.archived === '1',
        }),
      ),
  );
  // The workflow editor (Organization → Tickets, docs/tickets.md#workflow): states added, changed and deleted.
  const stateParams = Type.Object({
    id: Type.String({ minLength: 1, maxLength: 64 }),
    stateId: Type.String({ minLength: 1, maxLength: 64 }),
  });
  const StateName = Type.String({ minLength: 1, maxLength: STATE_NAME_MAX });
  const NewState = Type.Object(
    { name: StateName, category: Category, color: Type.Optional(Color) },
    { additionalProperties: false },
  );
  const StatePatch = Type.Object(
    {
      name: Type.Optional(StateName),
      color: Type.Optional(Color),
      notifyOnEnter: Type.Optional(Type.Boolean()),
      /** Its index within its category (dragging in the editor). */
      position: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
    },
    { additionalProperties: false, minProperties: 1 },
  );
  app.post<{ Params: Static<typeof org>; Body: Static<typeof NewState> }>(
    '/api/organizations/:id/ticket-states',
    {
      schema: {
        operationId: 'addTicketState',
        params: org,
        body: NewState,
        response: { 200: States, 400: error, 404: error, 409: error },
      },
    },
    (request, reply) => guard(reply, async () => ({ states: await tickets.addState(request.params.id, request.body) })),
  );
  app.patch<{ Params: Static<typeof stateParams>; Body: Static<typeof StatePatch> }>(
    '/api/organizations/:id/ticket-states/:stateId',
    {
      schema: {
        operationId: 'updateTicketState',
        params: stateParams,
        body: StatePatch,
        response: { 200: States, 400: error, 404: error, 409: error },
      },
    },
    (request, reply) =>
      guard(reply, async () => ({
        states: await tickets.updateState(request.params.id, request.params.stateId, request.body),
      })),
  );
  app.delete<{ Params: Static<typeof stateParams>; Querystring: { moveTo?: string } }>(
    '/api/organizations/:id/ticket-states/:stateId',
    {
      schema: {
        operationId: 'deleteTicketState',
        params: stateParams,
        /** `moveTo`: the state its tickets move to (needed when it has any). */
        querystring: Type.Object(
          { moveTo: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })) },
          { additionalProperties: false },
        ),
        response: { 200: States, 400: error, 404: error, 409: error },
      },
    },
    (request, reply) =>
      guard(reply, async () => ({
        states: await tickets.deleteState(
          request.params.id,
          request.params.stateId,
          person(request),
          request.query.moveTo,
        ),
      })),
  );
  // Ticket chips (docs/tickets.md#references): the organization's tickets named in one of its conversations.
  app.get<{ Params: Static<typeof org>; Querystring: { numbers: string } }>(
    '/api/organizations/:id/ticket-refs',
    {
      schema: {
        operationId: 'ticketRefs',
        params: org,
        querystring: Type.Object(
          { numbers: Type.String({ pattern: `^\\d{1,9}(,\\d{1,9}){0,${REFS_MAX - 1}}$` }) },
          { additionalProperties: false },
        ),
        response: { 200: Type.Object({ tickets: Type.Array(Brief) }), 404: error },
      },
    },
    (request, reply) =>
      guard(reply, async () => ({
        tickets: await tickets.refs(request.params.id, request.query.numbers.split(',').map(Number)),
      })),
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
    (request, reply) =>
      guard(reply, () => {
        const { linkMessage, ...input } = request.body;
        return tickets.create(request.params.id, person(request), {
          ...input,
          ...(linkMessage ? { links: [{ kind: 'message', id: linkMessage, label: '' }] } : {}),
        });
      }),
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
  // One's own comment: edited, or deleted (also by the owner) leaving a tombstone.
  app.patch<{ Params: Static<typeof comment>; Body: { text: string } }>(
    '/api/organizations/:id/tickets/:number/comments/:commentId',
    {
      schema: {
        operationId: 'editTicketComment',
        params: comment,
        body: Type.Object(
          { text: Type.String({ minLength: 1, maxLength: COMMENT_MAX }) },
          { additionalProperties: false },
        ),
        response: { 200: Detail, 400: error, 403: error, 404: error, 409: error },
      },
    },
    (request, reply) =>
      guard(reply, () =>
        tickets.editComment(
          request.params.id,
          request.params.number,
          request.params.commentId,
          person(request),
          request.body.text,
        ),
      ),
  );
  app.delete<{ Params: Static<typeof comment> }>(
    '/api/organizations/:id/tickets/:number/comments/:commentId',
    {
      schema: {
        operationId: 'deleteTicketComment',
        params: comment,
        response: { 200: Detail, 403: error, 404: error, 409: error },
      },
    },
    (request, reply) =>
      guard(reply, () =>
        tickets.deleteComment(request.params.id, request.params.number, request.params.commentId, person(request)),
      ),
  );
}
