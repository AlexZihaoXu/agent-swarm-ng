import type { Api, Model } from '@earendil-works/pi-ai';
import { getModels } from '@earendil-works/pi-ai/compat';
import { readModelCatalog } from './model-catalog';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
export function isOpenRouter(value: string) {
  try { const url = new URL(value); return !url.username && !url.password && !url.search && !url.hash && url.origin === 'https://openrouter.ai' && url.pathname.replace(/\/+$/, '') === '/api/v1'; }
  catch { return false; }
}
const known = new Map(getModels('openrouter').map(model => [model.id, model]));
function nativeModel(model: Model<Api>): Model<Api> {
  return { ...model, baseUrl: model.api === 'anthropic-messages' ? 'https://openrouter.ai/api' : OPENROUTER_URL, maxTokens: Math.min(model.maxTokens, 4096) };
}
function fromMetadata(row: Record<string, any>): Model<Api> | undefined {
  if (!Array.isArray(row.supported_parameters) || !row.supported_parameters.includes('tools') || !Array.isArray(row.architecture?.input_modalities) || !row.architecture.input_modalities.includes('text') || !Array.isArray(row.architecture?.output_modalities) || !row.architecture.output_modalities.includes('text') || !Number.isSafeInteger(row.context_length) || row.context_length < 1024 || row.context_length > 10_000_000) return;
  const base = known.get(row.id);
  const price = (key: string) => { const n = Number(row.pricing?.[key]); return Number.isFinite(n) && n >= 0 ? n * 1_000_000 : 0; };
  const max = row.top_provider?.max_completion_tokens;
  const reasoning = row.supported_parameters.includes('reasoning');
  return nativeModel({
    id: row.id, name: typeof row.name === 'string' ? row.name.slice(0, 200) : row.id,
    provider: 'openrouter', api: base?.api ?? 'openai-completions', baseUrl: OPENROUTER_URL,
    reasoning, ...(reasoning && base?.thinkingLevelMap ? { thinkingLevelMap: base.thinkingLevelMap } : {}),
    input: row.architecture.input_modalities.includes('image') ? ['text','image'] : ['text'],
    contextWindow: row.context_length, maxTokens: Number.isSafeInteger(max) && max > 0 ? max : base?.maxTokens ?? 4096,
    cost: { input: price('prompt'), output: price('completion'), cacheRead: price('input_cache_read'), cacheWrite: price('input_cache_write') },
    compat: base?.compat,
  });
}

/** Public catalog only; credentials belong to the endpoint runtime, never this shared metadata cache. */
export class OpenRouterCatalog {
  private models = new Map<string, Model<Api>>();
  private expires = 0;
  private loading?: Promise<void>;
  constructor(private fetcher?: (url: string, init: RequestInit) => Promise<Response>) {}
  remember(rows: Record<string, any>[]) {
    this.models = new Map(rows.flatMap(row => { const model = fromMetadata(row); return model ? [[model.id, model] as const] : []; }));
    this.expires = Date.now() + 300_000;
    return [...this.models.keys()];
  }
  async model(id: string): Promise<Model<Api>> {
    if (Date.now() < this.expires) {
      const cached = this.models.get(id); if (cached) return cached;
    }
    const registered = known.get(id);
    if (registered) return nativeModel(registered);
    try {
      if (Date.now() >= this.expires) {
        this.loading ??= (async () => {
          const response = await (this.fetcher ?? fetch)(`${OPENROUTER_URL}/models`, { redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json' } });
          if (!response.ok) { await response.body?.cancel(); throw new Error(); }
          this.remember(await readModelCatalog(response, 4 * 1024 * 1024));
        })().finally(() => { this.loading = undefined; });
        await this.loading;
      }
      const model = this.models.get(id); if (model) return model;
    } catch { /* Safe error below; never include a provider body or network exception. */ }
    throw new Error('OpenRouter model metadata unavailable. Select a tool-capable text model and check the connection.');
  }
}
export const openRouterCatalog = new OpenRouterCatalog();
