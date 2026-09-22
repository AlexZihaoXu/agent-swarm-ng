import type { FastifyInstance } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { EndpointStore } from './endpoint-store';
import { PlatformStore } from './platform-store';
import { ThinkingLevel } from './generated/prisma/enums';
import { modelCapabilities } from './chat-runtime';
import { CodexProvider, CODEX_CONNECTION } from './codex-provider';
import { AgentRuns } from './agent-runs';
import { createRunStreams } from './run-streams';
import { runChat } from './chat-runner';
import { createChatHistoryTools } from './chat-history-tools';

const Thinking = Type.Union(Object.values(ThinkingLevel).map(value => Type.Literal(value)));
const Selection = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 80 }), endpointId: Type.String({ minLength: 1, maxLength: 100 }),
  model: Type.String({ minLength: 1, maxLength: 512 }), thinkingLevel: Thinking,
}, { additionalProperties: false });
const Message = Type.Object({
  id: Type.String(), sequence: Type.Integer(), channelId: Type.String(),
  role: Type.Union([Type.Literal('user'), Type.Literal('assistant')]), text: Type.String(), timestamp: Type.Number(),
});
const Cursor = Type.Union([Type.Integer(), Type.Null()]);
const Agent = Type.Object({
  ...Selection.properties, id: Type.String(), channelId: Type.String(), createdAt: Type.Number(), lastMessage: Type.Union([Message, Type.Null()]),
}, { additionalProperties: false });
const ErrorResponse = Type.Object({ message: Type.String() });
const RunState = Type.Object({ runId: Type.String(), agentId: Type.String(), channelId: Type.String(), clientMessageId: Type.String({ description: 'Original request owning this run and its Stop target; may differ from a newly accepted follow-up message ID.' }), typing: Type.Boolean() });
const ChatBody = Type.Object({
  agentId: Type.String({ minLength: 1, maxLength: 100 }),
  clientMessageId: Type.String({ format: 'uuid' }), message: Type.String({ minLength: 1, maxLength: 20000 }),
}, { additionalProperties: false });
const messageView = (message: { id: string; sequence: number; channelId: string; role: 'user' | 'assistant'; text: string; createdAt: Date }) => ({
  id: message.id, sequence: message.sequence, channelId: message.channelId, role: message.role, text: message.text, timestamp: message.createdAt.getTime(),
});
function agentView(agent: NonNullable<Awaited<ReturnType<PlatformStore['findAgent']>>>) {
  const channel = agent.channels[0];
  return { id: agent.id, createdAt: agent.createdAt.getTime(), name: agent.name, endpointId: agent.endpointId, model: agent.model, thinkingLevel: agent.thinkingLevel, channelId: channel.id, lastMessage: channel.messages[0] ? messageView(channel.messages[0]) : null };
}

