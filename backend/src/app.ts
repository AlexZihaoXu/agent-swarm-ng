import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import websocket from '@fastify/websocket';
import { registerTerminalStreams } from './computer-terminal-stream';
import { Type } from '@sinclair/typebox';
import { registerModelEndpoints } from './model-endpoints';
import { EndpointStore } from './endpoint-store';
import { Reach } from './users/reach';
import { registerRules } from './users/rules';
import { Connections } from './users/connections';
import { Users } from './users/store';
import { registerUserRoutes } from './users/routes';
import { registerChat } from './chat';
import { PlatformStore } from './platform-store';
import { CodexProvider } from './codex-provider';
import { registerCodex } from './codex-routes';
import { ActivityEntrySchema } from './agent-activity';
import { registerComputerStorageRoutes } from './computer-storage-routes';
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
import { Accounts } from './auth/sessions';
import { registerAuth } from './auth/routes';
import { AuditLog } from './audit/store';
import { registerAudit } from './audit/routes';
import { registerDashboardRoutes } from './dashboard/routes';
import { KnownAddresses } from './security/addresses';
import { Alerts } from './security/alerts';
import { SignInGuard } from './security/guard';
import { registerSecurityRoutes } from './security/routes';
import { AccessLog, registerAccessLog } from './access/log';
import { loadVapidKeys, vapidSubject } from './push/vapid';
import { PushStore } from './push/store';
import { PushSender, type PushTransport } from './push/sender';
import { Presence } from './push/presence';
import { PushNotifier } from './push/notifier';
import { registerPushRoutes } from './push/routes';

export async function buildApp({
  fetcher,
  endpointStore,
  database,
  codex = new CodexProvider(),
  computerController,
  discordApi,
  requireLogin = true,
  pushTransport,
}: {
  fetcher?: typeof fetch;
  endpointStore?: EndpointStore;
  database?: PlatformStore;
  codex?: CodexProvider;
  computerController?: ComputerController | null;
  /** Discord's REST base (tests point it at a mock). */
  discordApi?: string;
  /** Dashboard sign-in for every request (docs/login.md). Only tests of other features turn it off. */
  requireLogin?: boolean;
  /** How push notifications reach push services (tests capture or fake them). */
  pushTransport?: PushTransport;
} = {}) {
  const app = Fastify({ logger: true });
  const hostAllowed = allowedHosts();
  // Runs for every route, including WebSocket upgrades.
  app.addHook('onRequest', async (request, reply) => {
    if (!hostAllowed(request.headers.host))
      return reply.code(403).send({ message: 'This host name is not allowed. Add it to ALLOWED_HOSTS.' });
  });
  const platform = database ?? new PlatformStore();
  // Who may reach what (docs/users.md): every route has a rule; users reach only their own organizations. First, so
  // it sees every route as it is added.
  const reach = new Reach(platform);
  app.decorate('reach', reach);
  registerRules(app, reach);
  await app.register(websocket, { options: { maxPayload: 16384, perMessageDeflate: false } });
  await app.register(swagger, {
    openapi: {
      info: { title: 'Agent Swarm NG API', version: '0.1.0' },
      components: { schemas: { AgentActivityEntry: ActivityEntrySchema } },
    },
  });

  // Before every route, so nothing is reachable without a session (sign-in endpoints and health aside).
  // Every audit event also goes to the server log (docs/audit-log.md).
  const audit = new AuditLog(platform, event => app.log.info({ audit: event }, `audit ${event.kind} ${event.outcome}`));
  app.decorate('audit', audit);
  const addresses = new KnownAddresses(platform);
  const alerts = new Alerts(platform);
  const guard = new SignInGuard(platform, addresses, new SwarmSettingsStore(platform), audit, alerts);
  app.decorate('alerts', alerts);
  const sessions = registerAuth(app, new Accounts(platform), { requireLogin, audit, guard });
  app.decorate('watchSession', sessions.watch);
  app.decorate('endSessions', sessions.end);
  const endpoints = endpointStore ?? new EndpointStore();
  const connections = new Connections(endpoints, reach, codex);
  registerUserRoutes(app, new Users(platform, userId => connections.forgetOwner(userId)));
  registerAudit(app, platform, audit, addresses);
  registerSecurityRoutes(app, platform, addresses, guard, alerts, audit);
  const access = new AccessLog(platform);
  app.decorate('access', access);
  registerAccessLog(app, platform, access, addresses);

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

  registerModelEndpoints(
    app,
    fetcher,
    endpoints,
    async (id, ownerId) => {
      await platform.initialize();
      return platform.client.agent.count({ where: { endpointId: id, organization: { ownerId } } });
    },
    reach,
  );
  registerCodex(app, connections);
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
  const { runs } = registerChat(
    app,
    endpoints,
    platform,
    codex,
    computers,
    screenshots,
    files,
    controller,
    { store: discordStore, connections: discord, tokens: discordTokens },
    connections,
  );
  // Push notifications (docs/notifications.md): they watch the run events and critical events, never the chat path.
  const push = new PushStore(platform);
  // Made or read on first use, not here: building the app (OpenAPI generation) touches no files.
  let keys: ReturnType<typeof loadVapidKeys> | undefined;
  const vapid = () =>
    (keys ??= loadVapidKeys(platform.dataDirectory).catch(error => ((keys = undefined), Promise.reject(error))));
  const presence = new Presence();
  const notifier = new PushNotifier({
    platform,
    reach,
    store: push,
    sender: new PushSender(push, vapid, vapidSubject(), app.log, pushTransport),
    presence,
    log: app.log,
  });
  app.decorate('push', notifier);
  const unsubscribeRuns = runs.subscribe(notifier.observe);
  const unlistenAlerts = alerts.listen(notifier.critical);
  app.addHook('onClose', async () => {
    unsubscribeRuns();
    unlistenAlerts();
    notifier.close();
  });
  registerPushRoutes(app, { keys: vapid, store: push, notifier, presence, platform });
  registerComputerRoutes(app, platform, controller, computers, swarmSettings);
  registerComputerStorageRoutes(app, platform, controller);
  registerComputerUseRoutes(app, computers, screenshots);
  registerTerminalStreams(app, computers, controller);
  registerKnowledgeRoutes(app);
  registerDashboardRoutes(app, platform, endpoints);
  registerDiscordRoutes(app, platform, discordStore, discordTokens, discord, files);
  // Saved Discord messages are kept for Settings → Swarm's period: pruned at start and hourly.
  const pruneDiscord = () =>
    swarmSettings
      .get()
      .then(settings => discordStore.prune(settings.discordHistoryDays))
      .catch(error => app.log.warn({ err: error }, 'Could not prune Discord history'));
  let pruning: ReturnType<typeof setInterval> | undefined;
  app.addHook('onListen', async () => {
    await discord.start();
    void pruneDiscord();
    pruning = setInterval(pruneDiscord, 60 * 60 * 1000);
    pruning.unref?.();
  });
  app.addHook('onClose', async () => {
    clearInterval(pruning);
    await discord.close();
  });

  await app.ready();
  return app;
}
