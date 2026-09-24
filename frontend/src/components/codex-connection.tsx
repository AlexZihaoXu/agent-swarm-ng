import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';

type Connection = { connected: boolean; models: string[]; login: { state: string; userCode?: string; verificationUri?: string; message?: string } };

export function CodexConnection() {
  const [connection, setConnection] = useState<Connection>();
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const { data, error } = await api.GET('/api/providers/openai-codex', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (controller.signal.aborted) return;
        if (!data || error) throw new Error();
        setConnection(data);
        if (['starting', 'waiting'].includes(data.login.state)) timer = setTimeout(() => void refresh(), 2000);
      } catch { if (!controller.signal.aborted) setError('Could not load the OpenAI connection.'); }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [revision]);

  async function change(action: 'connect' | 'cancel' | 'disconnect') {
    setBusy(true); setError('');
    try {
      const result = action === 'connect'
        ? await api.POST('/api/providers/openai-codex/login', { body: {} })
        : await api.DELETE(action === 'cancel' ? '/api/providers/openai-codex/login' : '/api/providers/openai-codex');
      if (result.error || !result.data) { setError(result.error?.message ?? 'Could not update the connection.'); return; }
      setConnection(result.data);
      setRevision(value => value + 1);
    } catch { setError('Could not reach the backend.'); }
    finally { setBusy(false); }
  }
  const pending = connection && ['starting', 'waiting'].includes(connection.login.state);
  return (
    <section aria-labelledby="codex-title" className="mb-8 rounded-xl border border-border bg-background p-5 sm:p-6">
      <h3 id="codex-title" className="text-sm font-semibold">OpenAI Codex</h3>
      <p className="mt-1 text-xs text-muted-foreground">Use your ChatGPT Plus or Pro subscription. No API key required.</p>
      <p role="status" className="mt-5 text-sm">{!connection ? 'Loading connection…' : connection.connected ? 'Connected to ChatGPT' : pending ? 'Waiting for sign-in…' : 'Not connected'}</p>
      {connection?.login.state === 'waiting' && connection.login.userCode && (
        <div className="mt-4 space-y-3">
          {/* Same labeled-field composition as the endpoint settings (Kibo field-basic-inputs-4). */}
          <label htmlFor="codex-device-code" className="block text-sm font-medium">One-time sign-in code</label>
          <input id="codex-device-code" readOnly value={connection.login.userCode} onFocus={event => event.target.select()} className="h-10 w-full rounded-lg border border-border bg-sidebar px-3 font-mono text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring" />
          <a href="https://auth.openai.com/codex/device" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded text-sm underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0">Open OpenAI sign-in</a>
          <p className="text-xs leading-relaxed text-muted-foreground">Enter this code on OpenAI’s page. If needed, enable device code login in ChatGPT → Settings → Security. This page updates automatically.</p>
        </div>
      )}
      {(error || connection?.login.message) && <p role="alert" className="mt-4 text-sm">{error || connection?.login.message}</p>}
      <div className="mt-5 flex flex-wrap gap-3">
        {connection && <Button size="sm" variant={connection.connected || pending ? 'outline' : 'default'} className="min-h-11 sm:min-h-0" disabled={busy} onClick={() => void change(pending ? 'cancel' : connection.connected ? 'disconnect' : 'connect')}>{busy ? 'Updating…' : pending ? 'Cancel sign-in' : connection.connected ? 'Disconnect' : 'Connect ChatGPT'}</Button>}
        {error && <Button size="sm" variant="outline" className="min-h-11 sm:min-h-0" disabled={busy} onClick={() => { setError(''); setRevision(value => value + 1); }}>Retry</Button>}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Subscription limits apply and are shared by agents using this account. Credentials stay on the backend. API endpoints below use separate billing.</p>
    </section>
  );
}
