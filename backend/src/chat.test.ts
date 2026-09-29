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
import { ActivityStore } from './activity-store';

type RequestBody = {
  tools?: { function: { name: string } }[];
  messages: { role: string; content: string | { type: string; text: string }[] }[];
  reasoning_effort?: string;
  model: string;
};
let server: Server;
let baseUrl: string;
let folder: string;
let behavior:
  | 'tool'
  | 'raw'
  | 'wrong-channel'
  | 'after-reminder'
  | 'http-error'
  | 'publication-error'
  | 'research'
  | 'ack-raw'
  | 'ack-silent'
  | 'history'
  | 'triage-interrupt'
  | 'multipart'
  | 'dm-typing'
  | 'truncated' = 'tool';
let captured: RequestBody[] = [];
let authorization: string | undefined;
let argumentGate: Promise<void> | undefined;
let historyAnchorId = '';

beforeAll(async () => {
  await mkdir('.scratch', { recursive: true });
  folder = await mkdtemp(join('.scratch', 'pi-chat-test-'));
  server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body: RequestBody = JSON.parse(Buffer.concat(chunks).toString());
    captured.push(body);
    authorization = request.headers.authorization;
    if (behavior === 'http-error') {
      response.writeHead(500).end('PRIVATE PROVIDER ERROR !literal-key-$NOT_AN_ENV_LOOKUP');
      return;
    }
    const hasTool = body.messages.some(message => message.role === 'tool');
    const reminded = JSON.stringify(body.messages).includes('Automatic channel reminder:');
    const acknowledgmentCase = behavior === 'ack-raw' || behavior === 'ack-silent';
    const shouldPublish =
      behavior === 'dm-typing'
        ? !hasTool
        : acknowledgmentCase
          ? !hasTool || (behavior === 'ack-raw' && reminded)
          : behavior !== 'raw' &&
            behavior !== 'truncated' &&
            !(behavior === 'publication-error' && hasTool) &&
            (behavior !== 'after-reminder' || reminded);
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404).end();
      return;
    }
    const system = body.messages.find(message => message.role === 'system')?.content;
    const channelId = (typeof system === 'string' ? system : '').match(/channel is ([\w-]+)\./)?.[1];
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta: object, finish_reason: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    chunk({ role: 'assistant', reasoning_content: 'PRIVATE THINKING', content: 'PRIVATE DIRECT OUTPUT' });
    if (body.tools?.some(tool => tool.function.name === 'triage_decision')) {
      chunk({
        tool_calls: [
          {
            index: 0,
            id: `triage-${captured.length}`,
            type: 'function',
            function: {
              name: 'triage_decision',
              arguments: JSON.stringify({
                action: behavior === 'triage-interrupt' ? 'interrupt' : 'queue',
                reason: 'Consider the new request.',
              }),
            },
          },
        ],
      });
      chunk({}, 'tool_calls');
      response.end('data: [DONE]\n\n');
      return;
    }
    if (behavior === 'multipart') {
      const step = body.messages.filter(message => message.role === 'tool').length;
      chunk({
        tool_calls: [
          {
            index: 0,
            id: `part-${step}`,
            type: 'function',
            function: {
              name: 'send_message',
              arguments: JSON.stringify({
                channelId,
                text: ['Main takeaway', 'CAD pricing and sources', 'Trade-offs and recommendation'][step],
                final: step === 2,
              }),
            },
          },
        ],
      });
    } else if (behavior === 'history') {
      const step = body.messages.filter(message => message.role === 'tool').length;
      const name = step === 1 ? 'search_messages' : step === 2 ? 'read_messages' : 'send_message';
      const args =
        step === 1
          ? { query: 'nickname' }
          : step === 2
            ? { messageId: historyAnchorId, limit: 3 }
            : { channelId, text: step === 0 ? 'On it' : 'The nickname is Aurora', final: step > 0 };
      chunk({
        tool_calls: [
          { index: 0, id: `history-${step}`, type: 'function', function: { name, arguments: JSON.stringify(args) } },
        ],
      });
    } else if (behavior === 'research') {
      const step = body.messages.filter(message => message.role === 'tool').length;
      const name = step === 1 ? 'get_search_content' : 'send_message';
      const args =
        step === 1
          ? { responseId: 'missing' }
          : { channelId, text: step === 0 ? 'On it' : 'Research complete', final: step > 0 };
      chunk({
        tool_calls: [
          { index: 0, id: `step-${step}`, type: 'function', function: { name, arguments: JSON.stringify(args) } },
        ],
      });
    } else if (shouldPublish) {
      chunk({
        tool_calls: [
          {
            index: 0,
            id: 'call-test',
            type: 'function',
            function: { name: behavior === 'dm-typing' ? 'send_dm' : 'send_message', arguments: '' },
          },
        ],
      });
      const args = JSON.stringify({
        ...(behavior === 'dm-typing'
          ? { recipientId: 'unavailable-peer' }
          : { channelId: behavior === 'wrong-channel' ? 'other-channel' : channelId }),
        text: acknowledgmentCase ? (hasTool ? 'Recovered result' : 'On it') : 'Published hello',
        ...(acknowledgmentCase ? { final: hasTool } : {}),
      });
      if (
        argumentGate &&
        !(behavior === 'triage-interrupt' && JSON.stringify(body.messages).includes('Corrected request'))
      ) {
        const split = args.indexOf('"text":"') + 9;
        chunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(0, split) } }] });
        await argumentGate;
        chunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(split) } }] });
      } else chunk({ tool_calls: [{ index: 0, function: { arguments: args } }] });
    }
    chunk({}, behavior === 'truncated' ? 'length' : shouldPublish ? 'tool_calls' : 'stop');
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});
afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(folder, { recursive: true, force: true });
});

