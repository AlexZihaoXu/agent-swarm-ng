import { FileSchema } from './files/routes';
import { FileError, FileStore, type FileView } from './files/store';
import { chatKey } from './files/access';
import { registerMemoryRoutes } from './memory/routes';
import { registerOrganizationRoutes } from './organization-routes';
import { registerScratchRoutes } from './scratch-routes';
import type { FastifyInstance } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { EndpointStore } from './endpoint-store';
import { PlatformStore } from './platform-store';
import { ThinkingLevel } from './generated/prisma/enums';
import { endpointCapabilities } from './chat-runtime';
import { CodexProvider, CODEX_CONNECTION } from './codex-provider';
import { AgentRuns } from './agent-runs';
import { createRunStreams } from './run-streams';
import { AvatarSchema, type AgentAvatar } from './agent-avatar';
import { resolveChatConnection, ConnectionError } from './chat-connection';
import { DmBroker } from './dm-broker';
import { DiscordPresence } from './discord/presence';
import { DiscordIntake } from './discord/intake';
import type { DiscordStore } from './discord/store';
import type { DiscordConnections } from './discord/connections';
import type { DiscordTokenStore } from './discord/token-store';
import { registerSwarmRoutes } from './swarm-routes';
import { registerGroupRoutes } from './group-routes';
import { registerReactionRoutes } from './reaction-routes';
import { channelReply, channelReplyContext } from './reply-preview';
import type { ComputerUseService } from './computer-use/service';
import type { ScreenshotPool } from './computer-use/image-pool';
import { registerActivityRoutes } from './activity-routes';
import { Connections } from './users/connections';
import { parseTodos } from './todos';
import { TIME_NOTE_CHOICES } from './time-notes';
import { checkMemoryCap } from './users/store';
import { ADMIN_ID, Reach, connectionOwner, viewerOf } from './users/reach';

