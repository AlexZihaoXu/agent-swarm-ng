import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareDatabase } from './test-database';
import { buildApp } from './app';
import { EndpointStore } from './endpoint-store';

/** Two mock endpoints, /a and /b: each answers per its mode, and publishes "From a" or "From b" when it works. */
let server: Server;
let origin: string;
let folder: string;
const modes: Record<string, 'ok' | '401' | '503'> = { a: 'ok', b: 'ok', c: 'ok', d: 'ok', e: 'ok' };
let calls: string[] = [];
/** Each endpoint's last request body, as text. */
const bodies: Record<string, string> = {};
/** Called before a mock endpoint answers (a test's hook), and whether its message ends the turn. */
let onCall: ((endpoint: string) => void) | undefined;
let final = (_endpoint: string) => true;

vi.setConfig({ testTimeout: 20_000 });

beforeAll(async () => {
  await mkdir('.scratch', { recursive: true });
  folder = await mkdtemp(join('.scratch', 'model-fallback-test-'));
  server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      model: string;
      messages: { role: string; content: unknown }[];
    };
    const endpoint = request.url?.split('/')[1] ?? '';
    calls.push(endpoint);
    bodies[endpoint] = JSON.stringify(body);
    onCall?.(endpoint);
    if (modes[endpoint] === '401') return void response.writeHead(401).end('PRIVATE PROVIDER ERROR: bad key');
    if (modes[endpoint] === '503') return void response.writeHead(503).end('PRIVATE PROVIDER ERROR: busy');
    // A summary request (compaction) has no tools: it gets plain text.
    if (!(body as { tools?: unknown[] }).tools?.length) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(
        `data: ${JSON.stringify({ id: 's', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content: 'SUMMARY OF EARLIER WORK' }, finish_reason: 'stop' }] })}\n\n`,
      );
      return void response.end('data: [DONE]\n\n');
    }
    const system = body.messages.find(message => message.role === 'system')?.content;
    const channelId = (typeof system === 'string' ? system : '').match(/channel is ([\w-]+)\./)?.[1];
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta: object, finish_reason: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({ id: 't', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    chunk({
      role: 'assistant',
      tool_calls: [
        {
          index: 0,
          id: `call-${calls.length}`,
          type: 'function',
          function: {
            name: 'send_message',
            arguments: JSON.stringify({ channelId, text: `From ${endpoint}`, final: final(endpoint) }),
          },
        },
      ],
    });
    chunk({}, 'tool_calls');
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(folder, { recursive: true, force: true });
});

