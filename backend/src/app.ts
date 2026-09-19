import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import { Type } from '@sinclair/typebox';

export async function buildApp() {
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

  await app.ready();
  return app;
}
