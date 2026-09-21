import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { EndpointStore } from './endpoint-store';
import { createChatSession, modelCapabilities } from './chat-runtime';
import { createActivityRecorder } from './agent-activity';

const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const Thinking = Type.Union(thinkingLevels.map(value => Type.Literal(value)));
const Selection = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 80 }),
  endpointId: Type.String({ minLength: 1, maxLength: 100 }),
  model: Type.String({ minLength: 1, maxLength: 512 }), thinkingLevel: Thinking,
}, { additionalProperties: false });
const Agent = Type.Object({
  ...Selection.properties,
  id: Type.String(), channelId: Type.String(), token: Type.String({ pattern: '^[a-f0-9]{64}$' }),
}, { additionalProperties: false });
const ErrorResponse = Type.Object({ message: Type.String() });
const ChatBody = Type.Object({
  agent: Agent,
  history: Type.Array(Type.Object({ role: Type.Union([Type.Literal('user'), Type.Literal('assistant')]), text: Type.String({ maxLength: 20000 }) }, { additionalProperties: false }), { maxItems: 100 }),
  message: Type.String({ minLength: 1, maxLength: 20000 }),
}, { additionalProperties: false });

export function registerChat(app: FastifyInstance, store = new EndpointStore()) {
  // A signed descriptor avoids storing agents or conversations. Restart invalidates existing descriptors.
  const secret = randomBytes(32);
  const sign = (agent: Omit<Static<typeof Agent>, 'token'>) => createHmac('sha256', secret)
    .update(JSON.stringify([agent.id, agent.channelId, agent.name, agent.endpointId, agent.model, agent.thinkingLevel])).digest('hex');

  app.get<{ Querystring: { model: string } }>('/api/agents/model-capabilities', {
    schema: {
      operationId: 'getAgentModelCapabilities', querystring: Type.Object({ model: Type.String({ maxLength: 512 }) }),
      response: { 200: Type.Object({ thinkingLevels: Type.Array(Thinking), reasoning: Type.Boolean() }) },
    },
  }, async request => modelCapabilities(request.query.model));

  app.post<{ Body: Static<typeof Selection> }>('/api/agents', {
    schema: { operationId: 'createChatAgent', body: Selection, response: { 200: Agent, 400: ErrorResponse, 404: ErrorResponse } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const input = request.body;
    if (!input.name.trim() || !modelCapabilities(input.model).thinkingLevels.includes(input.thinkingLevel)) {
      return reply.code(400).send({ message: 'Choose a name and a supported thinking level.' });
    }
    if (!(await store.read()).some(endpoint => endpoint.id === input.endpointId)) return reply.code(404).send({ message: 'Save the endpoint in Preferences first.' });
    const descriptor = { ...input, name: input.name.trim(), id: randomUUID(), channelId: randomUUID() };
    return { ...descriptor, token: sign(descriptor) };
  });

  app.post<{ Body: Static<typeof ChatBody> }>('/api/chat', {
    bodyLimit: 131072,
    schema: { operationId: 'sendChannelMessage', body: ChatBody, response: { 200: Type.String({ description: 'NDJSON channel-message, typing, operator-only activity, error, and done events. Only channel-message events belong in chat.' }), 400: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 503: ErrorResponse } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { agent, history, message } = request.body;
    if (!timingSafeEqual(Buffer.from(agent.token, 'hex'), Buffer.from(sign(agent), 'hex'))) return reply.code(403).send({ message: 'This temporary agent has expired. Create it again.' });
    if (!message.trim() || history.reduce((size, item) => size + item.text.length, message.length) > 80000) return reply.code(400).send({ message: 'Message is empty or this temporary conversation is too long. Start a new agent.' });
    const endpoint = (await store.read()).find(item => item.id === agent.endpointId);
    if (!endpoint) return reply.code(404).send({ message: 'The configured endpoint was removed.' });

    let published = 0;
    const emit = (event: object) => { if (!reply.raw.destroyed) reply.raw.write(`${JSON.stringify(event)}\n`); };
    const activity = createActivityRecorder(agent.id, agent.channelId, endpoint.apiKey, emit);
    const pendingSends = new Set<string>();
    let typing = false;
    const updateTyping = () => {
      const next = pendingSends.size > 0;
      if (next !== typing) { typing = next; emit({ type: 'typing', channelId: agent.channelId, active: next }); }
    };
    const clearTyping = () => { pendingSends.clear(); updateTyping(); };
    let session: Awaited<ReturnType<typeof createChatSession>>;
    try {
      session = await createChatSession({
        name: agent.name, model: agent.model, thinkingLevel: agent.thinkingLevel,
        baseUrl: endpoint.baseUrl, apiKey: endpoint.apiKey,
        channel: { id: agent.channelId, kind: 'platform-chat', agentId: agent.id },
      }, history, (text, toolCallId) => {
        if (reply.raw.destroyed) throw new Error('Channel disconnected');
        pendingSends.delete(toolCallId);
        updateTyping();
        published++;
        activity.record('channel', 'Channel publication', text);
        emit({ type: 'channel_message', channelId: agent.channelId, id: randomUUID(), text, timestamp: Date.now() });
      });
    } catch {
      return reply.code(503).send({ message: 'Could not initialize the tool-restricted Pi chat session.' });
    }

    if (reply.raw.destroyed) { session.dispose(); return reply; }
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    activity.record('system', 'System prompt', session.agent.state.systemPrompt);
    const unsubscribe = session.subscribe(event => {
      activity.onEvent(event);
      if (event.type === 'message_update') {
        const update = event.assistantMessageEvent;
        if (update.type === 'toolcall_start' || update.type === 'toolcall_delta' || update.type === 'toolcall_end') {
          const tool = update.type === 'toolcall_end' ? update.toolCall : update.partial.content[update.contentIndex];
          if (tool?.type === 'toolCall' && tool.name === 'send_message') {
            pendingSends.add(tool.id);
            updateTyping();
          }
        }
      } else if (event.type === 'tool_execution_end' && event.toolName === 'send_message') {
        pendingSends.delete(event.toolCallId);
        updateTyping();
      }
    });
    let cancelled = false;
    const abort = () => { cancelled = true; void session.abort(); };
    const timer = setTimeout(abort, 120000);
    const disconnect = () => { if (!reply.raw.writableEnded) abort(); };
    reply.raw.on('close', disconnect);
    try {
      await session.prompt(message, { expandPromptTemplates: false });
      const lastAssistant = () => [...session.messages].reverse().find(item => item.role === 'assistant');
      if (!published && !cancelled && !reply.raw.destroyed && !session.isStreaming && lastAssistant()?.stopReason === 'stop') {
        clearTyping();
        // One private follow-up per request, never a loop or a visible channel message.
        await session.sendCustomMessage({
          customType: 'channel-delivery-reminder', display: false,
          content: `Automatic channel reminder: nothing was sent to channel ${agent.channelId} in this request. Your thinking and direct assistant output are not delivered to this channel. If you intended a visible response, use send_message for this channel. If silence was intentional, ignore this reminder; no acknowledgment is needed.`,
        }, { triggerTurn: true });
      }
      clearTyping();
      if (!published && lastAssistant()?.stopReason !== 'stop') emit({ type: 'error', message: 'The agent did not publish a channel message. The endpoint may not support tool calling, or the request failed or timed out.' });
      activity.record('status', cancelled ? 'Stopped' : 'Turn complete', published ? `${published} channel message(s) published.` : 'No channel message published.');
      emit({ type: 'done' });
    } catch {
      clearTyping();
      activity.record('error', 'Request failed', 'The model request failed. Check the endpoint and model configuration.');
      emit({ type: 'error', message: 'The model request failed. Check the endpoint, model, and tool-calling support.' });
    } finally {
      clearTimeout(timer);
      clearTyping();
      unsubscribe();
      reply.raw.off('close', disconnect);
      session.dispose();
      if (!reply.raw.destroyed) reply.raw.end();
    }
  });
}
