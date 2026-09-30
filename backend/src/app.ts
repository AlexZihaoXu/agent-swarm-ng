import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import websocket from '@fastify/websocket';
import { registerTerminalStreams } from './computer-terminal-stream';
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
import { allowedHosts } from './host-policy';
import { SwarmSettingsStore } from './swarm-settings';
import { registerSwarmSettingsRoutes } from './swarm-settings-routes';
import { FileStore } from './files/store';
import { BlobStore } from './files/blob-store';
import { registerFileRoutes } from './files/routes';
import { Scratchpad } from './scratchpad';
import { DiscordTokenStore } from './discord/token-store';
import { DiscordStore } from './discord/store';
import { DiscordConnections } from './discord/connections';
import { registerDiscordRoutes } from './discord/routes';

export async function buildApp({
  fetcher,
  endpointStore,
  database,
  codex = new CodexProvider(),
  computerController,
  discordApi,
}: {
  fetcher?: typeof fetch;
  endpointStore?: EndpointStore;
  database?: PlatformStore;
  codex?: CodexProvider;
  computerController?: ComputerController | null;
  /** Discord's REST base (tests point it at a mock). */
  discordApi?: string;
} = {}) {
  const app = Fastify({ logger: true });
  const hostAllowed = allowedHosts();
  // Runs for every route, including WebSocket upgrades.
  app.addHook('onRequest', async (request, reply) => {
    if (!hostAllowed(request.headers.host))
      return reply.code(403).send({ message: 'This host name is not allowed. Add it to ALLOWED_HOSTS.' });
  });
  const platform = database ?? new PlatformStore();
  await app.register(websocket, { options: { maxPayload: 16384, perMessageDeflate: false } });
  await app.register(swagger, {
    openapi: {
      info: { title: 'Agent Swarm NG API', version: '0.1.0' },
      components: { schemas: { AgentActivityEntry: ActivityEntrySchema } },
    },
  });

  app.get(
    '/api/health',
    {
      schema: {
        operationId: 'getHealth',
        response: { 200: Type.Object({ status: Type.Literal('ok') }) },
      },
    },
    async () => ({ status: 'ok' as const }),
  );

  registerModelEndpoints(app, fetcher, endpointStore, async id => {
    await platform.initialize();
    return platform.client.agent.count({ where: { endpointId: id } });
  });
  registerCodex(app, codex);
  const controller = computerController === undefined ? computerControllerFromEnv() : computerController;
  const computers = new ComputerUseService(platform, controller?.runtime ?? null);
  const screenshots = new ScreenshotPool(join(platform.dataDirectory, 'computer-screenshots'));
  const swarmSettings = new SwarmSettingsStore(platform);
  const files = new FileStore(platform, new BlobStore(join(platform.dataDirectory, 'files')), swarmSettings);
  // Uploads a restart interrupted leave temporary files; remove them before any new upload can start.
  await files.blobs.clearTemporary();
  registerFileRoutes(app, platform, files, new Scratchpad(platform, swarmSettings));
  registerSwarmSettingsRoutes(app, swarmSettings);
  // Each agent's own Discord bot: tokens beside the database, connections owned by the backend.
  const discordTokens = new DiscordTokenStore(join(platform.dataDirectory, 'discord-bots.json'));
  const discordStore = new DiscordStore(platform);
  const discord = new DiscordConnections(discordTokens, discordStore, { api: discordApi });
  registerChat(app, endpointStore, platform, codex, computers, screenshots, files, controller, {
    store: discordStore,
    connections: discord,
  });
  registerComputerRoutes(app, platform, controller, computers, swarmSettings);
  registerComputerUseRoutes(app, computers, screenshots);
  registerTerminalStreams(app, computers, controller);
  registerKnowledgeRoutes(app);
  registerDiscordRoutes(app, platform, discordStore, discordTokens, discord);
  app.addHook('onListen', async () => {
    await discord.start();
  });
  app.addHook('onClose', async () => {
    await discord.close();
  });

  await app.ready();
  return app;
}
