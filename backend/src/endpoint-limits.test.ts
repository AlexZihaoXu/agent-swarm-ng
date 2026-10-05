import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EndpointStore } from './endpoint-store';
import { detectContextWindow, detectedLimits, RECHECK_MS } from './endpoint-detection';
import { endpointCapabilities, endpointModelLimits, resolveChatModel } from './chat-runtime';
import { buildApp } from './app';

const directories: string[] = [];
const realFetcher = detectedLimits.fetcher;
const realNow = detectedLimits.now;
afterEach(async () => {
  detectedLimits.clear();
  detectedLimits.fetcher = realFetcher;
  detectedLimits.now = realNow;
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
async function storePath() {
  await mkdir('.scratch', { recursive: true });
  const directory = await mkdtemp(join('.scratch', 'endpoint-limits-test-'));
  directories.push(directory);
  return join(directory, 'endpoints.json');
}
const base = { id: 'local', name: 'Local', baseUrl: 'http://127.0.0.1:8000/v1', apiKey: '' };

describe('endpoint model limits are saved with the endpoint', () => {
  it('loads endpoints saved before limits existed, keeps omitted limits and clears them with null', async () => {
    const path = await storePath();
    await writeFile(path, JSON.stringify([{ ...base, ownerId: 'admin' }]));
    const store = new EndpointStore(path);
    expect(await store.read()).toEqual([{ ...base, ownerId: 'admin' }]);
    await store.save({ ...base, contextWindow: 131072, maxOutputTokens: 8192, images: true, reasoning: false });
    expect((await new EndpointStore(path).read())[0]).toMatchObject({
      contextWindow: 131072,
      maxOutputTokens: 8192,
      images: true,
      reasoning: false,
    });
    await store.save({ ...base, name: 'Renamed' });
    expect((await store.read())[0]).toMatchObject({ name: 'Renamed', contextWindow: 131072, images: true });
    await store.save({ ...base, contextWindow: null, images: null });
    const row = (await store.read())[0];
    expect(row).not.toHaveProperty('contextWindow');
    expect(row).not.toHaveProperty('images');
    expect(row).toMatchObject({ maxOutputTokens: 8192, reasoning: false });
  });

  it.each([{ contextWindow: 10 }, { contextWindow: 1.5 }, { maxOutputTokens: '4096' }, { images: 'yes' }])(
    'refuses a damaged saved limit %j rather than using it',
    async limit => {
      const path = await storePath();
      await writeFile(path, JSON.stringify([{ ...base, ...limit }]));
      await expect(new EndpointStore(path).read()).rejects.toThrow('Could not read endpoint preferences.');
    },
  );

  it('validates limits on the save route and returns them (never the key)', async () => {
    const app = await buildApp({ requireLogin: false, endpointStore: new EndpointStore(await storePath()) });
    try {
      const save = (body: Record<string, unknown>) =>
        app.inject({
          method: 'POST',
          url: '/api/model-endpoints',
          payload: { ...base, apiKey: 'test-secret', ...body },
        });
      for (const bad of [
        { contextWindow: 1000 },
        { contextWindow: 10_000_001 },
        { maxOutputTokens: 100 },
        { contextWindow: 4096.5 },
        { images: 'sometimes' },
      ])
        expect((await save(bad)).statusCode).toBe(400);
      const saved = await save({ contextWindow: 262144, maxOutputTokens: 16384, images: true, reasoning: true });
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({
        contextWindow: 262144,
        maxOutputTokens: 16384,
        images: true,
        reasoning: true,
      });
      expect(saved.body).not.toContain('test-secret');
      const listed = await app.inject('/api/model-endpoints');
      expect(listed.json()[0]).toMatchObject({ contextWindow: 262144, reasoning: true, hasApiKey: true });
    } finally {
      await app.close();
    }
  });
});

describe('context size detection from GET /models', () => {
  it.each([
    [{ id: 'm', max_model_len: 131072 }, 131072],
    [{ id: 'm', context_length: 65536 }, 65536],
    [{ id: 'm', context_window: 200000 }, 200000],
    [{ id: 'm', max_context_length: 32768 }, 32768],
    [{ id: 'm', meta: { n_ctx_train: 262144 } }, 262144],
    [{ id: 'm', meta: { n_ctx: 16384, n_ctx_train: 262144 } }, 16384],
    [{ id: 'm', max_model_len: '8192' }, 8192],
    [{ id: 'm', max_model_len: 12 }, undefined],
    [{ id: 'm', context_length: 'lots' }, undefined],
    [{ id: 'm' }, undefined],
  ])('%j → %s', (row, expected) => {
    expect(detectContextWindow(row)).toBe(expected);
  });

  it('returns details for models that report a size and remembers them for that endpoint', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ data: [{ id: 'qwen', max_model_len: 131072 }, { id: 'plain' }] }));
    const store = new EndpointStore(await storePath());
    await store.save(base);
    const app = await buildApp({
      requireLogin: false,
      fetcher: fetcher as unknown as typeof fetch,
      endpointStore: store,
    });
    try {
      const tested = await app.inject({
        method: 'POST',
        url: '/api/model-endpoints/test',
        payload: { baseUrl: `${base.baseUrl}/` },
      });
      expect(tested.json()).toEqual({ models: ['qwen', 'plain'], details: [{ id: 'qwen', contextWindow: 131072 }] });
      expect(detectedLimits.contextWindow(base.baseUrl, 'qwen')).toBe(131072);
      expect(detectedLimits.contextWindow(base.baseUrl, 'plain')).toBeUndefined();
      expect((await app.inject('/api/model-endpoints')).json()[0].detectedContextWindow).toBe(131072);
    } finally {
      await app.close();
    }
  });
});

