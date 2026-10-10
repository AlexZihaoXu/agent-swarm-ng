import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { FastifyRequest } from 'fastify';
import type { Connections } from './users/connections';
import { connectionOwner, viewerOf } from './users/reach';
import { CODEX_ACCOUNT_PATTERN, MAX_CODEX_ACCOUNTS, codexConnectionId } from './codex-provider';

const Status = Type.Object({
  connected: Type.Boolean(),
  /** Who is signed in, from the login's own claims. */
  email: Type.Optional(Type.String()),
  plan: Type.Optional(Type.String()),
  models: Type.Array(Type.String()),
  login: Type.Object({
    state: Type.Union(['idle', 'starting', 'waiting', 'connected', 'error'].map(value => Type.Literal(value))),
    userCode: Type.Optional(Type.String()),
    verificationUri: Type.Optional(Type.String()),
    message: Type.Optional(Type.String()),
  }),
});
const Account = Type.Composite([
  Type.Object({
    /** '' for the first account. */
    account: Type.String(),
    /** The connection id agents choose it by. */
    endpointId: Type.String(),
  }),
  Status,
]);
const Accounts = Type.Object({ accounts: Type.Array(Account), max: Type.Integer() });
const ErrorResponse = Type.Object({ message: Type.String() });
const AccountQuery = Type.Object({
  account: Type.Optional(Type.String({ pattern: `^(${CODEX_ACCOUNT_PATTERN.source.slice(1, -1)})?$` })),
});
type AccountRequest = FastifyRequest<{ Querystring: { account?: string } }>;
class MissingAccount extends Error {}

/**
 * Each person's own ChatGPT logins (docs/users.md#model-connections): their first account and any they added, each
 * its own card in Settings and its own connection for agents. `account` picks one (default: the first).
 */