const Thinking = Type.Union(Object.values(ThinkingLevel).map(value => Type.Literal(value)));
const Selection = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 80 }),
    endpointId: Type.String({ minLength: 1, maxLength: 100 }),
    model: Type.String({ minLength: 1, maxLength: 512 }),
    thinkingLevel: Thinking,
    avatar: Type.Optional(AvatarSchema),
  },
  { additionalProperties: false },
);
const Message = Type.Object({
  id: Type.String(),
  sequence: Type.Integer(),
  channelId: Type.String(),
  role: Type.Union([Type.Literal('user'), Type.Literal('assistant')]),
  text: Type.String(),
  timestamp: Type.Number(),
  replyTo: Type.Union([
    Type.Object({
      id: Type.String(),
      role: Type.Union([Type.Literal('user'), Type.Literal('assistant')]),
      text: Type.String(),
    }),
    Type.Null(),
  ]),
  files: Type.Optional(Type.Array(FileSchema)),
  /** Who wrote a human message (docs/users.md#in-chats); absent on older messages, written by the owner. */
  author: Type.Optional(Type.Object({ userId: Type.String(), name: Type.String() })),
});
const Cursor = Type.Union([Type.Integer(), Type.Null()]);
/** Background compaction (see background-compaction.ts): during work at atPercent; when idle, after idleMinutes at idlePercent. */
const Compaction = Type.Object(
  {
    atPercent: Type.Integer({ minimum: 20, maximum: 90 }),
    idleMinutes: Type.Integer({ minimum: 0, maximum: 1440, description: '0 turns idle compaction off.' }),
    idlePercent: Type.Integer({ minimum: 10, maximum: 90 }),
  },
  { additionalProperties: false },
);
/** Heartbeat (see heartbeat.ts): a periodic wake-up in a branch that is dropped unless it changes something. */
const Clock = Type.Union([Type.Literal(''), Type.String({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' })]);
const Heartbeat = Type.Object(
  {
    enabled: Type.Boolean(),
    minutes: Type.Integer({ minimum: 5, maximum: 1440 }),
    from: Clock,
    to: Clock,
    checklist: Type.String({ maxLength: 4000 }),
  },
  { additionalProperties: false },
);
const Agent = Type.Object(
  {
    ...Selection.properties,
    avatar: Type.Optional(Type.Union([AvatarSchema, Type.Null()])),
    id: Type.String(),
    channelId: Type.String(),
    createdAt: Type.Number(),
    lastMessage: Type.Union([Message, Type.Null()]),
    compaction: Compaction,
    heartbeat: Type.Intersect([Heartbeat, Type.Object({ timeZone: Type.String() })]),
    /** The owner's own instructions for this agent (Markdown), last in its system prompt. */
    instructions: Type.String(),
    /** Its organization (organizations.ts): it reaches only computers, agents and groups of the same one. */
    organizationId: Type.String(),
    /** Minutes per clock window with one time note while it works (0: off; docs/agent-time.md#time-notes). */
    timeNoteMinutes: Type.Integer(),
    /** Its todo list (todo_write, docs/agent-todos.md); live changes come as todos_updated events. */
    todos: Type.Array(
      Type.Object({
        content: Type.String(),
        status: Type.Union([Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed')]),
      }),
    ),
  },
  { additionalProperties: false },
);
const ErrorResponse = Type.Object({ message: Type.String() });
const RunState = Type.Object({
  runId: Type.String(),
  agentId: Type.String(),
  channelId: Type.String(),
  clientMessageId: Type.String({
    description:
      'Original request owning this run and its Stop target; may differ from a newly accepted follow-up message ID.',
  }),
  typing: Type.Boolean(),
  typingTargets: Type.Optional(Type.Array(Type.String())),
  queued: Type.Optional(Type.Boolean()),
});
const ChatBody = Type.Object(
  {
    agentId: Type.String({ minLength: 1, maxLength: 100 }),
    clientMessageId: Type.String({ format: 'uuid' }),
    message: Type.String({ maxLength: 20000 }),
    replyToMessageId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    /** Files uploaded to this chat beforehand (POST /api/files), sent with the message. */
    fileIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 10 })),
  },
  { additionalProperties: false },
);
const messageView = (message: Awaited<ReturnType<PlatformStore['appendMessage']>>, files?: FileView[]) => ({
  id: message.id,
  sequence: message.sequence,
  channelId: message.channelId,
  role: message.role,
  text: message.text,
  timestamp: message.createdAt.getTime(),
  replyTo: channelReply(message),
  ...(files?.length ? { files } : {}),
  ...(message.authorUserId && message.authorName
    ? { author: { userId: message.authorUserId, name: message.authorName } }
    : {}),
});
function agentView(
  agent: NonNullable<Awaited<ReturnType<PlatformStore['findAgent']>>>,
  files?: Map<string, FileView[]>,
) {
  const channel = agent.channels[0];
  return {
    id: agent.id,
    avatar: agent.avatar ? (JSON.parse(agent.avatar) as AgentAvatar) : null,
    createdAt: agent.createdAt.getTime(),
    name: agent.name,
    endpointId: agent.endpointId,
    model: agent.model,
    thinkingLevel: agent.thinkingLevel,
    instructions: agent.instructions,
    organizationId: agent.organizationId,
    todos: parseTodos(agent.todos),
    timeNoteMinutes: agent.timeNoteMinutes,
    heartbeat: {
      enabled: agent.heartbeatEnabled,
      minutes: agent.heartbeatMinutes,
      from: agent.heartbeatFrom,
      to: agent.heartbeatTo,
      checklist: agent.heartbeatChecklist,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    compaction: {
      atPercent: agent.compactAtPercent,
      idleMinutes: agent.idleCompactMinutes,
      idlePercent: agent.idleCompactPercent,
    },
    channelId: channel.id,
    lastMessage: channel.messages[0] ? messageView(channel.messages[0], files?.get(channel.messages[0].id)) : null,
  };
}

export function registerChat(
  app: FastifyInstance,
  store = new EndpointStore(),
  database = new PlatformStore(),
  codex = new CodexProvider(),
  computers?: ComputerUseService,
  screenshots?: ScreenshotPool,
  files?: FileStore,
  transfers?: DmBroker['transfers'],
  discord?: { store: DiscordStore; connections: DiscordConnections; tokens: DiscordTokenStore },
  connections: Connections = new Connections(store, new Reach(database), codex),
) {
  const runs = new AgentRuns();
  const streams = createRunStreams(runs);
  const broker = new DmBroker(database, store, codex, runs, computers, screenshots, files, connections);
  const channelFiles = broker.files;
  broker.transfers = transfers;
  if (discord) {
    // Discord messages become agent inputs through the intake (batching, admission, one triage at a time).
    const intake = new DiscordIntake(database, discord.store, {
      deliver: (agentId, input) => broker.deliverDiscord(agentId, input),
      evaluate: (agentId, channelId, notice) => broker.evaluateAdmission(agentId, channelId, notice),
      reaction: (agentId, channelId, notice) => broker.evaluateDiscordReaction(agentId, channelId, notice),
      rest: agentId => discord.connections.api(agentId).rest,
    });
    // Each bot's status: auto turns idle after ten quiet minutes (the agent's write activity counts).
    const presence = new DiscordPresence(discord.store, discord.connections);
    presence.begin();
    broker.discord = { ...discord, intake, presence };
    app.addHook('onClose', async () => presence.close());
    discord.connections.onEvent = event => void intake.handle(event).catch(() => {});
    app.addHook('onClose', async () => intake.close());
  }
  /** Private-chat messages with their files. */
  const withFiles = async (messages: Awaited<ReturnType<PlatformStore['appendMessage']>>[]) => {
    const map = await channelFiles.forMessages(
      'chat',
      messages.map(message => message.id),
    );
    return messages.map(message => messageView(message, map.get(message.id)));
  };
  registerActivityRoutes(app, database, broker.activity);
  registerScratchRoutes(app, database, broker.scratch);
  registerMemoryRoutes(app, database, broker.memory, broker.sleeper, broker.settings);
  registerOrganizationRoutes(app, broker.organizations, async (computerId, organizationId) => {
    await database.initialize();
    const computer = await database.client.computer.findUnique({
      where: { id: computerId },
      select: { memoryGiB: true, organization: { select: { ownerId: true } } },
    });
    const target = await connections.reach.ownerOf(organizationId);
    if (!computer?.memoryGiB || computer.organization.ownerId === target) return null;
    return checkMemoryCap(database, organizationId, computer.memoryGiB, computerId);
  });
  app.addHook('onListen', async () => {
    await broker.ready();
  });
  const active = new Set<string>(); // Short preparation/deletion locks; inference belongs to runs.
  const preparing = new Map<
    string,
    { clientMessageId: string; controller: AbortController; finished: Promise<void> }
  >();
  let closing = false;
  registerSwarmRoutes(app, broker.store, database, active, () => closing, channelFiles);
  registerGroupRoutes(
    app,
    broker,
    groupId => runs.announce(groupId),
    () => closing,
    groupId => runs.groupDeleted(groupId),
  );
  registerReactionRoutes(
    app,
    broker.reactions,
    (channelId, messageId) => runs.reactionsChanged(channelId, messageId),
    () => closing,
    (channelId, messageId, emoji) => broker.notifyHumanReaction(channelId, messageId, emoji),
  );
  app.addHook('preClose', async () => {
    closing = true;
    broker.close();
    for (const item of preparing.values()) item.controller.abort();
    streams.close();
    await runs.shutdown();
    await broker.settled();
    await Promise.all([...preparing.values()].map(item => item.finished));
  });
  app.addHook('onClose', async () => {
    await database.close();
  });
  app.get(
    '/api/events',
    {
      schema: {
        operationId: 'observeAgentRuns',
        response: {
          200: Type.String({
            description:
              'NDJSON active-run snapshot followed by live run/message/typing/activity events and heartbeats. Disconnecting never cancels work. Recover missed publications from channel history.',
          }),
        },
      },
    },
    async (_request, reply) => {
      streams.attach(reply);
      return reply;
    },
  );
  app.post<{ Params: { id: string }; Body: { clientMessageId: string } }>(
    '/api/agents/:id/stop',
    {
      schema: {
        operationId: 'stopAgentRun',
        params: Type.Object({ id: Type.String({ minLength: 1, maxLength: 100 }) }),
        body: Type.Object({ clientMessageId: Type.String({ format: 'uuid' }) }, { additionalProperties: false }),
        response: { 200: Type.Object({ stopped: Type.Boolean() }) },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const preparation = preparing.get(request.params.id);
      if (preparation?.clientMessageId === request.body.clientMessageId) {
        preparation.controller.abort();
        await preparation.finished;
        await runs.stop(request.params.id, request.body.clientMessageId);
        return { stopped: true };
      }
      const target = runs
        .snapshot()
        .find(run => run.agentId === request.params.id && run.clientMessageId === request.body.clientMessageId);
      if (target) await broker.stopChainForRun(target.runId);
      return { stopped: (await runs.stop(request.params.id, request.body.clientMessageId)) || Boolean(target) };
    },
  );
  app.get<{ Querystring: { model: string; endpointId?: string; organizationId?: string } }>(
    '/api/agents/model-capabilities',
    {
      schema: {
        operationId: 'getAgentModelCapabilities',
        querystring: Type.Object({
          model: Type.String({ maxLength: 512 }),
          endpointId: Type.Optional(Type.String({ maxLength: 100 })),
          /** Whose connections: this organization's owner's (default: your own). */
          organizationId: Type.Optional(Type.String({ maxLength: 64 })),
        }),
        response: {
          200: Type.Object({ thinkingLevels: Type.Array(Thinking), reasoning: Type.Boolean() }),
          503: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        const owner = await connectionOwner(connections.reach, viewerOf(request), request.query.organizationId);
        if (request.query.endpointId === CODEX_CONNECTION)
          return await connections.codex(owner).capabilities(request.query.model);
        const endpoint = (await store.readFor(owner)).find(row => row.id === request.query.endpointId);
        return await endpointCapabilities(request.query.model, endpoint);
      } catch {
        return reply.code(503).send({
          message: 'Could not load model capabilities. Check the connection and select a tool-capable text model.',
        });
      }
    },
  );

  app.get<{ Querystring: { after?: number; limit?: number; search?: string; organizationId?: string } }>(
    '/api/agents',
    {
      schema: {
        operationId: 'listAgents',
        querystring: Type.Object({
          search: Type.Optional(Type.String({ maxLength: 80 })),
          after: Type.Optional(Type.Integer({ minimum: 1 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          /** Only this organization's agents (e.g. those an agent may be allowed to DM). */
          organizationId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
        }),
        response: { 200: Type.Object({ agents: Type.Array(Agent), nextCursor: Cursor }) },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const page = await database.listAgents(
        request.query.after,
        request.query.limit,
        request.query.search,
        request.query.organizationId,
        await connections.reach.organizations(viewerOf(request)),
      );
      const files = await channelFiles.forMessages(
        'chat',
        page.agents.flatMap(agent => (agent.channels[0].messages[0] ? [agent.channels[0].messages[0].id] : [])),
      );
      return { agents: page.agents.map(agent => agentView(agent, files)), nextCursor: page.nextCursor };
    },
  );
  app.get<{ Params: { channelId: string }; Querystring: { before?: number; limit?: number } }>(
    '/api/channels/:channelId/messages',
    {
      schema: {
        operationId: 'listChannelMessages',
        params: Type.Object({ channelId: Type.String({ minLength: 1, maxLength: 100 }) }),
        querystring: Type.Object({
          before: Type.Optional(Type.Integer({ minimum: 1 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        }),
        response: { 200: Type.Object({ messages: Type.Array(Message), nextCursor: Cursor }), 404: ErrorResponse },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!(await database.hasChannel(request.params.channelId)))
        return reply.code(404).send({ message: 'Channel not found.' });
      const page = await database.messages(request.params.channelId, request.query.before, request.query.limit);
      return { messages: await withFiles(page.messages), nextCursor: page.nextCursor };
    },
  );
  /** Shared by create and edit: the endpoint, model and thinking level must be usable together right now. */
  async function checkSelection(
    input: {
      endpointId: string;
      model: string;
      thinkingLevel: Static<typeof Selection>['thinkingLevel'];
    },
    /** Whose connections the agent will use: its organization's owner. */
    owner: string,
  ): Promise<{ status: 400 | 404; message: string } | null> {
    const codex = connections.codex(owner);
    const endpoint =
      input.endpointId === CODEX_CONNECTION
        ? undefined
        : (await store.readFor(owner)).find(row => row.id === input.endpointId);
    let capabilities;
    try {
      capabilities =
        input.endpointId === CODEX_CONNECTION
          ? await codex.capabilities(input.model)
          : await endpointCapabilities(input.model, endpoint);
    } catch {
      return {
        status: 400,
        message: 'Could not load model capabilities. Check the connection and select a tool-capable text model.',
      };
    }
    if (!capabilities.thinkingLevels.includes(input.thinkingLevel))
      return { status: 400, message: 'Choose a name and a supported thinking level.' };
    if (input.endpointId === CODEX_CONNECTION) {
      try {
        const status = await codex.status();
        if (!status.connected || !status.models.includes(input.model))
          return { status: 400, message: 'Connect OpenAI Codex in Settings and select an available model.' };
      } catch {
        return { status: 400, message: 'Could not read the OpenAI connection. Reconnect in Settings.' };
      }
    } else if (!endpoint) return { status: 404, message: 'Save the endpoint in Settings first.' };
    return null;
  }
  const CreateAgent = Type.Object(
    { ...Selection.properties, organizationId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })) },
    { additionalProperties: false },
  );
  app.post<{ Body: Static<typeof CreateAgent> }>(
    '/api/agents',
    {
      schema: {
        operationId: 'createChatAgent',
        body: CreateAgent,
        response: { 200: Agent, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const input = request.body;
      if (!input.name.trim()) return reply.code(400).send({ message: 'Choose a name and a supported thinking level.' });
      const organizationId = await broker.organizations
        .resolve(viewerOf(request), input.organizationId)
        .catch(() => null);
      if (!organizationId) return reply.code(404).send({ message: 'Organization not found.' });
      const problem = await checkSelection(input, (await connections.reach.ownerOf(organizationId)) ?? ADMIN_ID);
      if (problem) return reply.code(problem.status).send({ message: problem.message });
      return agentView(await database.createAgent({ ...input, name: input.name.trim(), organizationId }));
    },
  );

  app.patch<{
    Params: { id: string };
    Body: Partial<Pick<Static<typeof Selection>, 'name' | 'endpointId' | 'model' | 'thinkingLevel'>> & {
      compaction?: Partial<Static<typeof Compaction>>;
      heartbeat?: Partial<Static<typeof Heartbeat>>;
      timeNoteMinutes?: number;
      instructions?: string;
    };
  }>(
    '/api/agents/:id',
    {
      schema: {
        operationId: 'updateChatAgent',
        params: Type.Object({ id: Type.String({ minLength: 1, maxLength: 100 }) }),
        body: Type.Object(
          {
            name: Type.Optional(Selection.properties.name),
            endpointId: Type.Optional(Selection.properties.endpointId),
            model: Type.Optional(Selection.properties.model),
            thinkingLevel: Type.Optional(Thinking),
            compaction: Type.Optional(Type.Partial(Compaction)),
            heartbeat: Type.Optional(Type.Partial(Heartbeat)),
            /** Minutes per clock window with one time note while working (0: off; docs/agent-time.md#time-notes). */
            timeNoteMinutes: Type.Optional(Type.Union(TIME_NOTE_CHOICES.map(value => Type.Literal(value)))),
            instructions: Type.Optional(Type.String({ maxLength: 20000 })),
          },
          { additionalProperties: false, minProperties: 1 },
        ),
        response: { 200: Agent, 400: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 503: ErrorResponse },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const id = request.params.id;
      if (closing) return reply.code(503).send({ message: 'The backend is shutting down.' });
      // The same short lock as deletion: a turn in flight already captured its model and name. The compaction
      // policy alone can change at any time (it is read when the next summary starts).
      // Instructions too: the next turn reads them; a running turn keeps the ones it started with.
      const identity = Object.keys(request.body).some(
        key => !['compaction', 'instructions', 'heartbeat', 'timeNoteMinutes'].includes(key),
      );
      if (active.has(id) || (identity && runs.has(id)))
        return reply
          .code(409)
          .send({ message: 'The agent is responding. Stop it and wait for the turn to finish before changing it.' });
      active.add(id);
      try {
        const record = await database.findAgent(id);
        if (!record) return reply.code(404).send({ message: 'Agent not found.' });
        const next = {
          name: (request.body.name ?? record.name).trim(),
          endpointId: request.body.endpointId ?? record.endpointId,
          model: request.body.model ?? record.model,
          thinkingLevel: request.body.thinkingLevel ?? record.thinkingLevel,
        };
        if (!next.name) return reply.code(400).send({ message: 'Choose a name.' });
        if (
          next.endpointId !== record.endpointId ||
          next.model !== record.model ||
          next.thinkingLevel !== record.thinkingLevel
        ) {
          const problem = await checkSelection(next, await connections.ownerOfAgent(id));
          if (problem)
            return reply.code(problem.status === 404 ? 400 : problem.status).send({ message: problem.message });
          // A summary being written for the old model is not applied to the new one.
          broker.forgetCompaction(id);
        }
        const policy = request.body.compaction ?? {};
        const beat = request.body.heartbeat ?? {};
        const from = beat.from ?? record.heartbeatFrom,
          to = beat.to ?? record.heartbeatTo;
        if (Boolean(from) !== Boolean(to))
          return reply.code(400).send({ message: 'Set both heartbeat hours, or neither for all day.' });
        // A running agent's time notes follow the new setting from its next model call.
        if (request.body.timeNoteMinutes !== undefined) broker.setTimeNoteMinutes(id, request.body.timeNoteMinutes);
        return agentView(
          await database.updateAgent(id, {
            ...next,
            compactAtPercent: policy.atPercent ?? record.compactAtPercent,
            idleCompactMinutes: policy.idleMinutes ?? record.idleCompactMinutes,
            idleCompactPercent: policy.idlePercent ?? record.idleCompactPercent,
            instructions: request.body.instructions ?? record.instructions,
            heartbeatEnabled: beat.enabled ?? record.heartbeatEnabled,
            heartbeatMinutes: beat.minutes ?? record.heartbeatMinutes,
            heartbeatFrom: from,
            heartbeatTo: to,
            heartbeatChecklist: beat.checklist?.trim() ?? record.heartbeatChecklist,
            timeNoteMinutes: request.body.timeNoteMinutes ?? record.timeNoteMinutes,
          }),
        );
      } catch {
        return reply.code(503).send({ message: 'Could not update the agent. Try again.' });
      } finally {
        active.delete(id);
      }
    },
  );

  app.delete<{ Params: { id: string }; Body: { confirmation: string } }>(
    '/api/agents/:id',
    {
      schema: {
        operationId: 'deleteChatAgent',
        params: Type.Object({ id: Type.String({ minLength: 1, maxLength: 100 }) }),
        body: Type.Object(
          { confirmation: Type.String({ minLength: 1, maxLength: 80 }) },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ deleted: Type.Boolean() }),
          400: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          503: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const id = request.params.id;
      if (active.has(id) || runs.has(id))
        return reply
          .code(409)
          .send({ message: 'The agent is responding. Stop it and wait for the turn to finish before deleting.' });
      active.add(id);
      try {
        const agent = await database.findAgent(id);
        if (!agent) return reply.code(404).send({ message: 'Agent not found.' });
        if (request.body.confirmation !== agent.name)
          return reply.code(400).send({ message: 'Type the exact agent name to confirm deletion.' });
        await broker.beforeDelete(id);
        await computers?.releaseAgent(id); // settles outstanding input; the claim row would cascade with the agent anyway
        // Its Discord bot signs out and its token goes with it (its Discord rows cascade with the agent).
        if (discord) {
          await discord.connections.stop(id);
          await discord.tokens.remove(id);
          await database.client.discordAccount.deleteMany({ where: { agentId: id } });
        }
        // Delete the record before its files: if this fails the agent is still whole, and leftover images only expire from the pool.
        if (!(await database.deleteAgent(id, request.body.confirmation)))
          return reply.code(404).send({ message: 'Agent not found.' });
        // Its chats are gone, so their files go too.
        await channelFiles
          .deleteForAgent(
            id,
            agent.channels.map(channel => channel.id),
          )
          .catch(() => {});
        await screenshots?.removeAgent(id).catch(() => {});
        runs.announce(''); // Agent deletion can change membership in several groups.
        return { deleted: true };
      } catch {
        return reply.code(503).send({ message: 'Could not delete the agent. Try again.' });
      } finally {
        active.delete(id);
        broker.afterDelete(id);
      }
    },
  );

  app.post<{ Body: Static<typeof ChatBody> }>(
    '/api/chat',
    {
      bodyLimit: 131072,
      schema: {
        operationId: 'sendChannelMessage',
        body: ChatBody,
        response: {
          200: Type.String({
            description:
              'Legacy NDJSON observer stream. Prefer: respond-async returns 202 immediately; observe /api/events instead. Accepted work survives disconnects. Messages arriving during a run are coalesced or triaged for interruption; the returned run retains its original Stop target.',
          }),
          202: Type.Object({ run: RunState, message: Message }),
          400: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          503: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const { agentId, clientMessageId, message, replyToMessageId, fileIds = [] } = request.body;
      const stopVersion = runs.stopVersion(agentId);
      if (!message.trim() && !fileIds.length) return reply.code(400).send({ message: 'Message is empty.' });
      if (closing) return reply.code(503).send({ message: 'The backend is shutting down.' });
      if (active.has(agentId))
        return reply.code(409).send({ message: 'Another message is being saved. Try again shortly.' });
      active.add(agentId);
      const controller = new AbortController();
      let finishPreparation!: () => void;
      preparing.set(agentId, {
        clientMessageId,
        controller,
        finished: new Promise<void>(resolve => {
          finishPreparation = resolve;
        }),
      });
      try {
        const record = await database.findAgent(agentId);
        if (!record) return reply.code(404).send({ message: 'Agent not found.' });
        const agent = agentView(record);
        if (await database.findMessage(clientMessageId))
          return reply.code(409).send({ message: 'This message was already received. Reload the channel history.' });
        await connections.forAgent(agent, controller.signal);
        controller.signal.throwIfAborted();
        const fileTarget = { channelKey: chatKey(agent.channelId), uploader: { kind: 'human' as const } };
        await channelFiles.attachable(fileIds, fileTarget);
        const viewer = viewerOf(request);
        const userMessage = await database.appendMessage(
          agent.channelId,
          'user',
          message,
          clientMessageId,
          replyToMessageId,
          { userId: viewer.userId, name: viewer.name },
        );
        const owner = await connections.ownerOfAgent(agentId);
        const attached = await channelFiles.attach(fileIds, {
          ...fileTarget,
          messageKind: 'chat',
          messageId: userMessage.id,
        });
        const incoming = {
          role: 'user' as const,
          files: FileStore.refs(attached),
          text: message,
          id: userMessage.id,
          sequence: userMessage.sequence,
          timestamp: userMessage.createdAt.getTime(),
          replyTo: channelReplyContext(userMessage, agent.name),
          ...(viewer.userId !== owner ? { writer: viewer.name } : {}),
        };
        if (stopVersion !== runs.stopVersion(agentId))
          return reply.code(409).send({
            message: 'The run was stopped while your message was being saved. Reload history before continuing.',
          });
        let run = runs.offer(agentId, incoming, { type: 'user_message', ...messageView(userMessage, attached) });
        const joined = Boolean(run);
        if (!run) {
          controller.signal.throwIfAborted();
          if (stopVersion !== runs.stopVersion(agentId))
            return reply.code(409).send({ message: 'The run was stopped. Your message was saved.' });
          if (closing)
            return reply.code(503).send({ message: 'The backend is shutting down. Your message was saved.' });
          run = runs.enqueue(
            { agentId, channelId: agent.channelId, clientMessageId, fromChat: true },
            async context => {
              context.emit({ type: 'user_message', ...messageView(userMessage, attached) });
              await broker.runInbox(agentId, incoming, context);
            },
          );
        }
        if (controller.signal.aborted) run.controller.abort();
        if (reply.raw.destroyed) {
          reply.hijack();
          return;
        }
        if (request.headers.prefer === 'respond-async')
          return reply
            .code(202)
            .header('Preference-Applied', 'respond-async')
            .send({
              run: {
                agentId,
                channelId: agent.channelId,
                clientMessageId: run.clientMessageId,
                runId: run.runId,
                typing: run.typing,
                typingTargets: run.typingTargets,
                queued: run.queued,
              },
              message: messageView(userMessage, attached),
            });
        streams.attach(
          reply,
          run.runId,
          joined
            ? {
                type: 'user_message',
                ...messageView(userMessage, attached),
                agentId,
                runId: run.runId,
                eventId: `${run.runId}:accepted:${userMessage.id}`,
              }
            : undefined,
        );
        return reply;
      } catch (error) {
        if (error instanceof ConnectionError) return reply.code(error.status).send({ message: error.message });
        if (error instanceof FileError) return reply.code(error.status).send({ message: error.message });
        if (error instanceof Error && error.message.startsWith('Reply target not found'))
          return reply.code(400).send({ message: error.message });
        if (controller.signal.aborted)
          return reply.code(409).send({ message: 'The request was stopped before the agent started.' });
        if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
          return reply.code(409).send({ message: 'This message was already received. Reload the channel history.' });
        return reply
          .code(503)
          .send({ message: 'Could not save the message or initialize the agent. Reload history before retrying.' });
      } finally {
        active.delete(agentId);
        preparing.delete(agentId);
        finishPreparation();
      }
    },
  );
  return { runs };
}
