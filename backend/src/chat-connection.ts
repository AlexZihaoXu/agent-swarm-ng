import { CODEX_CONNECTION, type CodexProvider } from './codex-provider';
import type { SavedEndpoint } from './endpoint-store';
export class ConnectionError extends Error {
  constructor(
    readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
  }
}
/** An agent's model connection from its organization owner's endpoints and ChatGPT login (users/connections.ts). */
export async function resolveChatConnection(
  endpointId: string,
  endpoints: SavedEndpoint[],
  codex: CodexProvider,
  signal: AbortSignal,
) {
  // Cleared when it moved to another owner (docs/users.md): it waits for a model from its new owner's connections.
  if (!endpointId) throw new ConnectionError(400, 'Choose a model for this agent in its settings.');
  const subscription = endpointId === CODEX_CONNECTION;
  if (subscription && !(await codex.status()).connected)
    throw new ConnectionError(400, 'Reconnect OpenAI Codex in Settings.');
  const endpoint = subscription
    ? { baseUrl: 'https://chatgpt.com/backend-api', apiKey: undefined }
    : endpoints.find(item => item.id === endpointId);
  if (!endpoint) throw new ConnectionError(404, 'The configured endpoint was removed.');
  const subscriptionRuntime = subscription ? await codex.runtime() : undefined;
  const accessKey = subscriptionRuntime
    ? (
        await subscriptionRuntime.getAuth('openai-codex', {
          signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        })
      )?.auth.apiKey
    : endpoint.apiKey;
  if (subscription && !accessKey) throw new ConnectionError(400, 'Reconnect OpenAI Codex in Settings.');
  signal.throwIfAborted();
  return { ...endpoint, subscriptionRuntime, accessKey: accessKey ?? '' };
}
