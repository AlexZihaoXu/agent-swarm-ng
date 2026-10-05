import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { EndpointStore, endpointView, LIMIT_RANGES, type SavedEndpoint } from './endpoint-store';
import { detectedLimits } from './endpoint-detection';
import { readModelCatalog } from './model-catalog';
import { isOpenRouter, openRouterCatalog } from './openrouter';
import { isPublicUrl } from './users/public-address';
import { connectionOwner, viewerOf, type Reach } from './users/reach';

const INTERNAL_URL = 'Use a public address: endpoints of users cannot reach the platform or private networks.';

const ConnectionBody = Type.Object(
  {
    baseUrl: Type.String({ minLength: 1, maxLength: 2048 }),
    apiKey: Type.Optional(Type.String({ maxLength: 4096, pattern: '^[^\\r\\n]*$' })),
    endpointId: Type.Optional(Type.String({ maxLength: 100 })),
    /** Whose saved endpoint `endpointId` is: this organization's owner's (default: your own). */
    organizationId: Type.Optional(Type.String({ maxLength: 64 })),
  },
  { additionalProperties: false },
);
const ConnectionError = Type.Object({ message: Type.String() });

function parseBaseUrl(value: string) {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Invalid base URL');
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

export function registerModelEndpoints(
  app: FastifyInstance,
  fetcher: typeof fetch = fetch,
  store = new EndpointStore(),
  /** Agents of this person's organizations on this endpoint. */
  agentsUsing: (endpointId: string, ownerId: string) => Promise<number> = async () => 0,
  reach?: Reach,
) {
  // A person's own endpoints (docs/users.md): admin choosing a model in Sam's organization reads Sam's.
  const ownerFor = (request: FastifyRequest, organizationId?: string) =>
    reach ? connectionOwner(reach, viewerOf(request), organizationId) : Promise.resolve(viewerOf(request).userId);
  const allowedUrl = async (request: FastifyRequest, url: URL) => viewerOf(request).admin || (await isPublicUrl(url));
  const Limits = {
    /** Tokens the model can see at once (docs/development.md#model-limits). */
    contextWindow: Type.Integer(LIMIT_RANGES.contextWindow),
    /** Longest reply in tokens. */
    maxOutputTokens: Type.Integer(LIMIT_RANGES.maxOutputTokens),
    /** The model accepts images. */
    images: Type.Boolean(),
    /** The model reasons (thinking levels). */
    reasoning: Type.Boolean(),
  };
  const View = Type.Object({
    id: Type.String(),
    name: Type.String(),
    baseUrl: Type.String(),
    hasApiKey: Type.Boolean(),
    contextWindow: Type.Optional(Limits.contextWindow),
    maxOutputTokens: Type.Optional(Limits.maxOutputTokens),
    images: Type.Optional(Limits.images),
    reasoning: Type.Optional(Limits.reasoning),
    /** The context size its models reported when last listed, when they all agree. */
    detectedContextWindow: Type.Optional(Type.Integer()),
  });
  const view = (row: SavedEndpoint) => {
    const detected = detectedLimits.endpointContextWindow(row.baseUrl);
    return { ...endpointView(row), ...(detected ? { detectedContextWindow: detected } : {}) };
  };
  const SaveBody = Type.Object(
    {
      id: Type.String({ minLength: 1, maxLength: 100, pattern: '^[a-zA-Z0-9-]+$' }),
      name: Type.String({ minLength: 1, maxLength: 100 }),
      baseUrl: ConnectionBody.properties.baseUrl,
      apiKey: ConnectionBody.properties.apiKey,
      // Left out: keeps the saved value; null: back to what the server reports, or the default.
      contextWindow: Type.Optional(Type.Union([Limits.contextWindow, Type.Null()])),
      maxOutputTokens: Type.Optional(Type.Union([Limits.maxOutputTokens, Type.Null()])),
      images: Type.Optional(Type.Union([Limits.images, Type.Null()])),
      reasoning: Type.Optional(Type.Union([Limits.reasoning, Type.Null()])),
    },
    { additionalProperties: false },
  );
  app.get<{ Querystring: { organizationId?: string } }>(
    '/api/model-endpoints',
    {
      schema: {
        operationId: 'listModelEndpoints',
        querystring: Type.Object({
          /** Whose endpoints: this organization's owner's (default: your own). */
          organizationId: Type.Optional(Type.String({ maxLength: 64 })),
        }),
        response: { 200: Type.Array(View) },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return (await store.readFor(await ownerFor(request, request.query.organizationId))).map(view);
    },
  );
  app.post<{ Body: Static<typeof SaveBody> }>(
    '/api/model-endpoints',
    {
      bodyLimit: 8192,
      schema: { operationId: 'saveModelEndpoint', body: SaveBody, response: { 200: View, 400: ConnectionError } },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      let baseUrl: string;
      try {
        const url = parseBaseUrl(request.body.baseUrl);
        if (!(await allowedUrl(request, url))) return reply.code(400).send({ message: INTERNAL_URL });
        baseUrl = url.toString().replace(/\/+$/, '');
      } catch {
        return reply
          .code(400)
          .send({ message: 'Enter a valid HTTP(S) base URL without credentials, query parameters, or fragments.' });
      }
      return view(
        await store.save(
          {
            ...request.body,
            name: request.body.name.trim(),
            baseUrl,
            apiKey: request.body.apiKey?.trim(),
          },
          viewerOf(request).userId,
        ),
      );
    },
  );
  app.delete<{ Params: { id: string } }>(
    '/api/model-endpoints/:id',
    {
      schema: {
        operationId: 'removeModelEndpoint',
        params: Type.Object({ id: Type.String() }),
        response: { 200: Type.Object({ removed: Type.Boolean() }), 409: ConnectionError },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      // Removing an endpoint (and its saved key) would strand every agent that runs on it, and agents cannot be re-pointed.
      const owner = viewerOf(request).userId;
      const using = await agentsUsing(request.params.id, owner);
      if (using > 0)
        return reply.code(409).send({
          message: `${using} ${using === 1 ? 'agent uses' : 'agents use'} this endpoint. Change ${using === 1 ? 'its' : 'their'} endpoint in Agents, or delete ${using === 1 ? 'it' : 'them'}, first.`,
        });
      await store.remove(request.params.id, owner);
      return { removed: true };
    },
  );
  app.post<{ Body: Static<typeof ConnectionBody> }>(
    '/api/model-endpoints/test',
    {
      bodyLimit: 8192,
      schema: {
        operationId: 'testModelEndpoint',
        body: ConnectionBody,
        response: {
          200: Type.Object({
            models: Type.Array(Type.String()),
            /** The context size each model reports, for the models that report one. */
            details: Type.Optional(Type.Array(Type.Object({ id: Type.String(), contextWindow: Type.Integer() }))),
          }),
          400: ConnectionError,
          502: ConnectionError,
          504: ConnectionError,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      let url: URL;
      try {
        url = parseBaseUrl(request.body.baseUrl);
        url.pathname = `${url.pathname.replace(/\/+$/, '')}/models`;
      } catch {
        return reply
          .code(400)
          .send({ message: 'Enter an HTTP(S) base URL without credentials, query parameters, or fragments.' });
      }
      if (!(await allowedUrl(request, url))) return reply.code(400).send({ message: INTERNAL_URL });

      const signal = AbortSignal.timeout(10_000);
      try {
        const saved = request.body.endpointId
          ? (await store.readFor(await ownerFor(request, request.body.organizationId))).find(
              row => row.id === request.body.endpointId,
            )
          : undefined;
        const sameUrl =
          saved && parseBaseUrl(saved.baseUrl).toString() === parseBaseUrl(request.body.baseUrl).toString();
        const apiKey = request.body.apiKey?.trim() ?? (sameUrl ? saved.apiKey : undefined);
        const response = await fetcher(url, {
          method: 'GET',
          redirect: 'error',
          signal,
          headers: { Accept: 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        });
        if (!response.ok) {
          await response.body?.cancel();
          return reply
            .code(502)
            .send({ message: `Endpoint returned HTTP ${response.status}. Check the base URL and API key.` });
        }
        const openrouter = isOpenRouter(request.body.baseUrl);
        const rows = await readModelCatalog(response, openrouter ? 4 * 1024 * 1024 : undefined);
        if (openrouter) return { models: openRouterCatalog.remember(rows) };
        // OpenRouter's catalog sets its own limits; other servers' reported sizes are remembered for their agents.
        const details = detectedLimits.remember(parseBaseUrl(request.body.baseUrl).toString(), rows);
        return { models: [...new Set(rows.map(row => row.id as string))], ...(details.length ? { details } : {}) };
      } catch (error) {
        if (signal.aborted || (error instanceof Error && error.name === 'TimeoutError')) {
          return reply.code(504).send({ message: 'Connection timed out after 10 seconds.' });
        }
        // Never return provider bodies, submitted credentials, or raw network errors.
        return reply.code(502).send({
          message:
            'Could not read a valid model list. Check the endpoint is reachable from the backend and supports GET /models.',
        });
      }
    },
  );
}
