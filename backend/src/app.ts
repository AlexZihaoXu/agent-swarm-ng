import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import { Type } from '@sinclair/typebox';
import { registerModelEndpoints } from './model-endpoints';
import type { EndpointStore } from './endpoint-store';
import { registerChat } from './chat';
import type { PlatformStore } from './platform-store';
import { CodexProvider } from './codex-provider';
import { registerCodex } from './codex-routes';
import { ActivityEntrySchema } from './agent-activity';

export async function buildApp({ fetcher, endpointStore, database, codex = new CodexProvider() }: { fetcher?: typeof fetch; endpointStore?: EndpointStore; database?: PlatformStore; codex?: CodexProvider } = {}) {
  const app = Fastify({ logger: true });
  await app.register(swagger, {
    openapi: { info: { title: 'Agent Swarm API', version: '0.1.0' }, components: { schemas: { AgentActivityEntry: ActivityEntrySchema } } },
  });

  app.get('/api/health', {
    schema: {
      operationId: 'getHealth',
      response: { 200: Type.Object({ status: Type.Literal('ok') }) },
    },
  }, async () => ({ status: 'ok' as const }));

  registerModelEndpoints(app, fetcher, endpointStore);
  registerCodex(app, codex);
  registerChat(app, endpointStore, database, codex);

  await app.ready();
  return app;
}