async function testApp(database?: PlatformStore, codex?: CodexProvider) {
  const store = new EndpointStore(join(folder, `${crypto.randomUUID()}.json`));
  await store.save({ id: 'endpoint', name: 'Mock', baseUrl, apiKey: '!literal-key-$NOT_AN_ENV_LOOKUP' });
  return buildApp({
    codex,
    endpointStore: store,
    database: database ?? (await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`))),
  });
}

const chatPayload = (agent: { id: string }, message = 'Hello') => ({
  agentId: agent.id,
  clientMessageId: crypto.randomUUID(),
  message,
});
const configuration = { name: 'Chat test', endpointId: 'endpoint', model: 'test-model', thinkingLevel: 'off' };
const eventsFrom = (body: string) =>
  body
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
async function* streamed(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);
        if (line.trim()) yield JSON.parse(line);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
const channelEvents = (body: string) =>
  eventsFrom(body)
    .filter(event => !['activity', 'user_message', 'run_queued', 'run_started', 'heartbeat'].includes(event.type))
    .map(event => {
      if (event.type === 'done') return { type: 'done' };
      const { eventId, runId, agentId, targets, ...publication } = event;
      return publication;
    });

describe('Pi chat and platform channel boundary', () => {
  it('does not publish when Stop arrives during the activity persistence barrier', async () => {
    behavior = 'tool';
    captured = [];
    const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
    const app = await testApp(database);
    let release!: () => void;
    let blocked = false;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const original = ActivityStore.prototype.save;
    const spy = vi.spyOn(ActivityStore.prototype, 'save').mockImplementation(async function (
      this: ActivityStore,
      agentId,
      entry,
    ) {
      if (!blocked && entry.kind === 'tool_call' && entry.label === 'send_message') {
        blocked = true;
        await gate;
      }
      return original.call(this, agentId, entry);
    });
    try {
      const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      const input = chatPayload(agent);
      await app.inject({ method: 'POST', url: '/api/chat', headers: { prefer: 'respond-async' }, payload: input });
      await vi.waitFor(() => expect(blocked).toBe(true), { timeout: 8000 });
      const stop = app
        .inject({
          method: 'POST',
          url: `/api/agents/${agent.id}/stop`,
          payload: { clientMessageId: input.clientMessageId },
        })
        .then(response => response);
      await new Promise(resolve => setTimeout(resolve, 50));
      release();
      await stop;
      expect(await database.client.message.count({ where: { role: 'assistant' } })).toBe(0);
    } finally {
      release();
      spy.mockRestore();
      await app.close();
    }
  }, 12000);
  it('restores private Pi tool context from SQLite after a completed run and backend restart', async () => {
    behavior = 'tool';
    captured = [];
    const path = join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`);
    const firstDatabase = await prepareDatabase(path);
    const first = await testApp(firstDatabase);
    let agent: { id: string; channelId: string };
    try {
      agent = (await first.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      const sent = await first.inject({ method: 'POST', url: '/api/chat', payload: chatPayload(agent, 'First task') });
      expect(sent.statusCode).toBe(200);
      expect(await firstDatabase.client.agentSessionEntry.count({ where: { agentId: agent.id } })).toBeGreaterThan(0);
    } finally {
      await first.close();
    }
    const secondDatabase = new PlatformStore(pathToFileURL(path).href);
    await secondDatabase.appendMessage(agent!.channelId, 'assistant', 'Committed without private checkpoint');
    const second = await testApp(secondDatabase);
    try {
      const restoredActivity = (await second.inject(`/api/agents/${agent!.id}/activity`)).json();
      expect(JSON.stringify(restoredActivity.entries)).toContain('PRIVATE DIRECT OUTPUT');
      expect(restoredActivity.entries.some((entry: { label: string }) => entry.label === 'Run ended')).toBe(true);
      expect(restoredActivity.contextUsage.label).toBe('Context usage');
      const sent = await second.inject({
        method: 'POST',
        url: '/api/chat',
        payload: chatPayload(agent!, 'Second task'),
      });
      expect(sent.statusCode).toBe(200);
      const restored = captured.at(-1)!.messages;
      expect(JSON.stringify(restored)).toContain('First task');
      expect(JSON.stringify(restored)).toContain('Committed without private checkpoint');
      expect(restored.some(message => message.role === 'tool')).toBe(true);
      const visible = (await second.inject(`/api/channels/${agent!.channelId}/messages`)).json().messages;
      expect(visible.filter((message: { role: string }) => message.role === 'assistant')).toHaveLength(3);
      expect(JSON.stringify(visible)).not.toContain('PRIVATE DIRECT OUTPUT');
    } finally {
      await second.close();
    }
  }, 16000);
  it('publishes answer parts sequentially and reports estimated context only to activity', async () => {
    behavior = 'multipart';
    captured = [];
    const app = await testApp();
    try {
      const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      const response = await app.inject({
        method: 'POST',
        url: '/api/chat',
        payload: chatPayload(agent, 'Compare these options in detail'),
      });
      const events = eventsFrom(response.body);
      expect(events.filter(e => e.type === 'channel_message').map(e => e.text)).toEqual([
        'Main takeaway',
        'CAD pricing and sources',
        'Trade-offs and recommendation',
      ]);
      expect(captured).toHaveLength(3);
      const prompt = JSON.stringify(captured[0].messages);
      expect(prompt).toContain('Chat-sized replies');
      expect(prompt).toContain('Send parts sequentially');
      const usage = events.filter(e => e.type === 'activity' && e.entry.label === 'Context usage');
      expect(usage.length).toBeGreaterThan(1);
      expect(new Set(usage.map(e => e.entry.id)).size).toBe(1);
      expect(usage.at(-1).entry.text).toMatch(/≈ [\d,]+ \/ 32,768 tokens · [\d.]+%/);
      expect(usage.at(-1).entry.text).toContain('not cumulative billing');
      expect(events.some(e => e.type === 'error')).toBe(false);
    } finally {
      await app.close();
    }
  }, 10000);

  it('coalesces rapid saved messages into one inference after the quiet period', async () => {
    behavior = 'tool';
    captured = [];
    const app = await testApp();
    try {
      const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      const send = (text: string) =>
        app.inject({
          method: 'POST',
          url: '/api/chat',
          headers: { prefer: 'respond-async' },
          payload: chatPayload(agent, text),
        });
      const first = await send('hi');
      const second = await send('please do the task');
      expect(first.statusCode).toBe(202);
      expect(second.statusCode).toBe(202);
      expect(second.json().run.runId).toBe(first.json().run.runId);
      expect(captured).toHaveLength(0);
      await vi.waitFor(
        async () =>
          expect(
            (await app.inject(`/api/channels/${agent.channelId}/messages`))
              .json()
              .messages.filter((m: any) => m.role === 'assistant'),
          ).toHaveLength(1),
        { timeout: 8000 },
      );
      expect(captured).toHaveLength(1);
      expect(JSON.stringify(captured[0].messages)).toContain('please do the task');
      expect(JSON.stringify(captured[0].messages)).toContain('hi');
    } finally {
      await app.close();
    }
  }, 12000);

  it('forks full context with only a decision tool, interrupts generation and continues the main session', async () => {
    behavior = 'triage-interrupt';
    captured = [];
    let release!: () => void;
    argumentGate = new Promise<void>(resolve => {
      release = resolve;
    });
    const app = await testApp();
    try {
      const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      const input = chatPayload(agent, 'Original request');
      const first = await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: { prefer: 'respond-async' },
        payload: input,
      });
      await vi.waitFor(() => expect(captured).toHaveLength(1), { timeout: 8000 });
      const next = await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: { prefer: 'respond-async' },
        payload: chatPayload(agent, 'Corrected request'),
      });
      expect(next.statusCode).toBe(202);
      expect(next.json().run.clientMessageId).toBe(input.clientMessageId);
      expect(next.json().run.runId).toBe(first.json().run.runId);
      await vi.waitFor(
        async () =>
          expect(
            (await app.inject(`/api/channels/${agent.channelId}/messages`))
              .json()
              .messages.filter((m: any) => m.role === 'assistant'),
          ).toHaveLength(1),
        { timeout: 8000 },
      );
      const fork = captured.find(body => body.tools?.some(tool => tool.function.name === 'triage_decision'))!;
      expect(fork.tools?.map(tool => tool.function.name)).toEqual(['triage_decision']);
      expect(JSON.stringify(fork.messages)).toContain('Original request');
      expect(JSON.stringify(fork.messages)).toContain('PRIVATE DIRECT OUTPUT');
      const continued = captured.at(-1)!;
      expect(JSON.stringify(continued.messages)).toContain('Interruption triage: interrupt');
      expect(JSON.stringify(continued.messages)).toContain('Corrected request');
      expect(continued.tools?.some(tool => tool.function.name === 'send_message')).toBe(true);
      expect(continued.tools?.some(tool => tool.function.name === 'list_knowledge')).toBe(true);
      expect(captured).toHaveLength(3);
    } finally {
      release();
      argumentGate = undefined;
      await app.close();
    }
  }, 15000);

  it('grants history tools and retrieves older context after a prompt acknowledgment', async () => {
    behavior = 'history';
    captured = [];
    const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
    const app = await testApp(database);
    try {
      const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      historyAnchorId = (await database.appendMessage(agent.channelId, 'user', 'The project nickname is Aurora.')).id;
      for (let index = 0; index < 12; index++)
        await database.appendMessage(agent.channelId, 'assistant', `Later message ${index}`);
      const response = await app.inject({
        method: 'POST',
        url: '/api/chat',
        payload: chatPayload(agent, 'Find the older project reference.'),
      });
      expect(captured).toHaveLength(4);
      expect(captured[0].tools?.map(tool => tool.function.name)).toEqual(
        expect.arrayContaining(['read_messages', 'search_messages', 'send_message']),
      );
      expect(JSON.stringify(captured[0].messages)).not.toContain('Aurora');
      expect(JSON.stringify(captured[2].messages)).toContain('Aurora');
      expect(JSON.stringify(captured[3].messages)).toContain(historyAnchorId);
      expect(
        eventsFrom(response.body)
          .filter(event => event.type === 'channel_message')
          .map(event => event.text),
      ).toEqual(['On it', 'The nickname is Aurora']);
    } finally {
      await app.close();
    }
  });
  for (const recovery of [true, false])
    it(`reminds once after an acknowledgment followed by plain output (recovery: ${recovery})`, async () => {
      behavior = recovery ? 'ack-raw' : 'ack-silent';
      captured = [];
      const app = await testApp();
      try {
        const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
        const response = await app.inject({
          method: 'POST',
          url: '/api/chat',
          payload: chatPayload(agent, 'Research this task'),
        });
        const events = eventsFrom(response.body);
        expect(captured).toHaveLength(3);
        expect(events.filter(event => event.type === 'activity' && event.entry.kind === 'reminder')).toHaveLength(1);
        expect(events.filter(event => event.type === 'channel_message').map(event => event.text)).toEqual(
          recovery ? ['On it', 'Recovered result'] : ['On it'],
        );
        expect(JSON.stringify(channelEvents(response.body))).not.toContain('PRIVATE');
        expect(events.some(event => event.type === 'error')).toBe(!recovery);
      } finally {
        await app.close();
      }
    });
  it('continues after its caller disconnects and can be observed again without restarting inference', async () => {
    behavior = 'tool';
    captured = [];
    let release!: () => void;
    argumentGate = new Promise<void>(resolve => {
      release = resolve;
    });
    const app = await testApp();
    const controller = new AbortController();
    try {
      const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      const input = chatPayload(agent);
      const response = await fetch(`${address}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      for await (const event of streamed(response)) {
        if (event.type === 'typing' && event.active) break;
      }
      const observer = streamed(
        await fetch(`${address}/api/events`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        }),
      );
      const snapshot = (await observer.next()).value;
      expect(snapshot).toMatchObject({
        type: 'snapshot',
        runs: [
          expect.objectContaining({
            agentId: agent.id,
            channelId: agent.channelId,
            clientMessageId: input.clientMessageId,
            typing: true,
          }),
        ],
      });
      release();
      const observed = [];
      for await (const event of observer) {
        observed.push(event);
        if (event.type === 'done') break;
      }
      expect(observed.some(event => event.type === 'channel_message' && event.text === 'Published hello')).toBe(true);
      expect(
        (await app.inject(`/api/channels/${agent.channelId}/messages`))
          .json()
          .messages.map((row: { text: string }) => row.text),
      ).toEqual(['Hello', 'Published hello']);
      expect(captured).toHaveLength(1);
    } finally {
      controller.abort();
      release();
      argumentGate = undefined;
      await app.close();
    }
  }, 20000);

  it('persists the result even when no dashboard is connected at completion', async () => {
    behavior = 'tool';
    captured = [];
    let release!: () => void;
    argumentGate = new Promise<void>(resolve => {
      release = resolve;
    });
    const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
    const app = await testApp(database);
    const controller = new AbortController();
    try {
      const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      const input = chatPayload(agent);
      const response = await fetch(`${address}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'respond-async' },
        body: JSON.stringify(input),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({
        run: { agentId: agent.id, clientMessageId: input.clientMessageId },
        message: { id: input.clientMessageId, text: 'Hello' },
      });
      release();
      await vi.waitFor(
        async () =>
          expect((await database.messages(agent.channelId)).messages.map(row => row.text)).toEqual([
            'Hello',
            'Published hello',
          ]),
        { timeout: 5000 },
      );
      expect(captured).toHaveLength(1);
    } finally {
      controller.abort();
      release();
      argumentGate = undefined;
      await app.close();
    }
  }, 20000);

  it('stops a backend-owned run explicitly and rejects a stale stop target', async () => {
    behavior = 'tool';
    let release!: () => void;
    argumentGate = new Promise<void>(resolve => {
      release = resolve;
    });
    const app = await testApp();
    const controller = new AbortController();
    try {
      const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      const input = chatPayload(agent);
      const response = await fetch(`${address}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      for await (const event of streamed(response)) {
        if (event.type === 'typing' && event.active) break;
      }
      const url = `/api/agents/${agent.id}/stop`;
      expect(
        (await app.inject({ method: 'POST', url, payload: { clientMessageId: crypto.randomUUID() } })).json(),
      ).toEqual({ stopped: false });
      expect(
        (await app.inject({ method: 'POST', url, payload: { clientMessageId: input.clientMessageId } })).json(),
      ).toEqual({ stopped: true });
      expect(
        (await app.inject(`/api/channels/${agent.channelId}/messages`))
          .json()
          .messages.map((row: { role: string }) => row.role),
      ).toEqual(['user']);
    } finally {
      controller.abort();
      release();
      argumentGate = undefined;
      await app.close();
    }
  }, 20000);
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
      expect(
        (await app.inject({ method: 'DELETE', url, payload: { confirmation: `${agent.name} ` } })).statusCode,
      ).toBe(400);
      expect((await app.inject(`/api/channels/${agent.channelId}/messages`)).json().messages).toHaveLength(2);
      expect((await app.inject({ method: 'DELETE', url, payload: { confirmation: agent.name } })).statusCode).toBe(200);
      expect((await app.inject(`/api/channels/${agent.channelId}/messages`)).statusCode).toBe(404);
      expect(await database.client.message.count({ where: { channelId: agent.channelId } })).toBe(0);
      expect((await app.inject('/api/agents')).json().agents.map((row: { id: string }) => row.id)).toEqual([other.id]);
      expect((await app.inject('/api/model-endpoints')).json()).toHaveLength(1);
      expect((await app.inject({ method: 'DELETE', url, payload: { confirmation: agent.name } })).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
  it('sends files with or without text, shows them in history, and gives the agent references only', async () => {
    behavior = 'tool';
    captured = [];
    const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
    const app = await testApp(database);
    try {
      const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      const upload = await app.inject({
        method: 'POST',
        url: `/api/files?channelKey=chat:${agent.channelId}&name=plan.md`,
        headers: { 'content-type': 'text/markdown' },
        payload: 'SECRET PLAN CONTENT',
      });
      expect(upload.statusCode).toBe(201);
      const file = upload.json();
      expect((await app.inject({ method: 'POST', url: '/api/chat', payload: chatPayload(agent, '') })).statusCode).toBe(
        400,
      );
      const sent = await app.inject({
        method: 'POST',
        url: '/api/chat',
        payload: { ...chatPayload(agent, ''), fileIds: [file.id] },
      });
      expect(sent.statusCode).toBe(200);
      const [first] = (await app.inject(`/api/channels/${agent.channelId}/messages`)).json().messages;
      expect(first.files).toMatchObject([{ id: file.id, name: 'plan.md', status: 'available' }]);
      expect((await app.inject('/api/agents')).json().agents[0].lastMessage).toBeDefined();
      const prompt = JSON.stringify(captured[0].messages);
      expect(prompt).toContain(`fileId ${file.id}`);
      expect(prompt).not.toContain('SECRET PLAN CONTENT');
      // A file is sent once; someone else's upload cannot be attached.
      const again = await app.inject({
        method: 'POST',
        url: '/api/chat',
        payload: { ...chatPayload(agent, 'again'), fileIds: [file.id] },
      });
      expect(again.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });
  it('creates subscription agents only when connected and rejects sends after disconnect', async () => {
    const model = {
      ...getModels('openai-codex')[0],
      id: 'new-codex-model',
      thinkingLevelMap: { off: null, max: 'max' },
    };
    const codex = new CodexProvider();
    vi.spyOn(codex, 'runtime').mockResolvedValue({
      getModel: (_provider: string, id: string) => (id === model.id ? model : undefined),
    } as unknown as Awaited<ReturnType<CodexProvider['runtime']>>);
    const status = vi
      .spyOn(codex, 'status')
      .mockResolvedValue({ connected: true, models: [model.id], login: { state: 'connected' } });
    const app = await testApp(undefined, codex);
    try {
      const capabilities = (
        await app.inject(
          `/api/agents/model-capabilities?model=${encodeURIComponent(model.id)}&endpointId=${encodeURIComponent(CODEX_CONNECTION)}`,
        )
      ).json();
      expect(capabilities.thinkingLevels).toContain('max');
      expect(capabilities.thinkingLevels).not.toContain('off');
      const input = { ...configuration, endpointId: CODEX_CONNECTION, model: model.id, thinkingLevel: 'max' };
      const created = await app.inject({ method: 'POST', url: '/api/agents', payload: input });
      expect(created.statusCode).toBe(200);
      expect(created.json().endpointId).toBe(CODEX_CONNECTION);
      status.mockResolvedValue({ connected: false, models: [], login: { state: 'idle' } });
      expect((await app.inject({ method: 'POST', url: '/api/agents', payload: input })).statusCode).toBe(400);
      expect(
        (await app.inject({ method: 'POST', url: '/api/chat', payload: chatPayload(created.json()) })).statusCode,
      ).toBe(400);
      expect((await app.inject(`/api/channels/${created.json().channelId}/messages`)).json().messages).toEqual([]);
    } finally {
      await app.close();
    }
  });
  it('exposes only send_message, keeps input literal, and has no session file', async () => {
    behavior = 'tool';
    captured = [];
    const published: string[] = [];
    const session = await createChatSession(
      {
        ...configuration,
        thinkingLevel: 'off',
        baseUrl,
        apiKey: '!literal-key-$NOT_AN_ENV_LOOKUP',
        channel: { id: 'test-channel', agentId: 'test-agent', kind: 'platform-chat' },
      },
      [],
      text => {
        published.push(text);
      },
    );
    try {
      expect(session.sessionFile).toBeUndefined();
      expect(session.agent.state.tools.map(tool => tool.name)).toEqual(['send_message']);
      expect(session.agent.state.systemPrompt).toContain(
        'Your private Pi working session is not the dashboard chat app',
      );
      expect(session.agent.state.systemPrompt).toContain('Assistant text in your session may be internal');
      await session.prompt('!pwd /skill:private @/etc/passwd', { expandPromptTemplates: false });
      expect(published).toEqual(['Published hello']);
      expect(captured).toHaveLength(1);
      expect(captured[0].tools?.map(tool => tool.function.name)).toEqual(['send_message']);
      expect(captured[0].messages.at(-1)?.content).toEqual([
        { type: 'text', text: '!pwd /skill:private @/etc/passwd' },
      ]);
      expect(captured[0].messages[0].content).not.toContain('Working rules');
      expect(captured[0]).not.toHaveProperty('reasoning_effort');
      expect(authorization).toBe('Bearer !literal-key-$NOT_AN_ENV_LOOKUP');
      const tool = session.agent.state.tools[0];
      await expect(
        tool.execute('forbidden', { channelId: 'different-channel', text: 'Do not publish' }),
      ).rejects.toThrow();
      expect(published).toHaveLength(1);
    } finally {
      session.dispose();
    }
  });

  it('publishes acknowledgments without ending the turn and labels channel input', async () => {
    const published: string[] = [];
    const session = await createChatSession(
      {
        ...configuration,
        thinkingLevel: 'off',
        baseUrl,
        channel: { id: 'test-channel', agentId: 'test-agent', kind: 'platform-chat' },
      },
      [{ role: 'user', text: 'Earlier request' }],
      text => {
        published.push(text);
      },
    );
    try {
      const tool = session.agent.state.tools[0];
      const acknowledgment = await tool.execute('ack', { channelId: 'test-channel', text: 'On it', final: false });
      expect(acknowledgment.terminate).not.toBe(true);
      const result = await tool.execute('result', { channelId: 'test-channel', text: 'Done', final: true });
      expect(result.terminate).toBe(true);
      expect(published).toEqual(['On it', 'Done']);
      expect(session.agent.state.systemPrompt).toContain('Acknowledge');
      expect(JSON.stringify(session.messages[0])).toContain('test-channel');
    } finally {
      session.dispose();
    }
  });

  it('does not inherit an API key for a keyless endpoint', async () => {
    behavior = 'tool';
    const session = await createChatSession(
      {
        ...configuration,
        thinkingLevel: 'off',
        baseUrl,
        channel: { id: 'test-channel', agentId: 'test-agent', kind: 'platform-chat' },
      },
      [],
      () => {},
    );
    try {
      await session.prompt('Hello', { expandPromptTemplates: false });
      expect(authorization).toBeUndefined();
    } finally {
      session.dispose();
    }
  });

  it('supports standard reasoning_effort for a Pi-known model and disables unknown controls', async () => {
    expect(modelCapabilities('test-model').thinkingLevels).toEqual(['off']);
    expect(modelCapabilities('gpt-5').thinkingLevels).toContain('medium');
    behavior = 'tool';
    captured = [];
    const session = await createChatSession(
      {
        ...configuration,
        model: 'gpt-5',
        thinkingLevel: 'medium',
        baseUrl,
        channel: { id: 'test-channel', agentId: 'test-agent', kind: 'platform-chat' },
      },
      [],
      () => {},
    );
    try {
      await session.prompt('Hello', { expandPromptTemplates: false });
      expect(captured[0].reasoning_effort).toBe('medium');
    } finally {
      session.dispose();
    }
  });

  it('keeps operator activity separate from tool-published channel messages', async () => {
    behavior = 'tool';
    const app = await testApp();
    try {
      const created = await app.inject({ method: 'POST', url: '/api/agents', payload: configuration });
      expect(created.statusCode).toBe(200);
      const agent = created.json();
      const response = await app.inject({
        method: 'POST',
        url: '/api/chat',
        payload: chatPayload(agent, 'Hello again'),
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('Published hello');
      const activity = eventsFrom(response.body).filter(event => event.type === 'activity');
      expect(
        activity.some(event => event.entry.kind === 'thinking' && event.entry.text.includes('PRIVATE THINKING')),
      ).toBe(true);
      expect(
        activity.some(event => event.entry.kind === 'assistant' && event.entry.text.includes('PRIVATE DIRECT OUTPUT')),
      ).toBe(true);
      expect(activity.some(event => event.entry.kind === 'tool_call')).toBe(true);
      expect(activity.some(event => event.entry.kind === 'tool_result')).toBe(true);
      expect(activity.every(event => event.agentId === agent.id)).toBe(true);
      const saved = (await app.inject(`/api/agents/${agent.id}/activity`)).json().entries;
      expect(saved).toEqual(
        activity.reduce((rows: any[], event) => {
          const at = rows.findIndex(row => row.id === event.entry.id);
          if (at < 0) rows.push(event.entry);
          else rows[at] = event.entry;
          return rows;
        }, []),
      );
      expect(new Set(saved.map((entry: { id: string }) => entry.id)).size).toBe(saved.length);
      const events = channelEvents(response.body);
      expect(JSON.stringify(events)).not.toContain('PRIVATE');
      expect(events.map(event => event.type)).toEqual(['typing', 'typing', 'channel_message', 'done']);
      expect(events[0]).toEqual({ type: 'typing', channelId: agent.channelId, active: true });
      expect(events[1]).toEqual({ type: 'typing', channelId: agent.channelId, active: false });
      expect(events[2].channelId).toBe(agent.channelId);
      expect(response.headers['cache-control']).toContain('no-store');
    } finally {
      await app.close();
    }
  });

  it('acknowledges, executes a web tool, then publishes the result in the same channel', async () => {
    behavior = 'research';
    captured = [];
    const app = await testApp();
    try {
      const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      const response = await app.inject({
        method: 'POST',
        url: '/api/chat',
        payload: chatPayload(agent, 'Research this'),
      });
      const events = eventsFrom(response.body);
      expect(events.filter(event => event.type === 'channel_message').map(event => event.text)).toEqual([
        'On it',
        'Research complete',
      ]);
      expect(captured).toHaveLength(3);
      expect(JSON.stringify(captured[0].messages.at(-1))).toContain(agent.channelId);
      const ack = events.findIndex(event => event.type === 'channel_message' && event.text === 'On it');
      const work = events.findIndex(
        event =>
          event.type === 'activity' &&
          event.entry.kind === 'tool_call' &&
          JSON.stringify(event).includes('get_search_content'),
      );
      const result = events.findIndex(event => event.type === 'channel_message' && event.text === 'Research complete');
      expect(ack).toBeLessThan(work);
      expect(work).toBeLessThan(result);
      expect(
        (await app.inject(`/api/channels/${agent.channelId}/messages`))
          .json()
          .messages.map((message: { text: string }) => message.text),
      ).toEqual(['Research this', 'On it', 'Research complete']);
    } finally {
      await app.close();
    }
  }, 15000);

  it.each(['tool', 'dm-typing'] as const)(
    'emits destination-scoped typing while message content streams (%s)',
    async mode => {
      behavior = mode;
      let release!: () => void;
      argumentGate = new Promise<void>(resolve => {
        release = resolve;
      });
      const app = await testApp();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
        const address = await app.listen({ host: '127.0.0.1', port: 0 });
        const response = await fetch(`${address}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(chatPayload(agent)),
          signal: controller.signal,
        });
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/api/chat',
              headers: { prefer: 'respond-async' },
              payload: chatPayload(agent, 'Concurrent message'),
            })
          ).statusCode,
        ).toBe(202);
        expect(
          (
            await app.inject({
              method: 'DELETE',
              url: `/api/agents/${agent.id}`,
              payload: { confirmation: agent.name },
            })
          ).statusCode,
        ).toBe(409);
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
            const event = JSON.parse(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 1);
            if (event.type === 'typing') typing = event;
          }
        }
        expect(typing).toMatchObject({
          type: 'typing',
          channelId: agent.channelId,
          active: true,
          targets: [mode === 'dm-typing' ? `dm:${[agent.id, 'unavailable-peer'].sort().join(':')}` : agent.channelId],
          runId: expect.any(String),
          eventId: expect.any(String),
        });
        await vi.waitFor(async () => {
          const active = (await app.inject(`/api/agents/${agent.id}/activity`)).json().entries;
          expect(active.some((entry: { label: string }) => entry.label === 'Run active')).toBe(true);
          expect(JSON.stringify(active)).toContain('PRIVATE DIRECT OUTPUT');
        });
        release();
        let rest = buffer;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          rest += decoder.decode(value, { stream: true });
        }
        reader.releaseLock();
        expect(rest).toContain('"active":false');
        if (mode === 'tool') expect(rest).toContain('Published hello');
        else expect(eventsFrom(rest).some(event => event.type === 'channel_message')).toBe(false);
        expect(JSON.stringify(channelEvents(rest))).not.toContain('PRIVATE');
      } finally {
        clearTimeout(timeout);
        controller.abort();
        release();
        argumentGate = undefined;
        await app.close();
      }
    },
  );

  it('allows intentional silence after exactly one private reminder without displaying raw output', async () => {
    behavior = 'raw';
    captured = [];
    const app = await testApp();
    try {
      const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      const response = await app.inject({ method: 'POST', url: '/api/chat', payload: chatPayload(agent) });
      expect(captured).toHaveLength(2);
      expect(JSON.stringify(captured[1].messages)).toContain('Automatic channel reminder:');
      expect(JSON.stringify(captured[1].messages)).toContain(
        'If no reply was appropriate or the user requested silence, remain silent.',
      );
      expect(channelEvents(response.body)).toEqual([{ type: 'done' }]);
      expect(
        eventsFrom(response.body).some(event => event.type === 'activity' && event.entry.kind === 'reminder'),
      ).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('lets the agent publish after a reminder visible only to the operator inspector', async () => {
    behavior = 'after-reminder';
    captured = [];
    const app = await testApp();
    try {
      const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      const response = await app.inject({ method: 'POST', url: '/api/chat', payload: chatPayload(agent) });
      expect(captured).toHaveLength(2);
      expect(response.body).toContain('Published hello');
      expect(JSON.stringify(channelEvents(response.body))).not.toContain('Automatic channel reminder');
      expect(JSON.stringify(channelEvents(response.body))).not.toContain('PRIVATE');
    } finally {
      await app.close();
    }
  });

  it.each(['http-error', 'truncated'] as const)(
    'records an unsuccessful model request without reminding (%s)',
    async mode => {
      behavior = mode;
      captured = [];
      const app = await testApp();
      try {
        const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
        const response = await app.inject({ method: 'POST', url: '/api/chat', payload: chatPayload(agent) });
        expect(captured).toHaveLength(1);
        expect(response.body).toContain('"type":"error"');
        expect(JSON.stringify(channelEvents(response.body))).not.toContain('PRIVATE');
        expect(response.body).not.toContain('!literal-key-$NOT_AN_ENV_LOOKUP');
        const saved = (await app.inject(`/api/agents/${agent.id}/activity`)).body;
        expect(saved).not.toContain('!literal-key-$NOT_AN_ENV_LOOKUP');
        expect(saved).not.toContain('PRIVATE PROVIDER ERROR');
        if (mode === 'http-error') expect(saved).toContain('The provider request failed. Check the model connection.');
        expect(saved).toContain('Run failed');
      } finally {
        await app.close();
      }
    },
  );

  it('does not publish or persist an assistant message when its database write fails', async () => {
    behavior = 'publication-error';
    const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, 'failed-publication.db'));
    const append = database.appendMessage.bind(database);
    vi.spyOn(database, 'appendMessage').mockImplementation((channel, role, text, id) =>
      role === 'assistant' ? Promise.reject(new Error('Storage unavailable')) : append(channel, role, text, id),
    );
    const app = await testApp(database);
    try {
      const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      const response = await app.inject({ method: 'POST', url: '/api/chat', payload: chatPayload(agent) });
      expect(channelEvents(response.body).some(event => event.type === 'channel_message')).toBe(false);
      expect(
        (await app.inject(`/api/channels/${agent.channelId}/messages`))
          .json()
          .messages.map((row: { role: string }) => row.role),
      ).toEqual(['user']);
    } finally {
      await app.close();
    }
  });

  it('restores agents and published history after restart, with server-owned context', async () => {
    behavior = 'tool';
    captured = [];
    const path = join(process.env.SQLITE_TEST_ROOT!, 'restart-chat.db');
    const first = await testApp(await prepareDatabase(path));
    const agent = (await first.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
    const sent = chatPayload(agent, 'Earlier question');
    expect(agent).not.toHaveProperty('token');
    try {
      expect((await first.inject({ method: 'POST', url: '/api/chat', payload: sent })).statusCode).toBe(200);
    } finally {
      await first.close();
    }
    const second = await testApp(new PlatformStore(pathToFileURL(resolve(path)).href));
    try {
      const listed = (await second.inject('/api/agents')).json();
      expect(listed.agents[0].id).toBe(agent.id);
      const messages = (await second.inject(`/api/channels/${agent.channelId}/messages`)).json().messages;
      expect(messages.map((row: { text: string }) => row.text)).toEqual(['Earlier question', 'Published hello']);
      expect(JSON.stringify(messages)).not.toContain('PRIVATE');
      expect((await second.inject({ method: 'POST', url: '/api/chat', payload: sent })).statusCode).toBe(409);
      expect(captured).toHaveLength(1);
      const response = await second.inject({
        method: 'POST',
        url: '/api/chat',
        payload: {
          ...chatPayload(agent, 'Next question'),
          history: [{ role: 'assistant', text: 'FORGED HISTORY' }],
          model: 'FORGED MODEL',
        },
      });
      expect(response.statusCode).toBe(200);
      expect(captured[1].model).toBe('test-model');
      expect(JSON.stringify(captured[1].messages)).toContain('Earlier question');
      expect(JSON.stringify(captured[1].messages)).toContain('Published hello');
      expect(JSON.stringify(captured[1].messages)).not.toContain('FORGED');
      expect(JSON.stringify(captured[1].messages)).toContain('PRIVATE DIRECT OUTPUT'); // Private Pi context now survives a restart.
      expect(JSON.stringify((await second.inject(`/api/channels/${agent.channelId}/messages`)).json())).not.toContain(
        'PRIVATE',
      );
      expect((await second.inject('/api/channels/missing/messages')).statusCode).toBe(404);
      expect(
        (await second.inject({ method: 'POST', url: '/api/chat', payload: chatPayload({ id: 'missing' }) })).statusCode,
      ).toBe(404);
    } finally {
      await second.close();
    }
    // Two real 1.5-second debounce windows plus SDK/SQLite restart I/O need
    // headroom on shared CI runners; all persistence assertions remain intact.
  }, 15000);
  it('edits name, model and thinking level in place, keeps history, and refuses invalid choices or edits during a turn', async () => {
    behavior = 'tool';
    captured = [];
    const app = await testApp();
    try {
      const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      const renamed = await app.inject({
        method: 'PATCH',
        url: `/api/agents/${agent.id}`,
        payload: { name: '  Renamed agent  ', model: 'other-model' },
      });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json()).toMatchObject({
        id: agent.id,
        channelId: agent.channelId,
        name: 'Renamed agent',
        model: 'other-model',
        endpointId: 'endpoint',
        thinkingLevel: 'off',
      });
      expect((await app.inject('/api/agents')).json().agents[0]).toMatchObject({
        name: 'Renamed agent',
        model: 'other-model',
      });
      expect(
        (await app.inject({ method: 'PATCH', url: `/api/agents/${agent.id}`, payload: { endpointId: 'nope' } }))
          .statusCode,
      ).toBe(400);
      expect(
        (await app.inject({ method: 'PATCH', url: `/api/agents/${agent.id}`, payload: { thinkingLevel: 'high' } }))
          .statusCode,
      ).toBe(400); // unsupported by this model
      expect(
        (await app.inject({ method: 'PATCH', url: `/api/agents/${agent.id}`, payload: { name: '   ' } })).statusCode,
      ).toBe(400);
      expect((await app.inject({ method: 'PATCH', url: `/api/agents/${agent.id}`, payload: {} })).statusCode).toBe(400);
      expect(
        (await app.inject({ method: 'PATCH', url: '/api/agents/missing', payload: { name: 'Ghost' } })).statusCode,
      ).toBe(404);
      // The next turn uses the new identity and model.
      const sent = chatPayload(agent, 'Hello again');
      const started = await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: { prefer: 'respond-async' },
        payload: sent,
      });
      expect(started.statusCode).toBe(202);
      expect(
        (await app.inject({ method: 'PATCH', url: `/api/agents/${agent.id}`, payload: { name: 'Mid turn' } }))
          .statusCode,
      ).toBe(409);
      await vi.waitFor(async () => expect(captured.length).toBeGreaterThan(0), { timeout: 8000 });
      expect(captured[0].model).toBe('other-model');
      expect(String(captured[0].messages[0]?.content)).toContain('You are Renamed agent.');
      await app.inject({
        method: 'POST',
        url: `/api/agents/${agent.id}/stop`,
        payload: { clientMessageId: sent.clientMessageId },
      });
    } finally {
      await app.close();
    }
  }, 20000);
});

