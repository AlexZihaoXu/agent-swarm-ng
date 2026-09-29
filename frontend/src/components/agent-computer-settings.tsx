import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import type { RegisterSection } from '@/lib/settings-sections';

// Kibo checkbox-standard-8: vertical list with native labels, matching Channels.
export function AgentComputerSettings({ agentId, register }: { agentId: string; register: RegisterSection }) {
  const [computers, setComputers] = useState<{ id: string; name: string; state: string }[]>([]);
  // One preview timestamp for all cards, refreshed slowly: enough to recognise a desktop at a glance.
  const [frame, setFrame] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setFrame(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);
  const [selected, setSelected] = useState<string[]>([]),
    [saved, setSaved] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoaded(false);
    setError('');
    setStatus('');
    void (async () => {
      try {
        const [all, assigned] = await Promise.all([
          api.GET('/api/computers', { signal: controller.signal }),
          api.GET('/api/agents/{id}/computers', { params: { path: { id: agentId } }, signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        if (!all.data || !assigned.data) throw new Error('Could not load computer assignments.');
        const ids = assigned.data.computers.map(computer => computer.id);
        setComputers(all.data.computers);
        setSelected(ids);
        setSaved(ids);
        setLoaded(true);
      } catch {
        if (!controller.signal.aborted) setError('Could not load computer assignments.');
      }
    })();
    return () => controller.abort();
  }, [agentId, attempt]);
  const dirty = selected.length !== saved.length || selected.some(id => !saved.includes(id));
  async function save() {
    if (busy || !loaded || !dirty) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const result = await api.PUT('/api/agents/{id}/computers', {
        params: { path: { id: agentId } },
        body: { computerIds: selected },
      });
      if (!result.data?.saved) throw new Error(result.error?.message ?? 'Could not save computer assignments.');
      setSaved([...selected]);
      setStatus('Computer assignments saved.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save computer assignments.');
      throw failure;
    } finally {
      setBusy(false);
    }
  }
  const discard = () => {
    setSelected(saved);
    setError('');
    setStatus('');
  };
  const latest = useRef({ save, discard });
  latest.current = { save, discard };
  useEffect(() => {
    register('computers', {
      label: 'Computers',
      dirty,
      save: () => latest.current.save(),
      discard: () => latest.current.discard(),
    });
    return () => register('computers');
  }, [dirty, register]);
  return (
    <section aria-label="Computers" className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Computers</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose the computers this agent may use for desktop, file, and shell tools. Several agents can be assigned;
          only one agent holds control at a time.
        </p>
      </div>
      <div className="space-y-4 rounded-lg border border-border bg-sidebar/30 p-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Changes are saved with the rest of this page. Tools require an active claim and use the guest account's
          permissions, including configured sudo—not platform-host access. Removing access releases control only after
          active input and commands settle.
        </p>
        <fieldset
          disabled={!loaded || busy}
          className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,12rem),1fr))] gap-3"
        >
          <legend className="sr-only">Assigned computers</legend>
          {computers.map(computer => {
            const on = selected.includes(computer.id);
            const running = computer.state === 'running';
            return (
              <label
                key={computer.id}
                className={`group relative block overflow-hidden rounded-lg border bg-background transition-[border-color,box-shadow] duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
                  on
                    ? 'border-foreground/50 shadow-[0_0_0_1px_var(--foreground)]'
                    : 'border-border hover:border-foreground/25'
                } ${busy || !loaded ? 'opacity-60' : 'cursor-pointer'}`}
              >
                <div className="relative aspect-video bg-black">
                  {running ? (
                    <img
                      src={`/api/computers/${encodeURIComponent(computer.id)}/preview?at=${frame}`}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover"
                      onError={event => (event.currentTarget.style.visibility = 'hidden')}
                    />
                  ) : (
                    <span className="flex size-full items-center justify-center text-[11px] text-muted-foreground">
                      Desktop offline
                    </span>
                  )}
                  <span
                    aria-hidden="true"
                    className={`absolute right-2 top-2 flex size-5 items-center justify-center rounded-full border transition-colors ${
                      on
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-white/50 bg-black/40 text-transparent'
                    }`}
                  >
                    <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </div>
                <span className="flex items-center gap-2 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={computer.name}
                    checked={on}
                    onChange={event => {
                      setSelected(ids =>
                        event.target.checked ? [...ids, computer.id] : ids.filter(id => id !== computer.id),
                      );
                      setStatus('');
                    }}
                    className="absolute inset-0 z-10 size-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{computer.name}</span>
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                    <span
                      aria-hidden="true"
                      className={`size-1.5 rounded-full ${running ? 'bg-teal-400' : 'bg-muted-foreground/60'}`}
                    />
                    {running ? 'Running' : 'Stopped'}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
        {!loaded && !error && (
          <p role="status" className="text-xs text-muted-foreground">
            Loading computer assignments…
          </p>
        )}
        {loaded && !computers.length && (
          <p className="text-sm text-muted-foreground">No computers yet. Create one in Computers first.</p>
        )}
        {error && (
          <p role="alert" className="text-sm">
            {error}{' '}
            {!loaded && (
              <button type="button" onClick={() => setAttempt(value => value + 1)} className="cursor-pointer underline">
                Retry computer assignments
              </button>
            )}
          </p>
        )}
        {status && (
          <p role="status" className="text-xs text-muted-foreground">
            {status}
          </p>
        )}
      </div>
    </section>
  );
}