export function registerCodex(app: FastifyInstance, connections: Connections) {
  const errors = { 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 503: ErrorResponse };
  const schema = { querystring: AccountQuery, response: { 200: Status, ...errors } };
  const own = async (request: AccountRequest) => {
    const owner = viewerOf(request).userId;
    const account = request.query.account ?? '';
    if (!(await connections.codexAccountsOf(owner)).includes(account)) throw new MissingAccount();
    return connections.codex(owner, account);
  };
  const failed = (failure: unknown, message: string) =>
    failure instanceof MissingAccount
      ? { code: 404 as const, message: 'This ChatGPT account was removed.' }
      : { code: 503 as const, message };
  /** The person's accounts with their state; a sign-in in progress is shown only to its person. */
  const list = async (owner: string, viewer: string) => ({
    accounts: await Promise.all(
      (await connections.codexAccountsOf(owner)).map(async account => {
        const status = await connections.codex(owner, account).status();
        return {
          account,
          endpointId: codexConnectionId(account),
          ...status,
          login: owner === viewer ? status.login : { state: 'idle' as const },
        };
      }),
    ),
    max: MAX_CODEX_ACCOUNTS,
  });
  app.addHook('onClose', async () => {
    await connections.close();
  });
  app.register(async routes => {
    routes.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const origin = request.headers.origin;
      if (
        request.headers['sec-fetch-site'] === 'cross-site' ||
        (origin &&
          (() => {
            try {
              return new URL(origin).hostname !== new URL(`http://${request.headers.host}`).hostname;
            } catch {
              return true;
            }
          })())
      )
        return reply.code(403).send({ message: 'Cross-site provider access is not allowed.' });
    });
    const organization = Type.Object({ organizationId: Type.Optional(Type.String({ maxLength: 64 })) });
    routes.get<{ Querystring: { organizationId?: string } }>(
      '/api/providers/openai-codex/accounts',
      {
        schema: {
          operationId: 'listCodexAccounts',
          // Whose logins: this organization's owner's, for choosing an agent's model there (default: your own).
          querystring: organization,
          response: { 200: Accounts, ...errors },
        },
      },
      async (request, reply) => {
        try {
          const owner = await connectionOwner(connections.reach, viewerOf(request), request.query.organizationId);
          return await list(owner, viewerOf(request).userId);
        } catch {
          return reply.code(503).send({ message: 'Could not read provider connection.' });
        }
      },
    );
    routes.post(
      '/api/providers/openai-codex/accounts',
      {
        schema: {
          operationId: 'addCodexAccount',
          body: Type.Object({}, { additionalProperties: false }),
          response: { 200: Accounts, ...errors },
        },
      },
      async (request, reply) => {
        const owner = viewerOf(request).userId;
        try {
          if (!(await connections.codexAccounts.add(owner)))
            return reply.code(409).send({ message: `At most ${MAX_CODEX_ACCOUNTS} ChatGPT accounts.` });
          return await list(owner, owner);
        } catch {
          return reply.code(503).send({ message: 'Could not add the account.' });
        }
      },
    );
    routes.delete<{ Params: { account: string } }>(
      '/api/providers/openai-codex/accounts/:account',
      {
        schema: {
          operationId: 'removeCodexAccount',
          params: Type.Object({ account: Type.String({ pattern: CODEX_ACCOUNT_PATTERN.source }) }),
          response: { 200: Accounts, ...errors },
        },
      },
      async (request, reply) => {
        const owner = viewerOf(request).userId;
        try {
          // The first account stays (Disconnect signs it out); an added one goes with its login.
          if (!(await connections.removeCodexAccount(owner, request.params.account)))
            return reply.code(404).send({ message: 'This ChatGPT account was removed.' });
          return await list(owner, owner);
        } catch {
          return reply.code(503).send({ message: 'Could not remove the account.' });
        }
      },
    );
    routes.get<{ Querystring: { organizationId?: string; account?: string } }>(
      '/api/providers/openai-codex',
      {
        schema: {
          ...schema,
          operationId: 'getCodexProvider',
          querystring: Type.Composite([organization, AccountQuery]),
        },
      },
      async (request, reply) => {
        try {
          const owner = await connectionOwner(connections.reach, viewerOf(request), request.query.organizationId);
          const account = request.query.account ?? '';
          if (!(await connections.codexAccountsOf(owner)).includes(account))
            return reply.code(404).send({ message: 'This ChatGPT account was removed.' });
          const status = await connections.codex(owner, account).status();
          // Someone else's sign-in in progress is theirs alone.
          return owner === viewerOf(request).userId ? status : { ...status, login: { state: 'idle' as const } };
        } catch {
          return reply.code(503).send({ message: 'Could not read provider connection.' });
        }
      },
    );
    routes.post<{ Querystring: { account?: string } }>(
      '/api/providers/openai-codex/login',
      {
        schema: {
          ...schema,
          operationId: 'connectCodexProvider',
          body: Type.Object({}, { additionalProperties: false }),
        },
      },
      async (request, reply) => {
        try {
          const codex = await own(request);
          codex.start();
          return await codex.status();
        } catch (failure) {
          const { code, message } = failed(failure, 'Could not start provider sign-in.');
          return reply.code(code).send({ message });
        }
      },
    );
    routes.delete<{ Querystring: { account?: string } }>(
      '/api/providers/openai-codex/login',
      { schema: { ...schema, operationId: 'cancelCodexLogin' } },
      async (request, reply) => {
        try {
          const codex = await own(request);
          await codex.cancel();
          return await codex.status();
        } catch (failure) {
          const { code, message } = failed(failure, 'Could not cancel sign-in.');
          return reply.code(code).send({ message });
        }
      },
    );
    routes.delete<{ Querystring: { account?: string } }>(
      '/api/providers/openai-codex',
      { schema: { ...schema, operationId: 'disconnectCodexProvider' } },
      async (request, reply) => {
        try {
          const codex = await own(request);
          await codex.disconnect();
          return await codex.status();
        } catch (failure) {
          const { code, message } = failed(failure, 'Could not disconnect provider.');
          return reply.code(code).send({ message });
        }
      },
    );
  });
}
