import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { buildApp } from './app';
import { EndpointStore } from './endpoint-store';
import { createChatSession, modelCapabilities } from './chat-runtime';

type RequestBody = { tools?: { function: { name: string } }[]; messages: { role: string; content: string | { type: string; text: string }[] }[]; reasoning_effort?: string; model: string };
let server: Server;
let baseUrl: string;
let folder: string;
let behavior: 'tool' | 'raw' | 'wrong-channel' | 'after-reminder' | 'http-error' = 'tool';
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
    const shouldPublish = behavior !== 'raw' && (behavior !== 'after-reminder' || JSON.stringify(body.messages).includes('Automatic channel reminder:'));
    if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
    const system = body.messages.find(message => message.role === 'system')?.content;
    const channelId = (typeof system === 'string' ? system : '').match(/channel is ([\w-]+)\./)?.[1];
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta: object, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    chunk({ role: 'assistant', reasoning_content: 'PRIVATE THINKING', content: 'PRIVATE DIRECT OUTPUT' });
    if (shouldPublish) {
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

async function testApp() {
  const store = new EndpointStore(join(folder, `${crypto.randomUUID()}.json`));
  await store.save({ id: 'endpoint', name: 'Mock', baseUrl, apiKey: '!literal-key-$NOT_AN_ENV_LOOKUP' });
  return buildApp({ endpointStore: store });
}

const configuration = { name: 'Chat test', endpointId: 'endpoint', model: 'test-model', thinkingLevel: 'off' };
const eventsFrom = (body: string) => body.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const channelEvents = (body: string) => eventsFrom(body).filter(event => event.type !== 'activity');

describe('Pi chat and platform channel boundary', () => {
  it('exposes only send_message, keeps input literal, and has no session file', async () => {
    behavior = 'tool'; captured = [];
    const published: string[] = [];
    const session = await createChatSession({ ...configuration, thinkingLevel: 'off', baseUrl, apiKey: '!literal-key-$NOT_AN_ENV_LOOKUP', channel: { id: 'test-channel', agentId: 'test-agent', kind: 'platform-chat' } }, [], text => published.push(text));
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
      const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { agent, history: [{ role: 'user', text: 'Earlier question' }, { role: 'assistant', text: 'Earlier published answer' }], message: 'Hello again' } });
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
      const response = await fetch(`${address}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent, history: [], message: 'Hello' }), signal: controller.signal });
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
      const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { agent, history: [], message: 'Hello' } });
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
      const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { agent, history: [], message: 'Hello' } });
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
      const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { agent, history: [], message: 'Hello' } });
      expect(captured).toHaveLength(1);
      expect(response.body).toContain('"type":"error"');
      expect(JSON.stringify(channelEvents(response.body))).not.toContain('PRIVATE');
      expect(response.body).not.toContain('!literal-key-$NOT_AN_ENV_LOOKUP');
    } finally { await app.close(); }
  });

  it('rejects forged descriptors and descriptors from an earlier backend instance', async () => {
    const first = await testApp();
    const agent = (await first.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
    try {
      expect((await first.inject({ method: 'POST', url: '/api/chat', payload: { agent: { ...agent, channelId: 'other' }, history: [], message: 'Hello' } })).statusCode).toBe(403);
    } finally { await first.close(); }
    const second = await testApp();
    try { expect((await second.inject({ method: 'POST', url: '/api/chat', payload: { agent, history: [], message: 'Hello' } })).statusCode).toBe(403); }
    finally { await second.close(); }
  });
});