export function registerChat(app: FastifyInstance, store = new EndpointStore(), database = new PlatformStore(), codex = new CodexProvider()) {
  const runs = new AgentRuns();
  const streams = createRunStreams(runs);
  const active = new Set<string>(); // Short preparation/deletion locks; inference belongs to runs.
  const preparing = new Map<string, { clientMessageId: string; controller: AbortController; finished: Promise<void> }>();
  let closing = false;
  app.addHook('preClose', async () => {
    closing = true;
    for (const item of preparing.values()) item.controller.abort();
    streams.close();
    await runs.shutdown();
    await Promise.all([...preparing.values()].map(item => item.finished));
  });
  app.addHook('onClose', async () => { await database.close(); });
  app.get('/api/events', {
    schema: { operationId: 'observeAgentRuns', response: { 200: Type.String({ description: 'NDJSON active-run snapshot followed by live run/message/typing/activity events and heartbeats. Disconnecting never cancels work. Recover missed publications from channel history.' }) } },
  }, async (_request, reply) => { streams.attach(reply); return reply; });
  app.post<{ Params: { id: string }; Body: { clientMessageId: string } }>('/api/agents/:id/stop', {
    schema: { operationId: 'stopAgentRun', params: Type.Object({ id: Type.String({ minLength: 1, maxLength: 100 }) }), body: Type.Object({ clientMessageId: Type.String({ format: 'uuid' }) }, { additionalProperties: false }), response: { 200: Type.Object({ stopped: Type.Boolean() }) } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const preparation = preparing.get(request.params.id);
    if (preparation?.clientMessageId === request.body.clientMessageId) {
      preparation.controller.abort(); await preparation.finished;
      await runs.stop(request.params.id, request.body.clientMessageId);
      return { stopped: true };
    }
    return { stopped: await runs.stop(request.params.id, request.body.clientMessageId) };
  });
  app.get<{ Querystring: { model: string; endpointId?: string } }>('/api/agents/model-capabilities', {
    schema: { operationId: 'getAgentModelCapabilities', querystring: Type.Object({ model: Type.String({ maxLength: 512 }), endpointId: Type.Optional(Type.String({ maxLength: 100 })) }), response: { 200: Type.Object({ thinkingLevels: Type.Array(Thinking), reasoning: Type.Boolean() }) } },
  }, async request => modelCapabilities(request.query.model, request.query.endpointId === CODEX_CONNECTION ? 'openai-codex' : 'openai'));

  app.get<{ Querystring: { after?: number; limit?: number } }>('/api/agents', {
    schema: { operationId: 'listAgents', querystring: Type.Object({ after: Type.Optional(Type.Integer({ minimum: 1 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }), response: { 200: Type.Object({ agents: Type.Array(Agent), nextCursor: Cursor }) } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const page = await database.listAgents(request.query.after, request.query.limit);
    return { agents: page.agents.map(agentView), nextCursor: page.nextCursor };
  });
  app.get<{ Params: { channelId: string }; Querystring: { before?: number; limit?: number } }>('/api/channels/:channelId/messages', {
    schema: { operationId: 'listChannelMessages', params: Type.Object({ channelId: Type.String({ minLength: 1, maxLength: 100 }) }), querystring: Type.Object({ before: Type.Optional(Type.Integer({ minimum: 1 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }), response: { 200: Type.Object({ messages: Type.Array(Message), nextCursor: Cursor }), 404: ErrorResponse } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!await database.hasChannel(request.params.channelId)) return reply.code(404).send({ message: 'Channel not found.' });
    const page = await database.messages(request.params.channelId, request.query.before, request.query.limit);
    return { messages: page.messages.map(messageView), nextCursor: page.nextCursor };
  });
  app.post<{ Body: Static<typeof Selection> }>('/api/agents', {
    schema: { operationId: 'createChatAgent', body: Selection, response: { 200: Agent, 400: ErrorResponse, 404: ErrorResponse } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const input = request.body;
    if (!input.name.trim() || !modelCapabilities(input.model, input.endpointId === CODEX_CONNECTION ? 'openai-codex' : 'openai').thinkingLevels.includes(input.thinkingLevel)) return reply.code(400).send({ message: 'Choose a name and a supported thinking level.' });
    if (input.endpointId === CODEX_CONNECTION) {
      try {
        const status = await codex.status();
        if (!status.connected || !status.models.includes(input.model)) return reply.code(400).send({ message: 'Connect OpenAI Codex in Settings and select an available model.' });
      } catch { return reply.code(400).send({ message: 'Could not read the OpenAI connection. Reconnect in Settings.' }); }
    } else if (!(await store.read()).some(endpoint => endpoint.id === input.endpointId)) return reply.code(404).send({ message: 'Save the endpoint in Settings first.' });
    return agentView(await database.createAgent({ ...input, name: input.name.trim() }));
  });

  app.delete<{ Params: { id: string }; Body: { confirmation: string } }>('/api/agents/:id', {
    schema: { operationId: 'deleteChatAgent', params: Type.Object({ id: Type.String({ minLength: 1, maxLength: 100 }) }), body: Type.Object({ confirmation: Type.String({ minLength: 1, maxLength: 80 }) }, { additionalProperties: false }), response: { 200: Type.Object({ deleted: Type.Boolean() }), 400: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 503: ErrorResponse } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const id = request.params.id;
    if (active.has(id) || runs.has(id)) return reply.code(409).send({ message: 'The agent is responding. Stop it and wait for the turn to finish before deleting.' });
    active.add(id);
    try {
      const agent = await database.findAgent(id);
      if (!agent) return reply.code(404).send({ message: 'Agent not found.' });
      if (request.body.confirmation !== agent.name) return reply.code(400).send({ message: 'Type the exact agent name to confirm deletion.' });
      if (!await database.deleteAgent(id, request.body.confirmation)) return reply.code(404).send({ message: 'Agent not found.' });
      return { deleted: true };
    } catch { return reply.code(503).send({ message: 'Could not delete the agent. Try again.' }); }
    finally { active.delete(id); }
  });

  app.post<{ Body: Static<typeof ChatBody> }>('/api/chat', {
    bodyLimit: 131072,
    schema: { operationId: 'sendChannelMessage', body: ChatBody, response: { 200: Type.String({ description: 'Legacy NDJSON observer stream. Prefer: respond-async returns 202 immediately; observe /api/events instead. Accepted work survives disconnects. Messages arriving during a run are coalesced or triaged for interruption; the returned run retains its original Stop target.' }), 202: Type.Object({ run: RunState, message: Message }), 400: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 503: ErrorResponse } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { agentId, clientMessageId, message } = request.body;
    const stopVersion = runs.stopVersion(agentId);
    if (!message.trim()) return reply.code(400).send({ message: 'Message is empty.' });
    if (closing) return reply.code(503).send({ message: 'The backend is shutting down.' });
    if (active.has(agentId)) return reply.code(409).send({ message: 'Another message is being saved. Try again shortly.' });
    active.add(agentId);
    const controller = new AbortController();
    let finishPreparation!: () => void;
    preparing.set(agentId, { clientMessageId, controller, finished: new Promise<void>(resolve => { finishPreparation = resolve; }) });
    try {
      const record = await database.findAgent(agentId);
      if (!record) return reply.code(404).send({ message: 'Agent not found.' });
      const agent = agentView(record);
      if (await database.findMessage(clientMessageId)) return reply.code(409).send({ message: 'This message was already received. Reload the channel history.' });
      const subscription = agent.endpointId === CODEX_CONNECTION;
      if (subscription && !(await codex.status()).connected) return reply.code(400).send({ message: 'Reconnect OpenAI Codex in Settings.' });
      const endpoint = subscription ? { baseUrl: 'https://chatgpt.com/backend-api', apiKey: undefined } : (await store.read()).find(item => item.id === agent.endpointId);
      if (!endpoint) return reply.code(404).send({ message: 'The configured endpoint was removed.' });
      const subscriptionRuntime = subscription ? await codex.runtime() : undefined;
      const accessKey = subscriptionRuntime ? (await subscriptionRuntime.getAuth('openai-codex', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }))?.auth.apiKey : endpoint.apiKey;
      if (subscription && !accessKey) return reply.code(400).send({ message: 'Reconnect OpenAI Codex in Settings.' });
      controller.signal.throwIfAborted();
      const userMessage = await database.appendMessage(agent.channelId, 'user', message, clientMessageId);
      const channel = { id: agent.channelId, kind: 'platform-chat' as const, agentId: agent.id };
      const incoming = { role: 'user' as const, text: message, id: userMessage.id, sequence: userMessage.sequence, timestamp: userMessage.createdAt.getTime() };
      if (stopVersion !== runs.stopVersion(agentId)) return reply.code(409).send({ message: 'The run was stopped while your message was being saved. Reload history before continuing.' });
      let run = runs.offer(agentId, incoming, { type: 'user_message', ...messageView(userMessage) });
      const joined = Boolean(run);
      if (!run) {
        if (await runs.settled(agentId)) return reply.code(409).send({ message: 'The run was stopped. Your message was saved; send a new request to resume.' });
        controller.signal.throwIfAborted();
        if (stopVersion !== runs.stopVersion(agentId)) return reply.code(409).send({ message: 'The run was stopped. Your message was saved.' });
        if (closing) return reply.code(503).send({ message: 'The backend is shutting down. Your message was saved.' });
        // Refresh after prior work settles, including its final publication but not this incoming message.
        const history = await database.context(agent.channelId, userMessage.id);
        controller.signal.throwIfAborted();
        run = runs.start({ agentId, channelId: agent.channelId, clientMessageId }, async context => {
          context.emit({ type: 'user_message', ...messageView(userMessage) });
          await runChat(context, {
            name: agent.name, model: agent.model, thinkingLevel: agent.thinkingLevel,
            baseUrl: endpoint.baseUrl, apiKey: endpoint.apiKey, channel,
          }, history, incoming, async text => messageView(await database.appendMessage(agent.channelId, 'assistant', text)), accessKey ?? '', subscriptionRuntime, createChatHistoryTools(database, channel, agent.name));
        });
      }
      if (controller.signal.aborted) run.controller.abort();
      if (reply.raw.destroyed) { reply.hijack(); return; }
      if (request.headers.prefer === 'respond-async') return reply.code(202).header('Preference-Applied', 'respond-async').send({ run: { agentId, channelId: agent.channelId, clientMessageId: run.clientMessageId, runId: run.runId, typing: run.typing }, message: messageView(userMessage) });
      streams.attach(reply, run.runId, joined ? { type: 'user_message', ...messageView(userMessage), agentId, runId: run.runId, eventId: `${run.runId}:accepted:${userMessage.id}` } : undefined);
      return reply;
    } catch (error) {
      if (controller.signal.aborted) return reply.code(409).send({ message: 'The request was stopped before the agent started.' });
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') return reply.code(409).send({ message: 'This message was already received. Reload the channel history.' });
      return reply.code(503).send({ message: 'Could not save the message or initialize the agent. Reload history before retrying.' });
    } finally { active.delete(agentId); preparing.delete(agentId); finishPreparation(); }
  });
}
