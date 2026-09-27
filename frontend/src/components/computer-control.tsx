import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { Button } from './ui/button';

export function ComputerControl({ computerId }: { computerId: string }) {
  const [holder, setHolder] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const result = await api.GET('/api/computers/control', { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!result.data) throw new Error('Control status unavailable.');
        setHolder(result.data.holders.find(item => item.computerId === computerId)?.agent ?? null); setError('');
      } catch { if (!controller.signal.aborted) setError('Control status unavailable.'); }
    };
    void load(); const interval = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 3000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [computerId, attempt]);
  async function release() {
    if (busy || !holder) return; setBusy(true); setError('');
    try {
      const result = await api.POST('/api/computers/{id}/release', { params: { path: { id: computerId } }, body: {} });
      if (!result.data?.released) throw new Error(result.error?.message ?? 'Could not release control.');
      setHolder(null); setAttempt(value => value + 1);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not release control.'); }
    finally { setBusy(false); }
  }
  return <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
    <span role="status" className="max-w-48 truncate text-muted-foreground" title={holder?.name}>{holder ? `Agent control: ${holder.name}` : 'No agent holds control'}</span>
    {holder && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void release()} title="Stop this agent's active combo and release control; assignments are unchanged.">{busy ? 'Releasing…' : 'Force release'}</Button>}
    {error && <span role="alert">{error} <button type="button" className="cursor-pointer underline" onClick={() => setAttempt(value => value + 1)}>Retry control status</button></span>}
  </div>;
}
