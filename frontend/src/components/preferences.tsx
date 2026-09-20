import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

type TestResult =
  | { state: 'idle' | 'testing' }
  | { state: 'success'; models: string[] }
  | { state: 'error'; message: string };

const inputClass = 'h-10 w-full rounded-lg border border-border bg-sidebar px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50';

function EndpointCard({ onRemove }: { onRemove: () => void }) {
  const id = useId();
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [result, setResult] = useState<TestResult>({ state: 'idle' });
  const request = useRef<AbortController | null>(null);
  const testing = result.state === 'testing';

  useEffect(() => () => request.current?.abort(), []);

  async function testConnection() {
    if (testing || !baseUrl.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    setResult({ state: 'testing' });
    try {
      const { data, error } = await api.POST('/api/model-endpoints/test', {
        body: { baseUrl: baseUrl.trim(), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
      });
      if (controller.signal.aborted) return;
      if (error || !data) setResult({ state: 'error', message: error?.message ?? 'The connection test failed.' });
      else setResult({ state: 'success', models: data.models });
    } catch {
      if (!controller.signal.aborted) setResult({ state: 'error', message: 'Could not complete the request. Check the backend connection and try again.' });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-xl border border-border bg-background p-5 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="truncate text-sm font-semibold">{name.trim() || 'New endpoint'}</h3>
          <p className="mt-1 text-xs text-muted-foreground">OpenAI-compatible API</p>
        </div>
        <button type="button" onClick={onRemove} aria-label="Remove endpoint" className="rounded-lg p-2 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-4"><path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" /></svg>
        </button>
      </div>
      {/* Labeled field-group composition: Kibo field/basic-inputs/field-basic-inputs-4. */}
      <form onSubmit={event => { event.preventDefault(); void testConnection(); }}>
        <fieldset disabled={testing} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor={`${id}-name`} className="block text-sm font-medium">Name</label>
            <input id={`${id}-name`} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Local server" autoComplete="off" className={inputClass} />
          </div>
          <div className="space-y-2">
            <label htmlFor={`${id}-url`} className="block text-sm font-medium">Base URL</label>
            <input id={`${id}-url`} type="url" required value={baseUrl} onChange={event => { setBaseUrl(event.target.value); setResult({ state: 'idle' }); }} placeholder="https://api.openai.com/v1" autoComplete="off" spellCheck={false} aria-describedby={`${id}-url-help`} className={inputClass} />
            <p id={`${id}-url-help`} className="text-xs leading-relaxed text-muted-foreground">Include the API prefix, such as /v1. Local URLs are resolved from the backend.</p>
          </div>
          <div className="space-y-2">
            <label htmlFor={`${id}-key`} className="block text-sm font-medium">API key</label>
            <input id={`${id}-key`} type="password" value={apiKey} onChange={event => { setApiKey(event.target.value); setResult({ state: 'idle' }); }} placeholder="Optional for local servers" autoComplete="new-password" spellCheck={false} className={inputClass} />
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button type="submit" variant="outline" size="sm" disabled={testing || !baseUrl.trim()}>{testing ? 'Testing…' : 'Test connection'}</Button>
            <span className="text-xs text-muted-foreground">Lists models only. No inference request.</span>
          </div>
        </fieldset>
      </form>
      {result.state === 'testing' && <p role="status" className="mt-4 text-sm text-muted-foreground">Requesting model list…</p>}
      {result.state === 'error' && <p role="alert" className="mt-4 text-sm leading-relaxed"><span className="font-medium">Connection failed. </span>{result.message}</p>}
      {result.state === 'success' && (
        <div className="mt-4 rounded-lg bg-muted/50 p-3">
          <p role="status" className="text-sm">Connected · {result.models.length} {result.models.length === 1 ? 'model' : 'models'} available</p>
          {result.models.length > 0 && (
            <details className="mt-2">
              <summary className="rounded text-xs text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring">View models</summary>
              <ScrollArea label="Available models" className="mt-3" style={{ height: Math.min(result.models.length * 28, 144) }}>
                <ul className="space-y-1 pr-4 font-mono text-xs text-muted-foreground">
                  {result.models.map(model => <li key={model} className="break-all py-1">{model}</li>)}
                </ul>
              </ScrollArea>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

export function Preferences() {
  const [endpoints, setEndpoints] = useState<string[]>([]);

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="mb-8">
        <h2 className="text-xl font-semibold">Preferences</h2>
        <p className="mt-2 text-sm text-muted-foreground">Manage your model connections.</p>
      </header>
      <section aria-labelledby="endpoints-title">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 id="endpoints-title" className="text-sm font-semibold">API endpoints</h3>
            <p className="mt-1 text-xs text-muted-foreground">Connect an OpenAI-compatible provider or local server.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setEndpoints(current => [...current, crypto.randomUUID()])}>
            <span aria-hidden="true" className="mr-2 text-lg leading-none">+</span>Add endpoint
          </Button>
        </div>
        <div className="space-y-4">
          {endpoints.length === 0 && (
            <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
              <p className="text-sm font-medium">No endpoints yet</p>
              <p className="mt-2 text-xs text-muted-foreground">Add a connection to check its available models.</p>
            </div>
          )}
          {endpoints.map(id => <EndpointCard key={id} onRemove={() => setEndpoints(current => current.filter(item => item !== id))} />)}
        </div>
        <p className="mt-5 text-xs leading-relaxed text-muted-foreground">Endpoint details and keys stay in memory until refresh. Keys are sent only to the backend and the endpoint you test. Use HTTPS for remote providers.</p>
      </section>
    </div>
  );
}
