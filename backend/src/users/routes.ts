import type { FastifyInstance, FastifyReply } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { PASSWORD_MAX, PASSWORD_MIN } from '../auth/sessions';
import { UserError, type Users } from './store';

const error = Type.Object({ message: Type.String() });
const params = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) });
const Password = Type.String({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX });
const MemoryLimit = Type.Union([Type.Integer({ minimum: 1, maximum: 4096 }), Type.Null()]);
const User = Type.Object({
  id: Type.String(),
  name: Type.String(),
  admin: Type.Boolean(),
  disabled: Type.Boolean(),
  /** The most RAM (GiB) their organizations' computers may have in total; null: no cap. */
  memoryLimitGiB: Type.Union([Type.Integer(), Type.Null()]),
  memoryUsedGiB: Type.Integer(),
  organizations: Type.Array(Type.Object({ id: Type.String(), name: Type.String() })),
  createdAt: Type.String(),
});
const Create = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 64 }),
    password: Password,
    memoryLimitGiB: Type.Optional(MemoryLimit),
  },
  { additionalProperties: false },
);
const Update = Type.Object(
  {
    password: Type.Optional(Password),
    disabled: Type.Optional(Type.Boolean()),
    memoryLimitGiB: Type.Optional(MemoryLimit),
  },
  { additionalProperties: false, minProperties: 1 },
);

/** Settings → Users (docs/users.md#accounts): admin only (users/rules.ts). */
export function registerUserRoutes(app: FastifyInstance, users: Users) {
  const guard = async (reply: FastifyReply, work: () => Promise<unknown>) => {
    reply.header('Cache-Control', 'no-store');
    try {
      return await work();
    } catch (caught) {
      if (caught instanceof UserError) return reply.code(caught.status).send({ message: caught.message });
      throw caught;
    }
  };
  const one = async (id: string) => (await users.list()).find(user => user.id === id)!;
  app.get(
    '/api/users',
    { schema: { operationId: 'listUsers', response: { 200: Type.Object({ users: Type.Array(User) }) } } },
    (_request, reply) => guard(reply, async () => ({ users: await users.list() })),
  );
  app.post<{ Body: Static<typeof Create> }>(
    '/api/users',
    { schema: { operationId: 'createUser', body: Create, response: { 200: User, 400: error, 409: error } } },
    (request, reply) => guard(reply, async () => one(await users.create(request.body))),
  );
  app.patch<{ Params: Static<typeof params>; Body: Static<typeof Update> }>(
    '/api/users/:id',
    {
      schema: {
        operationId: 'updateUser',
        params,
        body: Update,
        response: { 200: User, 400: error, 403: error, 404: error },
      },
    },
    (request, reply) =>
      guard(reply, async () => {
        const { ended } = await users.update(request.params.id, request.body);
        app.endSessions(ended);
        app.reach.forget();
        return one(request.params.id);
      }),
  );
  app.delete<{ Params: Static<typeof params> }>(
    '/api/users/:id',
    {
      schema: {
        operationId: 'deleteUser',
        params,
        response: { 200: Type.Object({ deleted: Type.Boolean() }), 403: error, 404: error },
      },
    },
    (request, reply) =>
      guard(reply, async () => {
        const { ended } = await users.remove(request.params.id);
        app.endSessions(ended);
        app.reach.forget();
        return { deleted: true };
      }),
  );
}
