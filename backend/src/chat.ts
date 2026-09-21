import type { FastifyInstance } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { EndpointStore } from './endpoint-store';
import { PlatformStore } from './platform-store';
import { ThinkingLevel } from './generated/prisma/enums';
import { channelInput, createChatSession, modelCapabilities } from './chat-runtime';
import { CodexProvider, CODEX_CONNECTION } from './codex-provider';
import { createWebTools } from './web-tools';
import { createActivityRecorder } from './agent-activity';

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
  // This first persistence slice runs one backend process; serialize inference per agent.
  const active = new Set<string>();
  app.addHook('onClose', async () => { await database.close(); });
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

  app.post<{ Body: Static<typeof ChatBody> }>('/api/chat', {
    bodyLimit: 131072,
    schema: { operationId: 'sendChannelMessage', body: ChatBody, response: { 200: Type.String({ description: 'NDJSON user_message acknowledgments, channel_message publications, typing, operator-only activity, error, and done events. Only saved channel publications are agent chat messages.' }), 400: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 503: ErrorResponse } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { agentId, clientMessageId, message } = request.body;
    if (!message.trim()) return reply.code(400).send({ message: 'Message is empty.' });
    const record = await database.findAgent(agentId);
    if (!record) return reply.code(404).send({ message: 'Agent not found.' });
    const agent = agentView(record);
    if (active.has(agent.id)) return reply.code(409).send({ message: 'This agent is already responding. Try again when it finishes.' });
    active.add(agent.id);
    let web: Awaited<ReturnType<typeof createWebTools>> | undefined;
    const emit = (event: object) => { if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(`${JSON.stringify(event)}\n`); };
    try {
      if (await database.findMessage(clientMessageId)) return reply.code(409).send({ message: 'This message was already received. Reload the channel history.' });
      const subscription = agent.endpointId === CODEX_CONNECTION;
      if (subscription && !(await codex.status()).connected) return reply.code(400).send({ message: 'Reconnect OpenAI Codex in Settings.' });
      const endpoint = subscription ? { baseUrl: 'https://chatgpt.com/backend-api', apiKey: undefined } : (await store.read()).find(item => item.id === agent.endpointId);
      if (!endpoint) return reply.code(404).send({ message: 'The configured endpoint was removed.' });
      const subscriptionRuntime = subscription ? await codex.runtime() : undefined;
      const accessKey = subscriptionRuntime ? (await subscriptionRuntime.getAuth('openai-codex', { signal: AbortSignal.timeout(15000) }))?.auth.apiKey : endpoint.apiKey;
      if (subscription && !accessKey) return reply.code(400).send({ message: 'Reconnect OpenAI Codex in Settings.' });
      const history = await database.context(agent.channelId, message.length);
      const userMessage = await database.appendMessage(agent.channelId, 'user', message, clientMessageId);
      let published = 0;
      let cancelled = false;
      const activity = createActivityRecorder(agent.id, agent.channelId, accessKey ?? '', emit);
      const pendingSends = new Set<string>();
      let typing = false;
      const updateTyping = () => {
        const next = pendingSends.size > 0;
        if (next !== typing) { typing = next; emit({ type: 'typing', channelId: agent.channelId, active: next }); }
      };
      const clearTyping = () => { pendingSends.clear(); updateTyping(); };
      if (reply.raw.destroyed) return reply;
      reply.hijack();
      reply.raw.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      emit({ type: 'user_message', ...messageView(userMessage) });
      web = await createWebTools();
      const session = await createChatSession({
        name: agent.name, model: agent.model, thinkingLevel: agent.thinkingLevel,
        baseUrl: endpoint.baseUrl, apiKey: endpoint.apiKey,
        channel: { id: agent.channelId, kind: 'platform-chat', agentId: agent.id },
      }, history, async (text, toolCallId) => {
        if (reply.raw.destroyed || reply.raw.writableEnded || cancelled) throw new Error('Channel disconnected');
        // Commit before declaring a tool publication successful or sending it to the browser.
        const saved = await database.appendMessage(agent.channelId, 'assistant', text);
        pendingSends.delete(toolCallId); updateTyping(); published++;
        activity.record('channel', 'Channel publication', text);
        emit({ type: 'channel_message', ...messageView(saved) });
      }, web.tools, subscriptionRuntime);
      if (reply.raw.destroyed) { session.dispose(); return reply; }
      activity.record('system', 'System prompt', session.agent.state.systemPrompt);
      const unsubscribe = session.subscribe(event => {
        activity.onEvent(event);
        if (event.type === 'message_update') {
          const update = event.assistantMessageEvent;
          if (update.type === 'toolcall_start' || update.type === 'toolcall_delta' || update.type === 'toolcall_end') {
            const tool = update.type === 'toolcall_end' ? update.toolCall : update.partial.content[update.contentIndex];
            if (tool?.type === 'toolCall' && tool.name === 'send_message') { pendingSends.add(tool.id); updateTyping(); }
          }
        } else if (event.type === 'tool_execution_end' && event.toolName === 'send_message') { pendingSends.delete(event.toolCallId); updateTyping(); }
      });
      const abort = () => { cancelled = true; void session.abort(); };
      const timer = setTimeout(abort, 120000);
      const disconnect = () => { if (!reply.raw.writableEnded) abort(); };
      reply.raw.on('close', disconnect);
      try {
        await session.prompt(channelInput(agent.channelId, message), { expandPromptTemplates: false });
        const lastAssistant = () => [...session.messages].reverse().find(item => item.role === 'assistant');
        if (!published && !cancelled && !reply.raw.destroyed && !session.isStreaming && lastAssistant()?.stopReason === 'stop') {
          clearTyping();
          await session.sendCustomMessage({
            customType: 'channel-delivery-reminder', display: false,
            content: `Automatic channel reminder: nothing was sent to channel ${agent.channelId} in this request. Your thinking and direct assistant output are not delivered to this channel. If you intended a visible response, use send_message for this channel. If silence was intentional, ignore this reminder; no acknowledgment is needed.`,
          }, { triggerTurn: true });
        }
        clearTyping();
        if (cancelled || ['error', 'aborted'].includes(lastAssistant()?.stopReason ?? '') || (!published && lastAssistant()?.stopReason !== 'stop')) emit({ type: 'error', message: 'The agent could not finish its response. The endpoint may not support tool calling, or the request failed or timed out.' });
        activity.record('status', cancelled ? 'Stopped' : 'Turn complete', published ? `${published} channel message(s) published.` : 'No channel message published.');
        emit({ type: 'done' });
      } catch {
        clearTyping();
        activity.record('error', 'Request failed', 'The model request failed. Check the endpoint and model configuration.');
        emit({ type: 'error', message: 'The model request failed. Check the endpoint, model, and tool-calling support.' });
        emit({ type: 'done' });
      } finally {
        clearTimeout(timer); clearTyping(); unsubscribe(); reply.raw.off('close', disconnect); session.dispose();
        if (!reply.raw.destroyed) reply.raw.end();
      }
    } catch (error) {
      // Concurrent submissions on different agents can race the duplicate precheck.
      if (!reply.raw.headersSent && error && typeof error === 'object' && 'code' in error && error.code === 'P2002') return reply.code(409).send({ message: 'This message was already received. Reload the channel history.' });
      // Do not expose database errors/parameters or credential-bearing runtime failures.
      if (!reply.raw.headersSent) return reply.code(503).send({ message: 'Could not save the message or initialize the agent. Reload history before retrying.' });
      emit({ type: 'error', message: 'Your message was saved, but the agent could not start. Check the endpoint and model configuration.' });
      emit({ type: 'done' });
      if (!reply.raw.destroyed) reply.raw.end();
    } finally {
      active.delete(agent.id);
      await web?.close().catch(() => { request.log.warn('Could not clean up web turn resources.'); });
    }
  });
}
