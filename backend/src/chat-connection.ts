import { CODEX_CONNECTION, type CodexProvider } from './codex-provider';
import type { EndpointStore } from './endpoint-store';
export class ConnectionError extends Error {
  constructor(readonly status: 400 | 404, message: string) { super(message); }
}
export async function resolveChatConnection(endpointId: string, store: EndpointStore, codex: CodexProvider, signal: AbortSignal) {
  const subscription = endpointId === CODEX_CONNECTION;
  if (subscription && !(await codex.status()).connected) throw new ConnectionError(400, 'Reconnect OpenAI Codex in Settings.');
  const endpoint = subscription ? { baseUrl: 'https://chatgpt.com/backend-api', apiKey: undefined } : (await store.read()).find(item => item.id === endpointId);
  if (!endpoint) throw new ConnectionError(404, 'The configured endpoint was removed.');
  const subscriptionRuntime = subscription ? await codex.runtime() : undefined;
  const accessKey = subscriptionRuntime ? (await subscriptionRuntime.getAuth('openai-codex', { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) }))?.auth.apiKey : endpoint.apiKey;
  if (subscription && !accessKey) throw new ConnectionError(400, 'Reconnect OpenAI Codex in Settings.');
  signal.throwIfAborted();
  return { ...endpoint, subscriptionRuntime, accessKey: accessKey ?? '' };
}
