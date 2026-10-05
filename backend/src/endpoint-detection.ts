import { LIMIT_RANGES } from './endpoint-store';
import { readModelCatalog } from './model-catalog';

/**
 * Context sizes that OpenAI-compatible servers report in GET /models (docs/development.md#model-limits): vLLM's
 * max_model_len, OpenRouter-style context_length, context_window, LM Studio's max_context_length, llama.cpp's
 * meta.n_ctx (the size it runs with) or meta.n_ctx_train. Provider metadata is untrusted: only an integer in the
 * allowed range counts.
 */
export function detectContextWindow(row: Record<string, unknown>): number | undefined {
  const meta = row.meta && typeof row.meta === 'object' ? (row.meta as Record<string, unknown>) : {};
  const { minimum, maximum } = LIMIT_RANGES.contextWindow;
  for (const value of [
    row.max_model_len,
    row.context_length,
    row.context_window,
    row.max_context_length,
    meta.n_ctx,
    meta.n_ctx_train,
  ]) {
    const size = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    if (typeof size === 'number' && Number.isInteger(size) && size >= minimum && size <= maximum) return size;
  }
  return undefined;
}

export type DetectedModel = { id: string; contextWindow: number };

/** The same server however its URL was typed (a trailing slash, letter case of the host). */
function normalized(baseUrl: string) {
  try {
    return new URL(baseUrl.trim()).toString().replace(/\/+$/, '');
  } catch {
    return baseUrl.trim();
  }
}
const key = (baseUrl: string, model: string) => `${normalized(baseUrl)}\n${model}`;
const MAX_REMEMBERED = 5000;
/** A turn asks an endpoint at most this often (a failure or a model that reports nothing falls back meanwhile). */
export const RECHECK_MS = 5 * 60_000;
const LOOKUP_TIMEOUT_MS = 3000;

/** What each endpoint reported when its models were last listed: kept in memory (it is re-read on every listing). */
class DetectedLimits {
  private readonly sizes = new Map<string, number>();
  /** When each endpoint (normalized base URL) was last asked by a turn, and the lookup in flight. */
  private readonly asked = new Map<string, { at: number; pending?: Promise<void> }>();
  /** Tests replace the network and the clock. */
  fetcher: typeof fetch = fetch;
  now = () => Date.now();

  remember(baseUrl: string, rows: Record<string, unknown>[]): DetectedModel[] {
    const details: DetectedModel[] = [];
    for (const row of rows) {
      const id = row.id as string;
      const contextWindow = detectContextWindow(row);
      this.sizes.delete(key(baseUrl, id));
      if (contextWindow === undefined) continue;
      this.sizes.set(key(baseUrl, id), contextWindow);
      details.push({ id, contextWindow });
    }
    // Oldest first: a bounded memory however many endpoints are listed.
    for (const old of this.sizes.keys()) {
      if (this.sizes.size <= MAX_REMEMBERED) break;
      this.sizes.delete(old);
    }
    return details;
  }

  contextWindow(baseUrl: string, model: string) {
    return this.sizes.get(key(baseUrl, model));
  }

  /** One size for the whole endpoint when every remembered model agrees (what the settings form shows). */
  endpointContextWindow(baseUrl: string) {
    const prefix = key(baseUrl, '');
    const sizes = new Set([...this.sizes].filter(([name]) => name.startsWith(prefix)).map(([, size]) => size));
    return sizes.size === 1 ? [...sizes][0] : undefined;
  }

  /**
   * The size a model reports, asking its server once when nothing is remembered (after a restart nobody has listed
   * the models yet): a server-side GET {base}/models like the Settings listing (no redirects, bounded, 3 s), with the
   * endpoint's key as a bearer token. Any failure leaves it unknown; the endpoint is not asked again for 5 minutes.
   */
  async lookup(baseUrl: string, model: string, apiKey?: string) {
    const known = this.contextWindow(baseUrl, model);
    if (known !== undefined) return known;
    const endpoint = normalized(baseUrl);
    const previous = this.asked.get(endpoint);
    if (previous?.pending) await previous.pending;
    else if (!previous || this.now() - previous.at >= RECHECK_MS) {
      const pending = this.fetchSizes(endpoint, apiKey).finally(() => {
        this.asked.set(endpoint, { at: this.now() });
      });
      this.asked.set(endpoint, { at: this.now(), pending });
      if (this.asked.size > MAX_REMEMBERED) this.asked.delete(this.asked.keys().next().value!);
      await pending;
    }
    return this.contextWindow(baseUrl, model);
  }

  private async fetchSizes(endpoint: string, apiKey?: string) {
    try {
      const response = await this.fetcher(`${endpoint}/models`, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
        headers: { Accept: 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      });
      if (!response.ok) {
        await response.body?.cancel();
        return;
      }
      this.remember(endpoint, await readModelCatalog(response));
    } catch {
      // Unknown: the turn uses the default. Errors are not logged (they could echo the request).
    }
  }

  clear() {
    this.sizes.clear();
    this.asked.clear();
  }
}

export const detectedLimits = new DetectedLimits();
