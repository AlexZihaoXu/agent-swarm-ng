import { FileSchema } from './files/routes';
import { FileError, FileStore, type FileView } from './files/store';
import { chatKey } from './files/access';
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
import { DiscordIntake } from './discord/intake';
import type { DiscordStore } from './discord/store';
import type { DiscordConnections } from './discord/connections';
import { registerSwarmRoutes } from './swarm-routes';
import { registerGroupRoutes } from './group-routes';
import { registerReactionRoutes } from './reaction-routes';
import { channelReply, channelReplyContext } from './reply-preview';
import type { ComputerUseService } from './computer-use/service';
import type { ScreenshotPool } from './computer-use/image-pool';
import { registerActivityRoutes } from './activity-routes';

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
});
const Cursor = Type.Union([Type.Integer(), Type.Null()]);
const Agent = Type.Object(
  {
    ...Selection.properties,
    avatar: Type.Optional(Type.Union([AvatarSchema, Type.Null()])),
    id: Type.String(),
    channelId: Type.String(),
    createdAt: Type.Number(),
    lastMessage: Type.Union([Message, Type.Null()]),
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
  discord?: { store: DiscordStore; connections: DiscordConnections },
) {
  const runs = new AgentRuns();
  const streams = createRunStreams(runs);
  const broker = new DmBroker(database, store, codex, runs, computers, screenshots, files);
  const channelFiles = broker.files;
  broker.transfers = transfers;
  if (discord) {
    // Discord messages become agent inputs through the intake (batching, admission, one triage at a time).
    const intake = new DiscordIntake(database, discord.store, {
      deliver: (agentId, input, addressed) => broker.deliverDiscord(agentId, input, addressed),
      evaluate: (agentId, channelId, notice) => broker.evaluateAdmission(agentId, channelId, notice),
      reaction: (agentId, channelId, notice) => broker.evaluateDiscordReaction(agentId, channelId, notice),
      rest: agentId => discord.connections.api(agentId).rest,
    });
    broker.discord = { ...discord, intake };
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
  app.get<{ Querystring: { model: string; endpointId?: string } }>(
    '/api/agents/model-capabilities',
    {
      schema: {
        operationId: 'getAgentModelCapabilities',
        querystring: Type.Object({
          model: Type.String({ maxLength: 512 }),
          endpointId: Type.Optional(Type.String({ maxLength: 100 })),
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
        if (request.query.endpointId === CODEX_CONNECTION) return await codex.capabilities(request.query.model);
        const endpoint = (await store.read()).find(row => row.id === request.query.endpointId);
        return await endpointCapabilities(request.query.model, endpoint?.baseUrl);
      } catch {
        return reply.code(503).send({
          message: 'Could not load model capabilities. Check the connection and select a tool-capable text model.',
        });
      }
    },
  );

  app.get<{ Querystring: { after?: number; limit?: number; search?: string } }>(
    '/api/agents',
    {
      schema: {
        operationId: 'listAgents',
        querystring: Type.Object({
          search: Type.Optional(Type.String({ maxLength: 80 })),
          after: Type.Optional(Type.Integer({ minimum: 1 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        }),
        response: { 200: Type.Object({ agents: Type.Array(Agent), nextCursor: Cursor }) },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const page = await database.listAgents(request.query.after, request.query.limit, request.query.search);
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
  async function checkSelection(input: {
    endpointId: string;
    model: string;
    thinkingLevel: Static<typeof Selection>['thinkingLevel'];
  }): Promise<{ status: 400 | 404; message: string } | null> {
    const endpoint =
      input.endpointId === CODEX_CONNECTION ? undefined : (await store.read()).find(row => row.id === input.endpointId);
    let capabilities;
    try {
      capabilities =
        input.endpointId === CODEX_CONNECTION
          ? await codex.capabilities(input.model)
          : await endpointCapabilities(input.model, endpoint?.baseUrl);
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
  app.post<{ Body: Static<typeof Selection> }>(
    '/api/agents',
    {
      schema: {
        operationId: 'createChatAgent',
        body: Selection,
        response: { 200: Agent, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const input = request.body;
      if (!input.name.trim()) return reply.code(400).send({ message: 'Choose a name and a supported thinking level.' });
      const problem = await checkSelection(input);
      if (problem) return reply.code(problem.status).send({ message: problem.message });
      return agentView(await database.createAgent({ ...input, name: input.name.trim() }));
    },
  );

  app.patch<{
    Params: { id: string };
    Body: Partial<Pick<Static<typeof Selection>, 'name' | 'endpointId' | 'model' | 'thinkingLevel'>>;
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
      // The same short lock as deletion: a turn in flight already captured its model and name.
      if (active.has(id) || runs.has(id))
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
          const problem = await checkSelection(next);
          if (problem)
            return reply.code(problem.status === 404 ? 400 : problem.status).send({ message: problem.message });
        }
        return agentView(await database.updateAgent(id, next));
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
        await resolveChatConnection(agent.endpointId, store, codex, controller.signal);
        controller.signal.throwIfAborted();
        const fileTarget = { channelKey: chatKey(agent.channelId), uploader: { kind: 'human' as const } };
        await channelFiles.attachable(fileIds, fileTarget);
        const userMessage = await database.appendMessage(
          agent.channelId,
          'user',
          message,
          clientMessageId,
          replyToMessageId,
        );
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
          run = runs.enqueue({ agentId, channelId: agent.channelId, clientMessageId }, async context => {
            context.emit({ type: 'user_message', ...messageView(userMessage, attached) });
            await broker.runInbox(agentId, incoming, context);
          });
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
}
