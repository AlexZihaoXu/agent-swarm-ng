import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { viewerOf } from './users/reach';
import { OrganizationError, type Organizations } from './organizations';

const error = Type.Object({ message: Type.String() });
const params = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) });
const name = Type.Object({ name: Type.String({ minLength: 1, maxLength: 60 }) }, { additionalProperties: false });
const organization = Type.Object({
  id: Type.String(),
  name: Type.String(),
  createdAt: Type.String(),
  /** Its owner (docs/users.md): admin's switcher groups organizations by owner. */
  ownerId: Type.String(),
  ownerName: Type.String(),
  agents: Type.Integer(),
  computers: Type.Integer(),
  groups: Type.Integer(),
});
const list = Type.Object({ organizations: Type.Array(organization) });
const move = Type.Object(
  {
    kind: Type.Union([Type.Literal('agent'), Type.Literal('computer'), Type.Literal('group')]),
    id: Type.String({ minLength: 1, maxLength: 64 }),
    /** false: only list what the move would drop (for the confirmation). */
    apply: Type.Boolean(),
  },
  { additionalProperties: false },
);
const moved = Type.Object({ dropped: Type.Array(Type.String()), moved: Type.Boolean() });

/**
 * Organizations (organizations.ts): people list, create, rename and delete their own (admin: all), and move agents,
 * computers and groups between those they reach (users/rules.ts checks both ends of a move).
 */
export function registerOrganizationRoutes(
  app: FastifyInstance,
  organizations: Organizations,
  /** Why a computer may not move into an organization (its owner's RAM cap), or null. */
  memoryCap?: (computerId: string, organizationId: string) => Promise<string | null>,
) {
  const guard = async (reply: FastifyReply, work: () => Promise<unknown>) => {
    reply.header('Cache-Control', 'no-store');
    try {
      return await work();
    } catch (caught) {
      if (caught instanceof OrganizationError) return reply.code(caught.status).send({ message: caught.message });
      throw caught;
    }
  };
  const all = async (request: FastifyRequest) => ({ organizations: await organizations.list(viewerOf(request)) });
  app.get(
    '/api/organizations',
    { schema: { operationId: 'listOrganizations', response: { 200: list } } },
    (request, reply) => guard(reply, () => all(request)),
  );
  app.post<{ Body: Static<typeof name> }>(
    '/api/organizations',
    { schema: { operationId: 'createOrganization', body: name, response: { 200: list, 400: error } } },
    (request, reply) =>
      guard(reply, async () => {
        await organizations.create(request.body.name, viewerOf(request).userId);
        return all(request);
      }),
  );
  app.patch<{ Params: Static<typeof params>; Body: Static<typeof name> }>(
    '/api/organizations/:id',
    {
      schema: {
        operationId: 'renameOrganization',
        params,
        body: name,
        response: { 200: list, 400: error, 404: error },
      },
    },
    (request, reply) =>
      guard(reply, async () => {
        await organizations.rename(request.params.id, request.body.name);
        return all(request);
      }),
  );
  app.delete<{ Params: Static<typeof params> }>(
    '/api/organizations/:id',
    { schema: { operationId: 'deleteOrganization', params, response: { 200: list, 404: error, 409: error } } },
    (request, reply) =>
      guard(reply, async () => {
        await organizations.remove(request.params.id);
        app.reach.forget();
        return all(request);
      }),
  );
  app.post<{ Params: Static<typeof params>; Body: Static<typeof move> }>(
    '/api/organizations/:id/move',
    {
      schema: {
        operationId: 'moveToOrganization',
        params,
        body: move,
        response: { 200: moved, 404: error, 409: error },
      },
    },
    (request, reply) =>
      guard(reply, async () => {
        // A computer moving to another owner counts against their RAM cap (docs/users.md).
        if (request.body.kind === 'computer' && memoryCap) {
          const problem = await memoryCap(request.body.id, request.params.id);
          if (problem) throw new OrganizationError(problem, 409);
        }
        const result = await organizations.move(
          request.body.kind,
          request.body.id,
          request.params.id,
          request.body.apply,
        );
        if (result.moved) app.reach.forget();
        return result;
      }),
  );
}