async function testApp() {
  const store = new EndpointStore(join(folder, `${crypto.randomUUID()}.json`));
  await store.save({ id: 'a', name: 'A', baseUrl: `${origin}/a/v1`, apiKey: 'secret-key-a' });
  await store.save({ id: 'b', name: 'B', baseUrl: `${origin}/b/v1`, apiKey: 'secret-key-b' });
  // A model far too small for any conversation.
  await store.save({ id: 'c', name: 'C', baseUrl: `${origin}/c/v1`, apiKey: 'secret-key-c', contextWindow: 1024 });
  // One a long message alone is too big for: it cannot even be compacted into.
  await store.save({ id: 'e', name: 'E', baseUrl: `${origin}/e/v1`, apiKey: 'secret-key-e', contextWindow: 8192 });
  // One the conversation outgrows after a few long messages.
  await store.save({ id: 'd', name: 'D', baseUrl: `${origin}/d/v1`, apiKey: 'secret-key-d', contextWindow: 16384 });
  return buildApp({
    requireLogin: false,
    endpointStore: store,
    database: await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`)),
  });
}

const choice = (endpointId: string, options: object = {}) => ({
  endpointId,
  model: `model-${endpointId}`,
  thinkingLevel: 'off',
  attempts: 3,
  tooBig: 'skip',
  comeBack: 5,
  ...options,
});

async function agentWith(app: Awaited<ReturnType<typeof testApp>>, models: object[]) {
  const agent = (
    await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: { name: 'Fallback test', endpointId: 'a', model: 'model-a', thinkingLevel: 'off' },
    })
  ).json();
  const saved = await app.inject({ method: 'PATCH', url: `/api/agents/${agent.id}`, payload: { models } });
  expect(saved.statusCode).toBe(200);
  return saved.json() as { id: string; models: object[]; activeModel: number };
}

const chat = (app: Awaited<ReturnType<typeof testApp>>, agentId: string, message = 'Hello') =>
  app.inject({
    method: 'POST',
    url: '/api/chat',
    payload: { agentId, clientMessageId: crypto.randomUUID(), message },
  });
const published = (body: string) =>
  body
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))
    .filter(event => event.type === 'channel_message')
    .map(event => event.text);

describe('fallback models', () => {
  it('moves to #2 at once when #1 rejects its login, and stays on it', async () => {
    Object.assign(modes, { a: '401', b: 'ok' });
    calls = [];
    const app = await testApp();
    try {
      const agent = await agentWith(app, [choice('a'), choice('b')]);
      expect(agent.models).toHaveLength(2);
      const response = await chat(app, agent.id);
      expect(published(response.body)).toEqual(['From b']);
      expect(calls).toEqual(['a', 'b']);
      const activity = (await app.inject(`/api/agents/${agent.id}/activity`)).body;
      expect(activity).toContain('Model fallback');
      expect(activity).toContain('authentication, HTTP 401');
      expect(activity).not.toContain('PRIVATE PROVIDER ERROR');
      expect(activity).not.toContain('secret-key');
      const listed = (await app.inject('/api/agents')).json().agents[0];
      expect(listed.activeModel).toBe(1);
      // The next run starts on #2 (its come-back time has not passed).
      calls = [];
      expect(published((await chat(app, agent.id)).body)).toEqual(['From b']);
      expect(calls).toEqual(['b']);
      // "Use #1 again".
      Object.assign(modes, { a: 'ok' });
      expect(
        (await app.inject({ method: 'POST', url: `/api/agents/${agent.id}/models/first` })).json().activeModel,
      ).toBe(0);
      calls = [];
      expect(published((await chat(app, agent.id)).body)).toEqual(['From a']);
      expect(calls).toEqual(['a']);
    } finally {
      await app.close();
    }
  });

  it('tries a busy #1 its number of attempts before moving on', async () => {
    Object.assign(modes, { a: '503', b: 'ok' });
    calls = [];
    const app = await testApp();
    try {
      const agent = await agentWith(app, [choice('a', { attempts: 2 }), choice('b')]);
      expect(published((await chat(app, agent.id)).body)).toEqual(['From b']);
      expect(calls).toEqual(['a', 'a', 'b']);
      const activity = (await app.inject(`/api/agents/${agent.id}/activity`)).body;
      expect(activity).toContain('Model retry');
    } finally {
      await app.close();
    }
  });

  it('fails the run when every model fails', async () => {
    Object.assign(modes, { a: '401', b: '401' });
    calls = [];
    const app = await testApp();
    try {
      const agent = await agentWith(app, [choice('a'), choice('b')]);
      const response = await chat(app, agent.id);
      expect(published(response.body)).toEqual([]);
      expect(response.body).toContain('"type":"error"');
      expect(calls).toEqual(['a', 'b']);
      expect((await app.inject(`/api/agents/${agent.id}/activity`)).body).toContain('No model left');
    } finally {
      await app.close();
    }
  });

  it('within a run, the next call after the come-back time tries #1 again', async () => {
    Object.assign(modes, { a: '401', b: 'ok' });
    calls = [];
    let offset = 0;
    const now = Date.now;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now() + offset);
    const app = await testApp();
    try {
      const agent = await agentWith(app, [choice('a', { comeBack: 1 }), choice('b')]);
      // #2 answers with a progress message (the turn goes on); meanwhile #1 is fixed and a minute passes.
      final = endpoint => endpoint !== 'b';
      onCall = endpoint => {
        if (endpoint !== 'b') return;
        modes.a = 'ok';
        offset += 61_000;
      };
      expect(published((await chat(app, agent.id)).body)).toEqual(['From b', 'From a']);
      expect(calls).toEqual(['a', 'b', 'a']);
      expect((await app.inject('/api/agents')).json().agents[0].activeModel).toBe(0);
      expect((await app.inject(`/api/agents/${agent.id}/activity`)).body).toContain('Model recovered');
    } finally {
      clock.mockRestore();
      onCall = undefined;
      final = () => true;
      await app.close();
    }
  });

  it('skips a model the conversation does not fit', async () => {
    Object.assign(modes, { a: '401', b: 'ok', c: 'ok' });
    calls = [];
    const app = await testApp();
    try {
      const agent = await agentWith(app, [choice('a'), choice('c'), choice('b')]);
      expect(published((await chat(app, agent.id)).body)).toEqual(['From b']);
      expect(calls).toEqual(['a', 'b']);
      expect((await app.inject(`/api/agents/${agent.id}/activity`)).body).toContain(
        'The conversation is bigger than its context.',
      );
      // The next run does not start on the small model either (its fit is checked before the session exists).
      calls = [];
      expect(published((await chat(app, agent.id)).body)).toEqual(['From b']);
      expect(calls).toEqual(['b']);
    } finally {
      await app.close();
    }
  });

  it('compacts first to use a smaller model when it may', async () => {
    Object.assign(modes, { a: 'ok', d: 'ok' });
    calls = [];
    const app = await testApp();
    try {
      const agent = await agentWith(app, [choice('a'), choice('d', { tooBig: 'compact' })]);
      // A long conversation on #1 (each message about 3,000 tokens).
      for (let index = 0; index < 5; index++)
        expect(published((await chat(app, agent.id, `Notes ${index}: ${'lorem ipsum '.repeat(1000)}`)).body)).toEqual([
          'From a',
        ]);
      modes.a = '401';
      calls = [];
      expect(published((await chat(app, agent.id)).body)).toEqual(['From d']);
      // The notes are more than one pass can read: two summary passes (a rolling summary), then the answer.
      expect(calls).toEqual(['a', 'd', 'd', 'd']);
      const activity = (await app.inject(`/api/agents/${agent.id}/activity`)).body;
      expect(activity).toContain('compacting first to fit its context');
      // The answer was asked with the summary in place of the long notes.
      expect(bodies.d).toContain('SUMMARY OF EARLIER WORK');
      expect(bodies.d).not.toContain('Notes 0:');
    } finally {
      await app.close();
    }
  });

  it('passes over a model it cannot compact into', async () => {
    Object.assign(modes, { a: 'ok', b: 'ok', e: 'ok' });
    calls = [];
    const app = await testApp();
    try {
      const agent = await agentWith(app, [choice('a'), choice('e', { tooBig: 'compact' }), choice('b')]);
      for (let index = 0; index < 3; index++)
        await chat(app, agent.id, `Notes ${index}: ${'lorem ipsum '.repeat(1000)}`);
      modes.a = '401';
      calls = [];
      expect(published((await chat(app, agent.id)).body)).toEqual(['From b']);
      expect(calls).toEqual(['a', 'b']);
      expect((await app.inject(`/api/agents/${agent.id}/activity`)).body).toContain(
        'The conversation could not be compacted to fit its context.',
      );
    } finally {
      await app.close();
    }
  });

  it('sends each model its own reply cap, and sizes it by its own context cap', async () => {
    Object.assign(modes, { a: '401', b: 'ok' });
    calls = [];
    const app = await testApp();
    try {
      const agent = await agentWith(app, [
        choice('a', { contextWindow: 50_000 }),
        choice('b', { maxOutputTokens: 1234, contextWindow: 100_000 }),
      ]);
      expect(agent.models).toMatchObject([
        { contextWindow: 50_000 },
        { maxOutputTokens: 1234, contextWindow: 100_000 },
      ]);
      expect(published((await chat(app, agent.id)).body)).toEqual(['From b']);
      expect(JSON.parse(bodies.b!)).toMatchObject({ max_tokens: 1234 });
      // A window cap alone never raises the reply length above the model's own (8,192 on this endpoint by default).
      expect(JSON.parse(bodies.a!)).toMatchObject({ max_tokens: 8192 });
    } finally {
      await app.close();
    }
  });

  it('refuses a model listed twice', async () => {
    const app = await testApp();
    try {
      const agent = (
        await app.inject({
          method: 'POST',
          url: '/api/agents',
          payload: { name: 'Twice', endpointId: 'a', model: 'model-a', thinkingLevel: 'off' },
        })
      ).json();
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/agents/${agent.id}`,
        payload: { models: [choice('a'), choice('a', { attempts: 1 })] },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().message).toBe('Each model can be in the list once.');
    } finally {
      await app.close();
    }
  });
});
