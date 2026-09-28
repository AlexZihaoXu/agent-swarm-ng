import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { Button } from './ui/button';

// Kibo checkbox-standard-8: vertical list with native labels, matching Channels.
export function AgentComputerSettings({ agentId }: { agentId: string }) {
  const [computers, setComputers] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]), [saved, setSaved] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoaded(false); setError(''); setStatus('');
    void (async () => {
      try {
        const [all, assigned] = await Promise.all([
          api.GET('/api/computers', { signal: controller.signal }),
          api.GET('/api/agents/{id}/computers', { params: { path: { id: agentId } }, signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        if (!all.data || !assigned.data) throw new Error('Could not load computer assignments.');
        const ids = assigned.data.computers.map(computer => computer.id);
        setComputers(all.data.computers); setSelected(ids); setSaved(ids); setLoaded(true);
      } catch { if (!controller.signal.aborted) setError('Could not load computer assignments.'); }
    })();
    return () => controller.abort();
  }, [agentId, attempt]);
  const dirty = selected.length !== saved.length || selected.some(id => !saved.includes(id));
  async function save() {
    if (busy || !loaded || !dirty) return;
    setBusy(true); setError(''); setStatus('');
    try {
      const result = await api.PUT('/api/agents/{id}/computers', { params: { path: { id: agentId } }, body: { computerIds: selected } });
      if (!result.data?.saved) throw new Error(result.error?.message ?? 'Could not save computer assignments.');
      setSaved([...selected]); setStatus('Computer assignments saved.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save computer assignments.'); }
    finally { setBusy(false); }
  }
  return <section aria-label="Computers" className="space-y-4">
    <div><h3 className="text-lg font-semibold">Computers</h3><p className="mt-1 text-sm text-muted-foreground">Choose the computers this agent may use for desktop, file, and shell tools. Several agents can be assigned; only one agent holds control at a time.</p></div>
    <div className="space-y-4 rounded-lg border border-border bg-sidebar/30 p-4">
      <p className="text-xs leading-relaxed text-muted-foreground">Assignments save separately from appearance and Channels. Tools require an active claim and use the guest account's permissions, including configured sudo—not platform-host access. Removing access releases control only after active input and commands settle.</p>
      <fieldset disabled={!loaded || busy} className="space-y-3"><legend className="sr-only">Assigned computers</legend>
        {computers.map(computer => <div key={computer.id} className="flex min-h-11 items-center gap-2 sm:min-h-0">
          <input type="checkbox" id={`computer-${agentId}-${computer.id}`} checked={selected.includes(computer.id)} onChange={event => { setSelected(ids => event.target.checked ? [...ids, computer.id] : ids.filter(id => id !== computer.id)); setStatus(''); }} className="size-4 shrink-0 cursor-pointer rounded border-border accent-foreground disabled:cursor-default focus-visible:ring-2 focus-visible:ring-ring" />
          <label htmlFor={`computer-${agentId}-${computer.id}`} className={`min-w-0 flex-1 break-words text-sm ${busy || !loaded ? '' : 'cursor-pointer'}`}>{computer.name}</label>
        </div>)}
      </fieldset>
      {!loaded && !error && <p role="status" className="text-xs text-muted-foreground">Loading computer assignments…</p>}
      {loaded && !computers.length && <p className="text-sm text-muted-foreground">No computers yet. Create one in Computers first.</p>}
      {error && <p role="alert" className="text-sm">{error} {!loaded && <button type="button" onClick={() => setAttempt(value => value + 1)} className="cursor-pointer underline">Retry computer assignments</button>}</p>}
      {status && <p role="status" className="text-xs text-muted-foreground">{status}</p>}
      {dirty && <div className="flex flex-wrap justify-end gap-2 motion-safe:animate-[fade-in_160ms_ease-out]">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setSelected(saved); setError(''); setStatus(''); }}>Discard computer changes</Button>
        <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>{busy ? 'Saving computers…' : 'Save computer assignments'}</Button>
      </div>}
    </div>
  </section>;
}
