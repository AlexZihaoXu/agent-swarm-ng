import { useEffect, useId, useRef, useState } from 'react';
import { CodexConnection } from '@/components/codex-connection';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { randomUuid } from '@/lib/random-uuid';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { endpointPath, type DashboardRoute } from '@/lib/dashboard-location';

type TestResult =
  | { state: 'idle' | 'testing' | 'saved' }
  | { state: 'success'; models: string[] }
  | { state: 'error'; message: string };

const inputClass =
  'h-11 w-full rounded-lg border border-border bg-sidebar px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 sm:h-10';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1';

type Endpoint = { id: string; name: string; baseUrl: string; hasApiKey: boolean; saved: boolean };

function EndpointCard({
  endpoint,
  onSaved,
  onRemove,
}: {
  endpoint: Endpoint;
  onSaved: (value: Endpoint) => void;
  onRemove: () => Promise<void>;
}) {
  const id = useId();
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [name, setName] = useState(endpoint.name);
  const [baseUrl, setBaseUrl] = useState(endpoint.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [keyChanged, setKeyChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<TestResult>({ state: 'idle' });
  const request = useRef<AbortController | null>(null);
  const testing = result.state === 'testing';
  const openrouter = baseUrl.trim().replace(/\/+$/, '') === OPENROUTER_URL;

  useEffect(() => () => request.current?.abort(), []);

  async function testConnection() {
    if (testing || !baseUrl.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    setResult({ state: 'testing' });
    try {
      const { data, error } = await api.POST('/api/model-endpoints/test', {
        body: {
          baseUrl: baseUrl.trim(),
          ...(keyChanged || !endpoint.saved ? { apiKey: apiKey.trim() } : { endpointId: endpoint.id }),
        },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
      });
      if (controller.signal.aborted) return;
      if (error || !data) setResult({ state: 'error', message: error?.message ?? 'The connection test failed.' });
      else setResult({ state: 'success', models: data.models });
    } catch {
      if (!controller.signal.aborted)
        setResult({
          state: 'error',
          message: 'Could not complete the request. Check the backend connection and try again.',
        });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  async function saveEndpoint() {
    setSaving(true);
    try {
      const { data, error } = await api.POST('/api/model-endpoints', {
        body: {
          id: endpoint.id,
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          ...(keyChanged || !endpoint.saved ? { apiKey: apiKey.trim() } : {}),
        },
      });
      if (error || !data) {
        setResult({ state: 'error', message: error?.message ?? 'Could not save endpoint.' });
        return;
      }
      onSaved({ ...data, saved: true });
      setBaseUrl(data.baseUrl);
      setApiKey('');
      setKeyChanged(false);
      setResult({ state: 'saved' });
    } catch {
      setResult({ state: 'error', message: 'Could not save endpoint. Check the backend connection.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-xl border border-border bg-background p-5 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="truncate text-sm font-semibold">
            {name.trim() || 'New endpoint'}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {openrouter ? 'OpenRouter · API credits' : 'OpenAI-compatible API'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (endpoint.saved) setConfirmingRemoval(true);
            else void onRemove();
          }}
          aria-label="Remove endpoint"
          className="flex size-11 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:size-auto sm:p-2"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            className="size-4"
          >
            <path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <ConfirmDialog
        open={confirmingRemoval}
        onOpenChange={setConfirmingRemoval}
        title="Remove endpoint"
        confirmLabel="Remove endpoint"
        busyLabel="Removing…"
        onConfirm={onRemove}
        description={
          <>
            Removes <strong className="text-foreground">{endpoint.name.trim() || 'this endpoint'}</strong> and its saved
            API key from this backend. Agents that use it must be moved to another endpoint or deleted first; you will
            be told if any still do.
          </>
        }
      />
      {/* Labeled field-group composition: Kibo field/basic-inputs/field-basic-inputs-4. */}
      <form
        onSubmit={event => {
          event.preventDefault();
          void testConnection();
        }}
      >
        <fieldset disabled={testing || saving} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor={`${id}-name`} className="block text-sm font-medium">
              Name
            </label>
            <input
              id={`${id}-name`}
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="e.g. Local server"
              autoComplete="off"
              className={inputClass}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor={`${id}-url`} className="block text-sm font-medium">
              Base URL
            </label>
            <input
              id={`${id}-url`}
              type="url"
              required
              value={baseUrl}
              onChange={event => {
                setBaseUrl(event.target.value);
                setResult({ state: 'idle' });
              }}
              placeholder="https://api.openai.com/v1"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={`${id}-url-help`}
              className={inputClass}
            />
            <p id={`${id}-url-help`} className="text-xs leading-relaxed text-muted-foreground">
              Include the API prefix, such as /v1. Local URLs are resolved from the backend.
            </p>
          </div>
          <div className="space-y-2">
            <label htmlFor={`${id}-key`} className="block text-sm font-medium">
              API key
            </label>
            <input
              id={`${id}-key`}
              type="password"
              value={apiKey}
              onChange={event => {
                setApiKey(event.target.value);
                setKeyChanged(true);
                setResult({ state: 'idle' });
              }}
              placeholder={
                endpoint.hasApiKey && !keyChanged
                  ? 'Saved key — enter to replace'
                  : openrouter
                    ? 'OpenRouter API key'
                    : 'Optional for local servers'
              }
              autoComplete="new-password"
              spellCheck={false}
              className={inputClass}
            />
          </div>
          {openrouter && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              An OpenRouter API key is required for inference, billed by OpenRouter. Lists tool-capable text/vision
              models; reasoning support depends on the model.
            </p>
          )}
          {endpoint.hasApiKey && !keyChanged && (
            <button
              type="button"
              className="min-h-11 rounded text-xs text-muted-foreground underline underline-offset-4 sm:min-h-0"
              onClick={() => {
                setKeyChanged(true);
                setApiKey('');
                setResult({ state: 'idle' });
              }}
            >
              Clear saved key
            </button>
          )}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button
              type="button"
              size="sm"
              className="min-h-11 sm:min-h-0"
              disabled={testing || saving || !name.trim() || !baseUrl.trim()}
              onClick={() => void saveEndpoint()}
            >
              {saving ? 'Saving…' : 'Save endpoint'}
            </Button>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="min-h-11 sm:min-h-0"
              disabled={testing || !baseUrl.trim()}
            >
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
            <span className="text-xs text-muted-foreground">Lists models only. No inference request.</span>
          </div>
        </fieldset>
      </form>
      {result.state === 'saved' && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          Saved locally.
        </p>
      )}
      {result.state === 'testing' && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          Requesting model list…
        </p>
      )}
      {result.state === 'error' && (
        <p role="alert" className="mt-4 text-sm leading-relaxed">
          <span className="font-medium">Connection failed. </span>
          {result.message}
        </p>
      )}
      {result.state === 'success' && (
        <div className="mt-4 rounded-lg bg-muted/50 p-3">
          <p role="status" className="text-sm">
            Connected · {result.models.length} {result.models.length === 1 ? 'model' : 'models'} available
          </p>
          {result.models.length > 0 && (
            <details className="mt-2">
              <summary className="flex min-h-11 items-center rounded text-xs text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring sm:min-h-0">
                View models
              </summary>
              <ScrollArea
                label="Available models"
                className="mt-3"
                style={{ height: Math.min(result.models.length * 28, 144) }}
              >
                <ul className="space-y-1 pr-4 font-mono text-xs text-muted-foreground">
                  {result.models.map(model => (
                    <li key={model} className="break-all py-1">
                      {model}
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

export function Settings({ route, onNavigate }: { route: DashboardRoute; onNavigate: (path: string) => void }) {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const newEndpointId = useRef(randomUuid());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void api
      .GET('/api/model-endpoints', { signal: controller.signal })
      .then(({ data, error: failure }) => {
        if (controller.signal.aborted) return;
        if (failure || !data) setError('Could not load saved endpoints.');
        else setEndpoints(data.map(endpoint => ({ ...endpoint, saved: true })));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Could not load saved endpoints.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (loading || route.kind !== 'endpoint-new') return;
    setEndpoints(current =>
      current.some(item => item.id === newEndpointId.current)
        ? current
        : [...current, { id: newEndpointId.current, name: '', baseUrl: '', hasApiKey: false, saved: false }],
    );
  }, [loading, route.kind]);
  useEffect(() => {
    if (loading || route.kind !== 'endpoint') return;
    document.getElementById(`endpoint-${route.endpointId}`)?.scrollIntoView({ block: 'nearest' });
  }, [loading, route.kind, route.endpointId, endpoints.length]);

  function addEndpoint(name = '', baseUrl = '') {
    newEndpointId.current = randomUuid();
    setEndpoints(current => [...current, { id: newEndpointId.current, name, baseUrl, hasApiKey: false, saved: false }]);
    onNavigate('/settings/endpoints/new');
  }

  async function removeEndpoint(endpoint: Endpoint) {
    if (endpoint.saved) {
      const { response, error: failure } = await api
        .DELETE('/api/model-endpoints/{id}', { params: { path: { id: endpoint.id } } })
        .catch(() => ({ response: undefined, error: undefined }));
      if (!response?.ok) throw new Error(failure?.message ?? 'Could not remove the saved endpoint.');
    }
    setEndpoints(current => current.filter(item => item.id !== endpoint.id));
    if (route.endpointId === endpoint.id || (route.kind === 'endpoint-new' && !endpoint.saved)) onNavigate('/settings');
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-5 pb-8 pt-[calc(2rem+env(safe-area-inset-top))] sm:px-8 md:py-10">
      <header className="mb-8">
        <h2 className="text-xl font-semibold">Settings</h2>
        <p className="mt-2 text-sm text-muted-foreground">Manage your model connections.</p>
      </header>
      <CodexConnection />
      <section
        aria-labelledby="knowledge-title"
        className="mb-8 rounded-xl border border-border bg-background p-5 sm:p-6"
      >
        <h3 id="knowledge-title" className="text-sm font-semibold">
          Swarm Knowledge
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Review the operator-curated, read-only topic hierarchy. Anyone with dashboard access can read these entries.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4 min-h-11 sm:min-h-0"
          onClick={() => onNavigate('/settings/knowledge')}
        >
          Browse Swarm Knowledge
        </Button>
      </section>
      <section aria-labelledby="endpoints-title">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 id="endpoints-title" className="text-sm font-semibold">
              API endpoints
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Connect OpenRouter, another OpenAI-compatible provider, or a local server.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 sm:min-h-0"
              disabled={loading}
              onClick={() => addEndpoint('OpenRouter', OPENROUTER_URL)}
            >
              Add OpenRouter
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 sm:min-h-0"
              disabled={loading}
              onClick={() => addEndpoint()}
            >
              <span aria-hidden="true" className="mr-2 text-lg leading-none">
                +
              </span>
              Add endpoint
            </Button>
          </div>
        </div>
        <div className="space-y-4">
          {error && (
            <p role="alert" className="text-sm">
              {error}
            </p>
          )}
          {loading && (
            <p role="status" className="text-sm text-muted-foreground">
              Loading endpoints…
            </p>
          )}
          {!loading && endpoints.length === 0 && (
            <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
              <p className="text-sm font-medium">No endpoints yet</p>
              <p className="mt-2 text-xs text-muted-foreground">Add a connection to check its available models.</p>
            </div>
          )}
          {route.kind === 'endpoint' && !loading && !error && !endpoints.some(item => item.id === route.endpointId) && (
            <p role="alert" className="text-sm">
              Endpoint not found.{' '}
              <button type="button" className="cursor-pointer underline" onClick={() => onNavigate('/settings')}>
                Return to settings
              </button>
            </p>
          )}
          {endpoints.map(endpoint => (
            <div key={endpoint.id} id={`endpoint-${endpoint.id}`}>
              <EndpointCard
                endpoint={endpoint}
                onSaved={saved => {
                  setEndpoints(current => current.map(item => (item.id === endpoint.id ? saved : item)));
                  onNavigate(endpointPath(saved.id));
                }}
                onRemove={() => removeEndpoint(endpoint)}
              />
            </div>
          ))}
        </div>
        <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
          Save endpoints to keep them after restart. Keys are stored on the backend, never in browser storage. Changing
          a saved URL clears its key unless you enter a replacement. Use HTTPS for remote providers.
        </p>
      </section>
    </div>
  );
}
