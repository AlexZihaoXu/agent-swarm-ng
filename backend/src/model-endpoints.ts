import type { FastifyInstance } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { EndpointStore, endpointView } from './endpoint-store';
import { readModelCatalog } from './model-catalog';
import { isOpenRouter, openRouterCatalog } from './openrouter';

const ConnectionBody = Type.Object(
  {
    baseUrl: Type.String({ minLength: 1, maxLength: 2048 }),
    apiKey: Type.Optional(Type.String({ maxLength: 4096, pattern: '^[^\\r\\n]*$' })),
    endpointId: Type.Optional(Type.String({ maxLength: 100 })),
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
  agentsUsing: (endpointId: string) => Promise<number> = async () => 0,
) {
  const View = Type.Object({
    id: Type.String(),
    name: Type.String(),
    baseUrl: Type.String(),
    hasApiKey: Type.Boolean(),
  });
  const SaveBody = Type.Object(
    {
      id: Type.String({ minLength: 1, maxLength: 100, pattern: '^[a-zA-Z0-9-]+$' }),
      name: Type.String({ minLength: 1, maxLength: 100 }),
      baseUrl: ConnectionBody.properties.baseUrl,
      apiKey: ConnectionBody.properties.apiKey,
    },
    { additionalProperties: false },
  );
  app.get(
    '/api/model-endpoints',
    {
      schema: { operationId: 'listModelEndpoints', response: { 200: Type.Array(View) } },
    },
    async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return (await store.read()).map(endpointView);
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
        baseUrl = parseBaseUrl(request.body.baseUrl).toString().replace(/\/+$/, '');
      } catch {
        return reply
          .code(400)
          .send({ message: 'Enter a valid HTTP(S) base URL without credentials, query parameters, or fragments.' });
      }
      return endpointView(
        await store.save({
          ...request.body,
          name: request.body.name.trim(),
          baseUrl,
          apiKey: request.body.apiKey?.trim(),
        }),
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
      const using = await agentsUsing(request.params.id);
      if (using > 0)
        return reply.code(409).send({
          message: `${using} ${using === 1 ? 'agent uses' : 'agents use'} this endpoint. Change ${using === 1 ? 'its' : 'their'} endpoint in Agents, or delete ${using === 1 ? 'it' : 'them'}, first.`,
        });
      await store.remove(request.params.id);
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
          200: Type.Object({ models: Type.Array(Type.String()) }),
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

      const signal = AbortSignal.timeout(10_000);
      try {
        const saved = request.body.endpointId
          ? (await store.read()).find(row => row.id === request.body.endpointId)
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
        return {
          models: openrouter ? openRouterCatalog.remember(rows) : [...new Set(rows.map(row => row.id as string))],
        };
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
