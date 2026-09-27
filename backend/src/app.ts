import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import { Type } from '@sinclair/typebox';
import { registerModelEndpoints } from './model-endpoints';
import type { EndpointStore } from './endpoint-store';
import { registerChat } from './chat';
import { PlatformStore } from './platform-store';
import { CodexProvider } from './codex-provider';
import { registerCodex } from './codex-routes';
import { ActivityEntrySchema } from './agent-activity';
import { registerComputerRoutes } from './computer-routes';
import { computerControllerFromEnv, type ComputerController } from './computer-controller-client';
import { registerKnowledgeRoutes } from './swarm-knowledge/routes';
import { ComputerUseService } from './computer-use/service';
import { ScreenshotPool } from './computer-use/image-pool';
import { registerComputerUseRoutes } from './computer-use/routes';
import { join } from 'node:path';

export async function buildApp({ fetcher, endpointStore, database, codex = new CodexProvider(), computerController }: { fetcher?: typeof fetch; endpointStore?: EndpointStore; database?: PlatformStore; codex?: CodexProvider; computerController?: ComputerController | null } = {}) {
  const app = Fastify({ logger: true });
  const platform = database ?? new PlatformStore();
  await app.register(swagger, {
    openapi: { info: { title: 'Agent Swarm NG API', version: '0.1.0' }, components: { schemas: { AgentActivityEntry: ActivityEntrySchema } } },
  });

  app.get('/api/health', {
    schema: {
      operationId: 'getHealth',
      response: { 200: Type.Object({ status: Type.Literal('ok') }) },
    },
  }, async () => ({ status: 'ok' as const }));

  registerModelEndpoints(app, fetcher, endpointStore);
  registerCodex(app, codex);
  const controller = computerController === undefined ? computerControllerFromEnv() : computerController;
  const computers = new ComputerUseService(platform, controller?.runtime ?? null);
  const screenshots = new ScreenshotPool(join(platform.dataDirectory, 'computer-screenshots'));
  registerChat(app, endpointStore, platform, codex, computers, screenshots);
  registerComputerRoutes(app, platform, controller, computers);
  registerComputerUseRoutes(app, computers, screenshots);
  registerKnowledgeRoutes(app);

  await app.ready();
  return app;
}
