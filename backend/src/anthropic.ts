import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import {
  createProvider,
  getSupportedThinkingLevels,
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type Model,
  type ModelThinkingLevel,
} from '@earendil-works/pi-ai';
import { getModels } from '@earendil-works/pi-ai/compat';
import * as transport from '@earendil-works/pi-ai/api/anthropic-messages';
import { detectedLimits } from './endpoint-detection';
import type { EndpointLimits } from './endpoint-store';
import { readModelPage } from './model-catalog';
import { publicFetch } from './web-fetch';

/**
 * Anthropic connections (docs/users.md#model-connections): an API key from the Anthropic Console on the Messages API,
 * through Pi's own Anthropic transport. Never a Claude subscription's OAuth token.
 */
export const ANTHROPIC_URL = 'https://api.anthropic.com';
export const ANTHROPIC_VERSION = '2023-06-01';
/** Pi treats a key with this marker as a subscription login (and then speaks as Claude Code): refused here. */
export const isOAuthToken = (key?: string) => Boolean(key && /sk-ant-oat/i.test(key));
export const OAUTH_REFUSED =
  'This looks like a Claude subscription (OAuth) token. Use an API key from the Anthropic Console.';
/** At most this many pages of GET /v1/models (1,000 models each). */
const MAX_PAGES = 5;

export const anthropicHeaders = (apiKey?: string): Record<string, string> => ({
  Accept: 'application/json',
  'anthropic-version': ANTHROPIC_VERSION,
  ...(apiKey ? { 'x-api-key': apiKey } : {}),
});

export class AnthropicListError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/** Every model the key can use: GET {base}/v1/models, following `has_more`/`last_id` up to a bound. */
export async function listAnthropicModels(
  baseUrl: string,
  apiKey: string | undefined,
  fetcher: typeof fetch,
  signal: AbortSignal,
) {
  const rows: Record<string, any>[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${baseUrl}/v1/models`);
    url.searchParams.set('limit', '1000');
    if (after) url.searchParams.set('after_id', after);
    const response = await fetcher(url, {
      method: 'GET',
      redirect: 'error',
      signal,
      headers: anthropicHeaders(apiKey),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AnthropicListError(response.status);
    }
    const payload = await readModelPage(response);
    rows.push(...payload.data);
    const last = payload.last_id;
    if (payload.has_more !== true || typeof last !== 'string' || !last || last.length > 512 || last === after) break;
    after = last;
  }
  return rows;
}

const known = new Map(getModels('anthropic').map(model => [model.id, model]));
/** A model newer than Pi's catalog is described like the newest one of its family that Pi knows. */
const FAMILY_TEMPLATES: Record<string, string> = {
  fable: 'claude-fable-5-1',
  opus: 'claude-opus-5',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5',
};
/** Published prices (USD per million tokens) of current models Pi's catalog does not have yet. */
const PRICES: Record<string, Model<'anthropic-messages'>['cost']> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
};
const FREE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/**
 * A model on an Anthropic connection: Pi's metadata for it (a dated snapshot as its model), else its family's, else
 * safe defaults (200K context, 8,192-token replies, no thinking). The endpoint's context window and reply length, when
 * set, and the size the listing reported come first. Pi's server-side fallback to other models is removed: only the
 * models the owner listed are used (docs/agent-models.md).
 */
export function anthropicModel(id: string, baseUrl: string, limits: EndpointLimits = {}): Model<'anthropic-messages'> {
  const exact = known.get(id) ?? known.get(id.replace(/-\d{8}$/, ''));
  const family = /^claude-(fable|opus|sonnet|haiku)-/.exec(id)?.[1];
  const template = exact ?? (family ? known.get(FAMILY_TEMPLATES[family]!) : undefined);
  const { allowedFallbackModels: _, ...compat } = template?.compat ?? {};
  // A newer adaptive-thinking model may refuse thinking turned off: it is not offered.
  const thinkingLevelMap =
    !exact && compat.forceAdaptiveThinking ? { ...template?.thinkingLevelMap, off: null } : template?.thinkingLevelMap;
  return {
    id,
    name: exact?.name ?? id,
    api: 'anthropic-messages',
    provider: 'anthropic',
    baseUrl,
    reasoning: template?.reasoning ?? false,
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    input: ['text', 'image'],
    contextWindow:
      limits.contextWindow ?? detectedLimits.contextWindow(baseUrl, id) ?? template?.contextWindow ?? 200_000,
    maxTokens: limits.maxOutputTokens ?? template?.maxTokens ?? 8192,
    cost: PRICES[id] ?? template?.cost ?? FREE,
    compat,
  };
}

export function anthropicCapabilities(id: string, baseUrl: string) {
  const model = anthropicModel(id, baseUrl);
  const levels = model.reasoning ? getSupportedThinkingLevels(model) : (['off'] as const);
  return { thinkingLevels: [...levels], reasoning: model.reasoning };
}

/**
 * The runtime of one Anthropic model: Pi's Anthropic Messages transport with the connection's key passed on each call
 * (never Pi's environment or key-command configuration), only to {base}/v1/messages, through the address-pinned fetch
 * for a user's connection. Prompt caching uses Anthropic's default 5-minute cache.
 */
export async function anthropicRuntime(config: {
  model: string;
  thinkingLevel: ModelThinkingLevel;
  baseUrl: string;
  apiKey?: string;
  limits?: EndpointLimits;
  publicOnly?: boolean;
}) {
  const apiKey = config.apiKey?.trim();
  if (!apiKey) throw new Error('Add an Anthropic API key in Settings.');
  if (isOAuthToken(apiKey)) throw new Error(OAUTH_REFUSED);
  const base = new URL(config.baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
    throw new Error('Invalid endpoint');
  const baseUrl = base.toString().replace(/\/+$/, '');
  const model = anthropicModel(config.model, baseUrl, config.limits);
  const levels = model.reasoning ? getSupportedThinkingLevels(model) : ['off'];
  if (!levels.includes(config.thinkingLevel)) throw new Error('Unsupported thinking level');
  const send = config.publicOnly ? publicFetch : fetch;
  const destination = `${baseUrl}/v1/messages`;
  const guardedFetch: typeof fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url !== destination && url !== `${destination}?beta=true`)
        throw new Error('Unexpected inference destination');
      const headers = new Headers(init?.headers);
      headers.delete('Authorization');
      headers.set('x-api-key', apiKey);
      return send(input, { ...init, headers, redirect: 'error' });
    },
    { preconnect: fetch.preconnect },
  );
  const options = { fetch: guardedFetch, apiKey, cacheRetention: 'short' as const, maxRetries: 0 };
  const provider = createProvider({
    id: model.provider,
    models: [model],
    auth: { apiKey: { name: 'Anthropic API key', resolve: async () => ({ auth: { apiKey } }) } },
    api: {
      stream: (m, context, streamOptions) =>
        transport.stream(m as Model<'anthropic-messages'>, context, { ...streamOptions, ...options }),
      streamSimple: (m, context, streamOptions) =>
        transport.streamSimple(m as Model<'anthropic-messages'>, context, { ...streamOptions, ...options }),
    },
  });
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(provider);
  return { model, modelRuntime };
}
