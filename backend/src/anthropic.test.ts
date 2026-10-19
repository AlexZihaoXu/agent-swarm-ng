import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isContextOverflow, isRetryableAssistantError } from '@earendil-works/pi-ai/compat';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { createChatSession, endpointCapabilities } from './chat-runtime';
import { EndpointStore, endpointView } from './endpoint-store';
import { registerModelEndpoints } from './model-endpoints';
import { anthropicModel, ANTHROPIC_URL } from './anthropic';
import { providerFailure } from './activity-safety';
import { failureReason } from './model-fallback';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const KEY = 'sk-ant-api03-test-secret';
const storeFile = () => join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.json`);

/** The model-endpoint routes for one signed-in person, with mocked outbound fetches. */
function endpointsApp(options: { admin?: boolean; plain?: unknown; pinned?: unknown; store?: EndpointStore }) {
  const app = Fastify();
  app.addHook('onRequest', async request => {
    request.signedIn = { userId: options.admin ? 'admin' : 'sam', name: 'Someone', admin: !!options.admin } as never;
  });
  const store = options.store ?? new EndpointStore(storeFile());
  const asFetch = (value?: unknown) => (value ?? vi.fn()) as typeof fetch;
  registerModelEndpoints(app, asFetch(options.plain), store, undefined, undefined, asFetch(options.pinned));
  return { app, store };
}

describe('Anthropic connections', () => {
  it('are saved with their kind, and the key is never returned', async () => {
    const { app, store } = endpointsApp({ admin: true });
    try {
      const saved = await app.inject({
        method: 'POST',
        url: '/api/model-endpoints',
        payload: { id: 'claude', name: 'Anthropic', baseUrl: `${ANTHROPIC_URL}/`, apiKey: KEY, kind: 'anthropic' },
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({ kind: 'anthropic', baseUrl: ANTHROPIC_URL, hasApiKey: true });
      expect(saved.body).not.toContain(KEY);
      const listed = await app.inject({ method: 'GET', url: '/api/model-endpoints' });
      expect(listed.json()).toEqual([expect.objectContaining({ id: 'claude', kind: 'anthropic' })]);
      expect(listed.body).not.toContain(KEY);
      expect((await store.read())[0]).toMatchObject({ kind: 'anthropic', apiKey: KEY });
      // A rename keeps the key; turning it into another kind of API does not carry it over.
      await app.inject({
        method: 'POST',
        url: '/api/model-endpoints',
        payload: { id: 'claude', name: 'Claude', baseUrl: ANTHROPIC_URL },
      });
      expect((await store.read())[0]).toMatchObject({ name: 'Claude', kind: 'anthropic', apiKey: KEY });
      await app.inject({
        method: 'POST',
        url: '/api/model-endpoints',
        payload: { id: 'claude', name: 'Claude', baseUrl: ANTHROPIC_URL, kind: 'openai' },
      });
      expect((await store.read())[0]).toMatchObject({ apiKey: '' });
    } finally {
      await app.close();
    }
  });

  it('refuse a Claude subscription OAuth token (not an API key)', async () => {
    const plain = vi.fn();
    const { app } = endpointsApp({ admin: true, plain });
    try {
      const payload = { baseUrl: ANTHROPIC_URL, apiKey: 'sk-ant-oat01-token', kind: 'anthropic' };
      const save = await app.inject({
        method: 'POST',
        url: '/api/model-endpoints',
        payload: { ...payload, id: 'claude', name: 'Anthropic' },
      });
      expect(save.statusCode).toBe(400);
      expect(save.body).not.toContain('sk-ant-oat01');
      const test = await app.inject({ method: 'POST', url: '/api/model-endpoints/test', payload });
      expect(test.statusCode).toBe(400);
      expect(plain).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('default rows saved before connections had a kind to OpenAI-compatible', async () => {
    const path = storeFile();
    await mkdir(process.env.SQLITE_TEST_ROOT!, { recursive: true });
    await writeFile(path, JSON.stringify([{ id: 'old', name: 'Old', baseUrl: 'https://old.example/v1', apiKey: 'k' }]));
    const rows = await new EndpointStore(path).read();
    expect(endpointView(rows[0]!)).toMatchObject({ id: 'old', kind: 'openai', hasApiKey: true });
    await writeFile(path, JSON.stringify([{ ...rows[0], kind: 'gemini' }]));
    await expect(new EndpointStore(path).read()).rejects.toThrow();
  });

  it('list models from GET /v1/models with the key and version headers, following pages', async () => {
    const pages = [
      { data: [{ id: 'claude-opus-4-8', max_input_tokens: 1_000_000 }], has_more: true, last_id: 'claude-opus-4-8' },
      { data: [{ id: 'claude-haiku-4-5' }], has_more: false, last_id: 'claude-haiku-4-5' },
    ];
    const pinned = vi.fn(async () => Response.json(pages.shift()));
    const { app } = endpointsApp({ pinned: pinned as unknown as typeof fetch });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/model-endpoints/test',
        payload: { baseUrl: ANTHROPIC_URL, apiKey: KEY, kind: 'anthropic' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        models: ['claude-opus-4-8', 'claude-haiku-4-5'],
        details: [{ id: 'claude-opus-4-8', contextWindow: 1_000_000 }],
      });
      expect(response.body).not.toContain(KEY);
      // A user's connection goes through the address-pinned fetch.
      const calls = pinned.mock.calls as unknown as [URL, RequestInit][];
      expect(calls.map(([url]) => String(url))).toEqual([
        `${ANTHROPIC_URL}/v1/models?limit=1000`,
        `${ANTHROPIC_URL}/v1/models?limit=1000&after_id=claude-opus-4-8`,
      ]);
      expect(calls[0]![1]).toMatchObject({
        method: 'GET',
        redirect: 'error',
        headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      });
      expect(calls[0]![1].headers).not.toHaveProperty('Authorization');
    } finally {
      await app.close();
    }
  });

  it('stop listing after a bounded number of pages', async () => {
    const plain = vi.fn(async () =>
      Response.json({ data: [{ id: `m-${crypto.randomUUID()}` }], has_more: true, last_id: crypto.randomUUID() }),
    );
    const { app } = endpointsApp({ admin: true, plain: plain as unknown as typeof fetch });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/model-endpoints/test',
        payload: { baseUrl: ANTHROPIC_URL, apiKey: KEY, kind: 'anthropic' },
      });
      expect(response.json().models).toHaveLength(5);
      expect(plain).toHaveBeenCalledTimes(5);
    } finally {
      await app.close();
    }
  });

  it("test a saved connection with its saved key, and report Anthropic's refusal without its body", async () => {
    const plain = vi.fn(async () => new Response(`{"error":{"message":"bad ${KEY}"}}`, { status: 401 }));
    const { app, store } = endpointsApp({ admin: true, plain: plain as unknown as typeof fetch });
    await store.save(
      { id: 'claude', name: 'Anthropic', baseUrl: ANTHROPIC_URL, apiKey: KEY, kind: 'anthropic' },
      'admin',
    );
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/model-endpoints/test',
        payload: { baseUrl: ANTHROPIC_URL, endpointId: 'claude' },
      });
      expect(response.statusCode).toBe(502);
      expect(response.json().message).toBe('Anthropic returned HTTP 401. Check the base URL and API key.');
      expect(response.body).not.toContain(KEY);
      const [url, init] = plain.mock.calls[0] as unknown as [URL, RequestInit];
      expect(String(url)).toBe(`${ANTHROPIC_URL}/v1/models?limit=1000`);
      expect(init.headers).toMatchObject({ 'x-api-key': KEY });
    } finally {
      await app.close();
    }
  });

  it("refuse a user's private base URL before any request", async () => {
    const pinned = vi.fn();
    const { app } = endpointsApp({ pinned });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/model-endpoints/test',
        payload: { baseUrl: 'http://127.0.0.1:8080', apiKey: KEY, kind: 'anthropic' },
      });
      expect(response.statusCode).toBe(400);
      expect(pinned).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

describe('Anthropic model metadata', () => {
  it("uses Pi's model metadata, with a dated snapshot as its model", () => {
    expect(anthropicModel('claude-haiku-4-5-20251001', ANTHROPIC_URL)).toMatchObject({
      api: 'anthropic-messages',
      provider: 'anthropic',
      contextWindow: 200_000,
      maxTokens: 64_000,
      input: ['text', 'image'],
      cost: { input: 1, output: 5 },
    });
    // Anthropic's own fallback to models the owner did not list is never sent.
    expect(anthropicModel('claude-fable-5', ANTHROPIC_URL).compat).not.toHaveProperty('allowedFallbackModels');
  });

  it('describes a newer model like its family, without turning thinking off, and an unknown one safely', async () => {
    const newer = anthropicModel('claude-opus-5-5', ANTHROPIC_URL);
    expect(newer).toMatchObject({ reasoning: true, contextWindow: 1_000_000, cost: { input: 4, output: 20 } });
    const levels = (await endpointCapabilities('claude-opus-5-5', { baseUrl: ANTHROPIC_URL, kind: 'anthropic' }))
      .thinkingLevels;
    expect(levels).not.toContain('off');
    expect(levels).toContain('high');
    expect(anthropicModel('gateway-model', ANTHROPIC_URL)).toMatchObject({
      reasoning: false,
      contextWindow: 200_000,
      maxTokens: 8192,
      cost: { input: 0, output: 0 },
    });
    expect(anthropicModel('claude-opus-4-8', ANTHROPIC_URL, { contextWindow: 50_000 }).contextWindow).toBe(50_000);
  });
});

function messagesStream(args: object) {
  const events = [
    {
      type: 'message_start',
      message: {
        id: 'msg-1',
        type: 'message',
        role: 'assistant',
        model: 'claude',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1000, output_tokens: 0, cache_read_input_tokens: 500 },
      },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'call-1', name: 'send_message', input: {} },
    },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(args) } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } },
    { type: 'message_stop' },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const config = {
  name: 'Claude',
  baseUrl: ANTHROPIC_URL,
  apiKey: KEY,
  kind: 'anthropic' as const,
  channel: { id: 'channel', agentId: 'agent', kind: 'platform-chat' as const },
};

describe('Anthropic turns', () => {
  it.each([
    { model: 'claude-haiku-4-5', thinkingLevel: 'off' as const, thinking: { type: 'disabled' } },
    {
      model: 'claude-sonnet-4-5',
      thinkingLevel: 'high' as const,
      thinking: { type: 'enabled', budget_tokens: expect.any(Number) },
    },
    { model: 'claude-opus-4-8', thinkingLevel: 'high' as const, thinking: { type: 'adaptive' }, effort: 'high' },
    { model: 'claude-opus-4-8', thinkingLevel: 'low' as const, thinking: { type: 'adaptive' }, effort: 'low' },
  ])(
    "use Pi's Anthropic transport with the connection's key: $model at $thinkingLevel",
    async ({ model, thinkingLevel, thinking, effort }) => {
      vi.stubEnv('ANTHROPIC_API_KEY', 'developer-secret');
      vi.stubEnv('ANTHROPIC_BASE_URL', 'https://developer.example');
      const requests: { url: string; init: RequestInit; body: any }[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string, init: RequestInit) => {
          requests.push({ url: String(input), init, body: JSON.parse(String(init.body)) });
          return messagesStream({ channelId: 'channel', text: 'Delivered', final: true });
        }),
      );
      const publish = vi.fn();
      const session = await createChatSession({ ...config, model, thinkingLevel }, [], publish);
      try {
        expect(session.model).toMatchObject({ provider: 'anthropic', api: 'anthropic-messages' });
        await session.prompt('Hello', { expandPromptTemplates: false });
        expect((session.messages.at(-1) as AssistantMessage | undefined)?.errorMessage).toBeUndefined();
        expect(publish).toHaveBeenCalledWith('Delivered', expect.any(String), true, undefined, []);
        const [request] = requests;
        expect(request!.url).toBe(`${ANTHROPIC_URL}/v1/messages?beta=true`);
        const headers = new Headers(request!.init.headers);
        expect(headers.get('x-api-key')).toBe(KEY);
        expect(headers.get('authorization')).toBeNull();
        expect(request!.init.redirect).toBe('error');
        expect(JSON.stringify(request)).not.toContain('developer-secret');
        expect(request!.body).toMatchObject({ model, thinking, stream: true });
        if (effort) expect(request!.body.output_config).toEqual({ effort });
        expect(request!.body.tools.map((tool: { name: string }) => tool.name)).toEqual(['send_message', 'help']);
        // Prompt caching: Anthropic's 5-minute cache on the conversation.
        expect(JSON.stringify(request!.body)).toContain('"cache_control":{"type":"ephemeral"}');
        expect(request!.body).not.toHaveProperty('fallbacks');
        // Metered at the model's price (input, output and cache reads).
        const usage = (session.messages.find(message => message.role === 'assistant') as AssistantMessage).usage;
        expect(usage).toMatchObject({ input: 1000, output: 20, cacheRead: 500 });
        expect(usage.cost.total).toBeGreaterThan(0);
      } finally {
        session.dispose();
      }
    },
  );

  it('refuse a missing key or an OAuth token without any request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const base = { ...config, model: 'claude-opus-4-8', thinkingLevel: 'high' as const };
    await expect(createChatSession({ ...base, apiKey: undefined }, [], () => {})).rejects.toThrow('Anthropic API key');
    await expect(createChatSession({ ...base, apiKey: 'sk-ant-oat01-x' }, [], () => {})).rejects.toThrow('OAuth');
    await expect(
      createChatSession({ ...base, model: 'claude-haiku-4-5', thinkingLevel: 'xhigh' }, [], () => {}),
    ).rejects.toThrow('thinking level');
    (await createChatSession({ ...base, thinkingLevel: 'xhigh' }, [], () => {})).dispose();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('Anthropic errors in the fallback chain', () => {
  const failed = (errorMessage: string) =>
    ({ role: 'assistant', stopReason: 'error', errorMessage, content: [], usage: {} }) as unknown as AssistantMessage;

  it.each([
    ['429 {"type":"error","error":{"type":"rate_limit_error","message":"x"}}', 'rate limit, HTTP 429', true],
    ['529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', 'overloaded, HTTP 529', true],
    [
      '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      'authentication, HTTP 401',
      false,
    ],
    ['403 {"type":"error","error":{"type":"permission_error","message":"x"}}', 'access denied, HTTP 403', false],
  ])('%s is %s (retryable: %s)', (message, reason, retryable) => {
    expect(failureReason(message)).toBe(reason);
    expect(isRetryableAssistantError(failed(message))).toBe(retryable);
    expect(isContextOverflow(failed(message), 200_000)).toBe(false);
  });

  it.each([
    '400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 213462 tokens > 200000 maximum"}}',
    '413 {"type":"error","error":{"type":"request_too_large","message":"Request exceeds the maximum size"}}',
  ])('a too-big conversation (%s) is a context overflow, which compacts', message => {
    expect(isContextOverflow(failed(message), 200_000)).toBe(true);
    expect(providerFailure(message).category).toBe('context limit');
  });
});
