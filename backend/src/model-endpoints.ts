import type { FastifyInstance } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';

const ConnectionBody = Type.Object({
  baseUrl: Type.String({ minLength: 1, maxLength: 2048 }),
  apiKey: Type.Optional(Type.String({ maxLength: 4096, pattern: '^[^\\r\\n]*$' })),
}, { additionalProperties: false });
const ConnectionError = Type.Object({ message: Type.String() });

async function readModels(response: Response): Promise<string[]> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_048_576) {
        await reader.cancel();
        throw new Error('Response too large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!payload || typeof payload !== 'object' || !('data' in payload) || !Array.isArray(payload.data) || payload.data.length > 1000) {
    throw new Error('Invalid model list');
  }
  return [...new Set(payload.data.map((model: unknown) => {
    if (!model || typeof model !== 'object' || !('id' in model) || typeof model.id !== 'string' || !model.id.trim() || model.id.length > 512) {
      throw new Error('Invalid model identifier');
    }
    return model.id;
  }))];
}

export function registerModelEndpoints(app: FastifyInstance, fetcher: typeof fetch = fetch) {
  app.post<{ Body: Static<typeof ConnectionBody> }>('/api/model-endpoints/test', {
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
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    let url: URL;
    try {
      url = new URL(request.body.baseUrl.trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid base URL');
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/models`;
    } catch {
      return reply.code(400).send({ message: 'Enter an HTTP(S) base URL without credentials, query parameters, or fragments.' });
    }

    const signal = AbortSignal.timeout(10_000);
    try {
      const apiKey = request.body.apiKey?.trim();
      const response = await fetcher(url, {
        method: 'GET', redirect: 'error', signal,
        headers: { Accept: 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      });
      if (!response.ok) {
        await response.body?.cancel();
        return reply.code(502).send({ message: `Endpoint returned HTTP ${response.status}. Check the base URL and API key.` });
      }
      return { models: await readModels(response) };
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === 'TimeoutError')) {
        return reply.code(504).send({ message: 'Connection timed out after 10 seconds.' });
      }
      // Never return provider bodies, submitted credentials, or raw network errors.
      return reply.code(502).send({ message: 'Could not read a valid model list. Check the endpoint is reachable from the backend and supports GET /models.' });
    }
  });
}
