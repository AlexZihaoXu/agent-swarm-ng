import { expect, it, vi } from 'vitest';
import { OpenRouterCatalog, isOpenRouter, OPENROUTER_URL } from './openrouter';
const row = {
  id: 'vendor/new-vision',
  name: 'New vision',
  context_length: 131072,
  architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
  supported_parameters: ['tools', 'reasoning'],
  top_provider: { max_completion_tokens: 8192 },
  pricing: { prompt: '0.000002', completion: '0.000008' },
};
it('recognizes only the canonical OpenRouter endpoint, not lookalike destinations', () => {
  expect(isOpenRouter(OPENROUTER_URL + '/')).toBe(true);
  for (const url of [
    'http://openrouter.ai/api/v1',
    'https://openrouter.ai.evil.test/api/v1',
    'https://evil.test/openrouter.ai',
    'https://user@openrouter.ai/api/v1',
    OPENROUTER_URL + '?key=x',
  ])
    expect(isOpenRouter(url)).toBe(false);
});
it('loads bounded public metadata once and preserves newer vision/reasoning capabilities', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [row] }));
  const catalog = new OpenRouterCatalog(fetcher);
  const model = await catalog.model(row.id);
  expect(model).toMatchObject({
    provider: 'openrouter',
    api: 'openai-completions',
    input: ['text', 'image'],
    reasoning: true,
    contextWindow: 131072,
    maxTokens: 4096,
    cost: { input: 2, output: 8 },
  });
  expect(await catalog.model(row.id)).toEqual(model);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe(OPENROUTER_URL + '/models');
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  expect(fetcher.mock.calls[0][1]).not.toHaveProperty('headers.Authorization');
});
it('retains native Pi protocols and thinking maps for known OpenRouter models without inherited auth', async () => {
  const fetcher = vi.fn();
  const catalog = new OpenRouterCatalog(fetcher);
  expect(await catalog.model('anthropic/claude-sonnet-4.6')).toMatchObject({
    api: 'anthropic-messages',
    baseUrl: 'https://openrouter.ai/api',
    provider: 'openrouter',
    reasoning: true,
    input: ['text', 'image'],
  });
  expect(await catalog.model('openai/gpt-5.4')).toMatchObject({
    api: 'openai-completions',
    thinkingLevelMap: { low: 'low' },
  });
  expect(fetcher).not.toHaveBeenCalled();
});
it('does not confuse reasoning visibility with configurable reasoning effort', async () => {
  const catalog = new OpenRouterCatalog();
  catalog.remember([{ ...row, supported_parameters: ['tools', 'include_reasoning'] }]);
  expect((await catalog.model(row.id)).reasoning).toBe(false);
});
it('does not invent capabilities for unknown models on failure or leak provider errors', async () => {
  const catalog = new OpenRouterCatalog(vi.fn().mockResolvedValue(new Response('PRIVATE KEY', { status: 401 })));
  await expect(catalog.model('vendor/unknown')).rejects.toThrow('OpenRouter model metadata unavailable');
});
it('rejects unsupported/non-chat models and invalid metadata, and bounds catalog responses', async () => {
  for (const value of [
    { ...row, supported_parameters: [] },
    { ...row, context_length: -1 },
    { ...row, architecture: { input_modalities: ['image'], output_modalities: ['image'] } },
  ]) {
    const catalog = new OpenRouterCatalog(vi.fn().mockResolvedValue(Response.json({ data: [value] })));
    await expect(catalog.model(row.id)).rejects.toThrow('OpenRouter model metadata unavailable');
  }
  const catalog = new OpenRouterCatalog(vi.fn().mockResolvedValue(new Response('x'.repeat(4 * 1024 * 1024 + 1))));
  await expect(catalog.model(row.id)).rejects.toThrow('OpenRouter model metadata unavailable');
});