describe('agent deletion order', () => {
  it('keeps the agent and its screenshots when the database delete fails, and removes both once it succeeds', async () => {
    behavior = 'tool';
    captured = [];
    const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
    const app = await testApp(database);
    const { mkdir, writeFile, access } = await import('node:fs/promises');
    try {
      const agent = (await app.inject({ method: 'POST', url: '/api/agents', payload: configuration })).json();
      const pool = join(database.dataDirectory, 'computer-screenshots');
      await mkdir(pool, { recursive: true });
      const file = join(pool, `${agent.id}_${crypto.randomUUID()}.jpg`);
      await writeFile(file, Buffer.from([255, 216, 255, 217]));
      const failing = vi.spyOn(PlatformStore.prototype, 'deleteAgent').mockRejectedValueOnce(new Error('disk full'));
      const failed = await app.inject({
        method: 'DELETE',
        url: `/api/agents/${agent.id}`,
        payload: { confirmation: configuration.name },
      });
      expect(failed.statusCode).toBe(503);
      failing.mockRestore();
      expect((await app.inject('/api/agents')).json().agents).toHaveLength(1);
      await access(file); // the image is still there
      const ok = await app.inject({
        method: 'DELETE',
        url: `/api/agents/${agent.id}`,
        payload: { confirmation: configuration.name },
      });
      expect(ok.statusCode).toBe(200);
      await expect(access(file)).rejects.toThrow();
    } finally {
      await app.close();
    }
  });
});
