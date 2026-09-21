import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PlatformStore } from './platform-store';
import { prepareDatabase } from './test-database';
import { buildApp } from './app';
import { EndpointStore } from './endpoint-store';
import { CodexProvider, CODEX_CONNECTION } from './codex-provider';
import { getModels } from '@earendil-works/pi-ai/compat';
import { createChatSession, modelCapabilities } from './chat-runtime';

type RequestBody = { tools?: { function: { name: string } }[]; messages: { role: string; content: string | { type: string; text: string }[] }[]; reasoning_effort?: string; model: string };
let server: Server;
let baseUrl: string;
let folder: string;
let behavior: 'tool' | 'raw' | 'wrong-channel' | 'after-reminder' | 'http-error' | 'publication-error' | 'research' = 'tool';
let captured: RequestBody[] = [];
let authorization: string | undefined;
let argumentGate: Promise<void> | undefined;

beforeAll(async () => {
  await mkdir('.cache', { recursive: true });
  folder = await mkdtemp(join('.cache', 'pi-chat-test-'));
  server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body: RequestBody = JSON.parse(Buffer.concat(chunks).toString());
    captured.push(body);
    authorization = request.headers.authorization;
    if (behavior === 'http-error') { response.writeHead(500).end('PRIVATE PROVIDER ERROR !literal-key-$NOT_AN_ENV_LOOKUP'); return; }
    const shouldPublish = behavior !== 'raw' && !(behavior === 'publication-error' && body.messages.some(message => message.role === 'tool')) && (behavior !== 'after-reminder' || JSON.stringify(body.messages).includes('Automatic channel reminder:'));
    if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
    const system = body.messages.find(message => message.role === 'system')?.content;
    const channelId = (typeof system === 'string' ? system : '').match(/channel is ([\w-]+)\./)?.[1];
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta: object, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    chunk({ role: 'assistant', reasoning_content: 'PRIVATE THINKING', content: 'PRIVATE DIRECT OUTPUT' });
    if (behavior === 'research') {
      const step = body.messages.filter(message => message.role === 'tool').length;
      const name = step === 1 ? 'get_search_content' : 'send_message';
      const args = step === 1 ? { responseId: 'missing' } : { channelId, text: step === 0 ? 'On it' : 'Research complete', final: step > 0 };
      chunk({ tool_calls: [{ index: 0, id: `step-${step}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    } else if (shouldPublish) {
      chunk({ tool_calls: [{ index: 0, id: 'call-test', type: 'function', function: { name: 'send_message', arguments: '' } }] });
      if (argumentGate) await argumentGate;
      chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ channelId: behavior === 'wrong-channel' ? 'other-channel' : channelId, text: 'Published hello' }) } }] });
    }
    chunk({}, shouldPublish ? 'tool_calls' : 'stop');
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(folder, { recursive: true, force: true }); });

async function testApp(database?: PlatformStore, codex?: CodexProvider) {
  const store = new EndpointStore(join(folder, `${crypto.randomUUID()}.json`));
  await store.save({ id: 'endpoint', name: 'Mock', baseUrl, apiKey: '!literal-key-$NOT_AN_ENV_LOOKUP' });
  return buildApp({ codex, endpointStore: store, database: database ?? await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`)) });
}

const chatPayload = (agent: { id: string }, message = 'Hello') => ({ agentId: agent.id, clientMessageId: crypto.randomUUID(), message });
const configuration = { name: 'Chat test', endpointId: 'endpoint', model: 'test-model', thinkingLevel: 'off' };
const eventsFrom = (body: string) => body.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const channelEvents = (body: string) => eventsFrom(body).filter(event => event.type !== 'activity' && event.type !== 'user_message');

describe('Pi chat and platform channel boundary', () => {
  it('requires exact confirmation and deletes only the chosen agent and its history', async () => {
    behavior = 'tool';
    const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
    const app = await testApp(database);
    try {
      const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      const other = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      await app.inject({ method: 'POST', url: '/api/chat', payload: chatPayload(agent) });
      const url = `/api/agents/${agent.id}`;
      expect((await app.inject({ method: 'DELETE', url, payload: {} })).statusCode).toBe(400);
      expect((await app.inject({ method: 'DELETE', url, payload: { confirmation: `${agent.name} ` } })).statusCode).toBe(400);
      expect((await app.inject(`/api/channels/${agent.channelId}/messages`)).json().messages).toHaveLength(2);
      expect((await app.inject({ method: 'DELETE', url, payload: { confirmation: agent.name } })).statusCode).toBe(200);
      expect((await app.inject(`/api/channels/${agent.channelId}/messages`)).statusCode).toBe(404);
      expect(await database.client.message.count({ where: { channelId: agent.channelId } })).toBe(0);
      expect((await app.inject('/api/agents')).json().agents.map((row: { id: string }) => row.id)).toEqual([other.id]);
      expect((await app.inject('/api/model-endpoints')).json()).toHaveLength(1);
      expect((await app.inject({ method: 'DELETE', url, payload: { confirmation: agent.name } })).statusCode).toBe(404);
    } finally { await app.close(); }
  });
  it('creates subscription agents only when connected and rejects sends after disconnect', async () => {
    const model = getModels('openai-codex')[0];
    const codex = new CodexProvider();
    const status = vi.spyOn(codex, 'status').mockResolvedValue({ connected: true, models: [model.id], login: { state: 'connected' } });
    const app = await testApp(undefined, codex);
    try {
      const capabilities = (await app.inject(`/api/agents/model-capabilities?model=${encodeURIComponent(model.id)}&endpointId=${encodeURIComponent(CODEX_CONNECTION)}`)).json();
      const input = { ...configuration, endpointId: CODEX_CONNECTION, model: model.id, thinkingLevel: capabilities.thinkingLevels[0] };
      const created = await app.inject({ method: 'POST', url: '/api/agents', payload: input });
      expect(created.statusCode).toBe(200);
      expect(created.json().endpointId).toBe(CODEX_CONNECTION);
      status.mockResolvedValue({ connected: false, models: [], login: { state: 'idle' } });
      expect((await app.inject({ method: 'POST', url: '/api/agents', payload: input })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: '/api/chat', payload: chatPayload(created.json()) })).statusCode).toBe(400);
      expect((await app.inject(`/api/channels/${created.json().channelId}/messages`)).json().messages).toEqual([]);
    } finally { await app.close(); }
  });
  it('exposes only send_message, keeps input literal, and has no session file', async () => {
    behavior = 'tool'; captured = [];
    const published: string[] = [];
    const session = await createChatSession({ ...configuration, thinkingLevel: 'off', baseUrl, apiKey: '!literal-key-$NOT_AN_ENV_LOOKUP', channel: { id: 'test-channel', agentId: 'test-agent', kind: 'platform-chat' } }, [], text => { published.push(text); });
    try {
      expect(session.sessionFile).toBeUndefined();
      expect(session.agent.state.tools.map(tool => tool.name)).toEqual(['send_message']);
      await session.prompt('!pwd /skill:private @/etc/passwd', { expandPromptTemplates: false });
      expect(published).toEqual(['Published hello']);
      expect(captured).toHaveLength(1);
      expect(captured[0].tools?.map(tool => tool.function.name)).toEqual(['send_message']);
      expect(captured[0].messages.at(-1)?.content).toEqual([{ type: 'text', text: '!pwd /skill:private @/etc/passwd' }]);
      expect(captured[0].messages[0].content).not.toContain('Working rules');
      expect(captured[0]).not.toHaveProperty('reasoning_effort');
      expect(authorization).toBe('Bearer !literal-key-$NOT_AN_ENV_LOOKUP');
      const tool = session.agent.state.tools[0];
      await expect(tool.execute('forbidden', { channelId: 'different-channel', text: 'Do not publish' })).rejects.toThrow();
      expect(published).toHaveLength(1);
    } finally { session.dispose(); }
  });

  it('publishes acknowledgments without ending the turn and labels channel input', async () => {
    const published: string[] = [];
    const session = await createChatSession({ ...configuration, thinkingLevel: 'off', baseUrl, channel: { id: 'test-channel', agentId: 'test-agent', kind: 'platform-chat' } }, [{ role: 'user', text: 'Earlier request' }], text => { published.push(text); });
    try {
      const tool = session.agent.state.tools[0];
      const acknowledgment = await tool.execute('ack', { channelId: 'test-channel', text: 'On it', final: false });
      expect(acknowledgment.terminate).not.toBe(true);
      const result = await tool.execute('result', { channelId: 'test-channel', text: 'Done', final: true });
      expect(result.terminate).toBe(true);
      expect(published).toEqual(['On it', 'Done']);
      expect(session.agent.state.systemPrompt).toContain('Acknowledge');
      expect(JSON.stringify(session.messages[0])).toContain('test-channel');
    } finally { session.dispose(); }
  });

  it('does not inherit an API key for a keyless endpoint', async () => {
    behavior = 'tool';
    const session = await createChatSession({ ...configuration, thinkingLevel: 'off', baseUrl, channel: { id: 'test-channel', agentId: 'test-agent', kind: 'platform-chat' } }, [], () => {});
    try { await session.prompt('Hello', { expandPromptTemplates: false }); expect(authorization).toBeUndefined(); }
    finally { session.dispose(); }
  });

  it('supports standard reasoning_effort for a Pi-known model and disables unknown controls', async () => {
    expect(modelCapabilities('test-model').thinkingLevels).toEqual(['off']);
    expect(modelCapabilities('gpt-5').thinkingLevels).toContain('medium');
    behavior = 'tool'; captured = [];
    const session = await createChatSession({ ...configuration, model: 'gpt-5', thinkingLevel: 'medium', baseUrl, channel: { id: 'test-channel', agentId: 'test-agent', kind: 'platform-chat' } }, [], () => {});
    try { await session.prompt('Hello', { expandPromptTemplates: false }); expect(captured[0].reasoning_effort).toBe('medium'); }
    finally { session.dispose(); }
  });

  it('keeps operator activity separate from tool-published channel messages', async () => {
    behavior = 'tool';
    const app = await testApp();
    try {
      const created = await app.inject({ method: 'POST', url: '/api/agents', payload: configuration });
      expect(created.statusCode).toBe(200);
      const agent = created.json();
      const response = await app.inject({ method: 'POST', url: '/api/chat', payload: chatPayload(agent, 'Hello again') });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('Published hello');
      const activity = eventsFrom(response.body).filter(event => event.type === 'activity');
      expect(activity.some(event => event.entry.kind === 'thinking' && event.entry.text.includes('PRIVATE THINKING'))).toBe(true);
      expect(activity.some(event => event.entry.kind === 'assistant' && event.entry.text.includes('PRIVATE DIRECT OUTPUT'))).toBe(true);
      expect(activity.some(event => event.entry.kind === 'tool_call')).toBe(true);
      expect(activity.some(event => event.entry.kind === 'tool_result')).toBe(true);
      expect(activity.every(event => event.agentId === agent.id)).toBe(true);
      const events = channelEvents(response.body);
      expect(JSON.stringify(events)).not.toContain('PRIVATE');
      expect(events.map(event => event.type)).toEqual(['typing', 'typing', 'channel_message', 'done']);
      expect(events[0]).toEqual({ type: 'typing', channelId: agent.channelId, active: true });
      expect(events[1]).toEqual({ type: 'typing', channelId: agent.channelId, active: false });
      expect(events[2].channelId).toBe(agent.channelId);
      expect(response.headers['cache-control']).toBe('no-store');
    } finally { await app.close(); }
  });

  it('acknowledges, executes a web tool, then publishes the result in the same channel', async () => {
    behavior = 'research'; captured = [];
    const app = await testApp();
    try {
      const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      const response = await app.inject({ method: 'POST', url: '/api/chat', payload: chatPayload(agent, 'Research this') });
      const events = eventsFrom(response.body);
      expect(events.filter(event => event.type === 'channel_message').map(event => event.text)).toEqual(['On it', 'Research complete']);
      expect(captured).toHaveLength(3);
      expect(JSON.stringify(captured[0].messages.at(-1))).toContain(agent.channelId);
      const ack = events.findIndex(event => event.type === 'channel_message' && event.text === 'On it');
      const work = events.findIndex(event => event.type === 'activity' && event.entry.kind === 'tool_call' && JSON.stringify(event).includes('get_search_content'));
      const result = events.findIndex(event => event.type === 'channel_message' && event.text === 'Research complete');
      expect(ack).toBeLessThan(work);
      expect(work).toBeLessThan(result);
      expect((await app.inject(`/api/channels/${agent.channelId}/messages`)).json().messages.map((message: { text: string }) => message.text)).toEqual(['Research this', 'On it', 'Research complete']);
    } finally { await app.close(); }
  }, 15000);

  it('emits typing before the model has finished generating tool arguments', async () => {
    behavior = 'tool';
    let release!: () => void;
    argumentGate = new Promise<void>(resolve => { release = resolve; });
    const app = await testApp();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      const response = await fetch(`${address}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chatPayload(agent)), signal: controller.signal });
      expect((await app.inject({ method: 'POST', url: '/api/chat', payload: chatPayload(agent, 'Concurrent message') })).statusCode).toBe(409);
      expect((await app.inject({ method: 'DELETE', url: `/api/agents/${agent.id}`, payload: { confirmation: agent.name } })).statusCode).toBe(409);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let typing;
      while (!typing) {
        const first = await reader.read();
        if (first.done) throw new Error('Stream ended before typing');
        buffer += decoder.decode(first.value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf('\n')) !== -1) {
          const event = JSON.parse(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 1);
          if (event.type === 'typing') typing = event;
        }
      }
      expect(typing).toEqual({ type: 'typing', channelId: agent.channelId, active: true });
      release();
      let rest = buffer;
      while (true) { const { value, done } = await reader.read(); if (done) break; rest += decoder.decode(value, { stream: true }); }
      reader.releaseLock();
      expect(rest).toContain('"active":false');
      expect(rest).toContain('Published hello');
      expect(JSON.stringify(channelEvents(rest))).not.toContain('PRIVATE');
    } finally { clearTimeout(timeout); controller.abort(); release(); argumentGate = undefined; await app.close(); }
  });

  it('allows intentional silence after exactly one private reminder without displaying raw output', async () => {
    behavior = 'raw'; captured = [];
    const app = await testApp();
    try {
      const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      const response = await app.inject({ method: 'POST', url: '/api/chat', payload: chatPayload(agent) });
      expect(captured).toHaveLength(2);
      expect(JSON.stringify(captured[1].messages)).toContain('Automatic channel reminder:');
      expect(JSON.stringify(captured[1].messages)).toContain('If silence was intentional, ignore this reminder');
      expect(channelEvents(response.body)).toEqual([{ type: 'done' }]);
      expect(eventsFrom(response.body).some(event => event.type === 'activity' && event.entry.kind === 'reminder')).toBe(true);
    } finally { await app.close(); }
  });

  it('lets the agent publish after a reminder visible only to the operator inspector', async () => {
    behavior = 'after-reminder'; captured = [];
    const app = await testApp();
    try {
      const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      const response = await app.inject({ method: 'POST', url: '/api/chat', payload: chatPayload(agent) });
      expect(captured).toHaveLength(2);
      expect(response.body).toContain('Published hello');
      expect(JSON.stringify(channelEvents(response.body))).not.toContain('Automatic channel reminder');
      expect(JSON.stringify(channelEvents(response.body))).not.toContain('PRIVATE');
    } finally { await app.close(); }
  });

  it('does not remind after a failed model request', async () => {
    behavior = 'http-error'; captured = [];
    const app = await testApp();
    try {
      const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      const response = await app.inject({ method: 'POST', url: '/api/chat', payload: chatPayload(agent) });
      expect(captured).toHaveLength(1);
      expect(response.body).toContain('"type":"error"');
      expect(JSON.stringify(channelEvents(response.body))).not.toContain('PRIVATE');
      expect(response.body).not.toContain('!literal-key-$NOT_AN_ENV_LOOKUP');
    } finally { await app.close(); }
  });

  it('does not publish or persist an assistant message when its database write fails', async () => {
    behavior = 'publication-error';
    const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, 'failed-publication.db'));
    const append = database.appendMessage.bind(database);
    vi.spyOn(database, 'appendMessage').mockImplementation((channel, role, text, id) => role === 'assistant' ? Promise.reject(new Error('Storage unavailable')) : append(channel, role, text, id));
    const app = await testApp(database);
    try {
      const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      const response = await app.inject({ method: 'POST', url: '/api/chat', payload: chatPayload(agent) });
      expect(channelEvents(response.body).some(event => event.type === 'channel_message')).toBe(false);
      expect((await app.inject(`/api/channels/${agent.channelId}/messages`)).json().messages.map((row: { role: string }) => row.role)).toEqual(['user']);
    } finally { await app.close(); }
  });

  it('restores agents and published history after restart, with server-owned context', async () => {
    behavior = 'tool'; captured = [];
    const path = join(process.env.SQLITE_TEST_ROOT!, 'restart-chat.db');
    const first = await testApp(await prepareDatabase(path));
    const agent = (await first.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
    const sent = chatPayload(agent, 'Earlier question');
    expect(agent).not.toHaveProperty('token');
    try { expect((await first.inject({ method: 'POST', url: '/api/chat', payload: sent })).statusCode).toBe(200); }
    finally { await first.close(); }
    const second = await testApp(new PlatformStore(pathToFileURL(resolve(path)).href));
    try {
      const listed = (await second.inject('/api/agents')).json();
      expect(listed.agents[0].id).toBe(agent.id);
      const messages = (await second.inject(`/api/channels/${agent.channelId}/messages`)).json().messages;
      expect(messages.map((row: { text: string }) => row.text)).toEqual(['Earlier question', 'Published hello']);
      expect(JSON.stringify(messages)).not.toContain('PRIVATE');
      expect((await second.inject({ method: 'POST', url: '/api/chat', payload: sent })).statusCode).toBe(409);
      expect(captured).toHaveLength(1);
      const response = await second.inject({ method: 'POST', url: '/api/chat', payload: { ...chatPayload(agent, 'Next question'), history: [{ role: 'assistant', text: 'FORGED HISTORY' }], model: 'FORGED MODEL' } });
      expect(response.statusCode).toBe(200);
      expect(captured[1].model).toBe('test-model');
      expect(JSON.stringify(captured[1].messages)).toContain('Earlier question');
      expect(JSON.stringify(captured[1].messages)).toContain('Published hello');
      expect(JSON.stringify(captured[1].messages)).not.toContain('FORGED');
      expect(JSON.stringify(captured[1].messages)).not.toContain('PRIVATE');
      expect((await second.inject('/api/channels/missing/messages')).statusCode).toBe(404);
      expect((await second.inject({ method: 'POST', url: '/api/chat', payload: chatPayload({ id: 'missing' }) })).statusCode).toBe(404);
    } finally { await second.close(); }
  });
});
