import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import { Type } from '@sinclair/typebox';
import { registerModelEndpoints } from './model-endpoints';

export async function buildApp({ fetcher }: { fetcher?: typeof fetch } = {}) {
  const app = Fastify({ logger: true });
  await app.register(swagger, {
    openapi: { info: { title: 'Agent Swarm API', version: '0.1.0' } },
  });

  app.get('/api/health', {
    schema: {
      operationId: 'getHealth',
      response: { 200: Type.Object({ status: Type.Literal('ok') }) },
    },
  }, async () => ({ status: 'ok' as const }));

  registerModelEndpoints(app, fetcher);

  await app.ready();
  return app;
}