describe('an endpoint model at run time', () => {
  it('prefers the endpoint setting, then the detected size, then a known model, then 32,768', () => {
    const url = 'http://127.0.0.1:8000/v1';
    expect(endpointModelLimits('local', url)).toEqual({ contextWindow: 32768, maxTokens: 8192, input: ['text'] });
    expect(endpointModelLimits('gpt-4o', url, {}, { contextWindow: 128000, input: ['text', 'image'] })).toEqual({
      contextWindow: 128000,
      maxTokens: 32000,
      input: ['text', 'image'],
    });
    detectedLimits.remember(url, [{ id: 'local', max_model_len: 262144 }]);
    expect(endpointModelLimits('local', url).contextWindow).toBe(262144);
    expect(endpointModelLimits('local', url).maxTokens).toBe(32768);
    expect(endpointModelLimits('local', url, { contextWindow: 8192 })).toMatchObject({
      contextWindow: 8192,
      maxTokens: 4096,
    });
    expect(
      endpointModelLimits(
        'gpt-4o',
        url,
        { maxOutputTokens: 2048, images: false },
        { contextWindow: 128000, input: ['text', 'image'] },
      ),
    ).toEqual({ contextWindow: 128000, maxTokens: 2048, input: ['text'] });
  });

  it('offers thinking levels when the endpoint says its models reason', async () => {
    const baseUrl = 'http://127.0.0.1:8000/v1';
    expect((await endpointCapabilities('local', { baseUrl })).thinkingLevels).toEqual(['off']);
    const reasoning = await endpointCapabilities('local', { baseUrl, reasoning: true });
    expect(reasoning).toMatchObject({ reasoning: true });
    expect(reasoning.thinkingLevels).toEqual(expect.arrayContaining(['off', 'low', 'medium', 'high']));
    expect(await endpointCapabilities('o3', { baseUrl, reasoning: false })).toEqual({
      reasoning: false,
      thinkingLevels: ['off'],
    });
  });

  it('builds the model from the endpoint settings carried in the configuration', async () => {
    detectedLimits.fetcher = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    const config = {
      name: 'Agent',
      model: 'local',
      thinkingLevel: 'high' as const,
      baseUrl: 'http://127.0.0.1:8000/v1',
      channel: { id: 'c', kind: 'platform-chat' as const, agentId: 'a' },
    };
    await expect(resolveChatModel(config)).rejects.toThrow('Unsupported thinking level');
    const { model } = await resolveChatModel({
      ...config,
      limits: { contextWindow: 131072, maxOutputTokens: 16384, images: true, reasoning: true },
    });
    expect(model).toMatchObject({
      contextWindow: 131072,
      maxTokens: 16384,
      input: ['text', 'image'],
      reasoning: true,
      compat: { supportsReasoningEffort: true, maxTokensField: 'max_completion_tokens' },
    });
  });
});

describe('a turn after a restart asks the endpoint itself', () => {
  const config = {
    name: 'Agent',
    model: 'qwen',
    thinkingLevel: 'off' as const,
    baseUrl: 'http://127.0.0.1:8000/v1/',
    apiKey: 'test-secret',
    channel: { id: 'c', kind: 'platform-chat' as const, agentId: 'a' },
  };

  it('reads GET /models once with the key, remembers the size, and skips it when a size is set', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'qwen', max_model_len: 262144 }] }));
    detectedLimits.fetcher = fetcher as unknown as typeof fetch;
    const [first, second] = await Promise.all([resolveChatModel(config), resolveChatModel(config)]);
    expect(first.model.contextWindow).toBe(262144);
    expect(second.model.contextWindow).toBe(262144);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8000/v1/models');
    expect(options).toMatchObject({
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: 'Bearer test-secret' },
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect((await resolveChatModel(config)).model.contextWindow).toBe(262144);
    detectedLimits.clear();
    expect((await resolveChatModel({ ...config, limits: { contextWindow: 65536 } })).model.contextWindow).toBe(65536);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('falls back to 32,768 when the endpoint cannot say, and asks again only after five minutes', async () => {
    let now = 1_000_000;
    detectedLimits.now = () => now;
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('connect ECONNREFUSED'))
      .mockResolvedValueOnce(new Response('nope', { status: 404 }))
      .mockResolvedValue(Response.json({ data: [{ id: 'qwen', context_length: 131072 }] }));
    detectedLimits.fetcher = fetcher as unknown as typeof fetch;
    expect((await resolveChatModel(config)).model.contextWindow).toBe(32768);
    expect((await resolveChatModel(config)).model.contextWindow).toBe(32768);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += RECHECK_MS;
    expect((await resolveChatModel(config)).model.contextWindow).toBe(32768);
    expect(fetcher).toHaveBeenCalledTimes(2);
    now += RECHECK_MS;
    expect((await resolveChatModel(config)).model.contextWindow).toBe(131072);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
