import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { BorderedBreadcrumb } from '@/components/ui/bordered-breadcrumb';
import { Button } from '@/components/ui/button';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { ConfirmDialog } from '@/components/confirm-dialog';
import type { RegisterSection } from '@/lib/settings-sections';

type Overview = { memories: Memory[]; forgotten: Memory[] } & Record<string, unknown>;
type Memory = {
  name: string;
  type: string;
  title: string;
  text: string;
  by: string;
  trust: string;
  channelId: string | null;
  recalls: number;
  faded: boolean;
  conflict: boolean;
  forgottenAt: string | null;
  updatedAt: string;
  createdAt: string;
};
type Filter = 'all' | 'person' | 'preference' | 'project' | 'skill' | 'reference' | 'forgotten';
const TYPES = ['person', 'preference', 'project', 'skill', 'reference'] as const;
const TRUST: Record<string, string> = {
  owner: 'you',
  self: 'itself',
  agent: 'another agent',
  other: 'untrusted',
};
const fieldClass =
  'w-full rounded-lg border border-border bg-sidebar px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring';
const fail = (error: unknown, fallback: string) => {
  throw new Error((error as { message?: string } | undefined)?.message ?? fallback);
};
const when = (iso: string) => new Date(iso).toLocaleString();

/**
 * Agents → agent → Memory: what the agent remembers long term (docs/agent-memory.md), laid out like the Scratchpad
 * (breadcrumbs, a list, a detail view). Type chips with counts adapt Kibo tabs-advanced-1 (Tabs with Badge Counts) to
 * the app's ChoiceChips. The owner edits, forgets, restores or erases memories, and sets when it sleeps.
 */
export function AgentMemory({
  agentId,
  agentName,
  register,
}: {
  agentId: string;
  agentName: string;
  register: RegisterSection;
}) {
  const id = useId();
  const client = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [erasing, setErasing] = useState(false);
  const [status, setStatus] = useState('');
  const key = ['memory', agentId];
  const overview = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET('/api/agents/{id}/memory', { params: { path: { id: agentId } }, signal });
      if (!data) fail(error, 'Could not load memory.');
      return data!;
    },
    // While it sleeps, look again now and then so its changes appear.
    refetchInterval: query => (query.state.data?.sleep.sleeping ? 5000 : false),
  });
  useEffect(() => {
    setOpen(null);
    setFilter('all');
  }, [agentId]);
  const data = overview.data;
  const refresh = (next?: Overview) =>
    next ? client.setQueryData(key, next) : client.invalidateQueries({ queryKey: key });

  // The sleep window is a setting, saved with Save changes like the Heartbeat's hours.
  const savedWindow = { from: data?.sleep.from ?? '03:00', to: data?.sleep.to ?? '05:00' };
  const [hours, setHours] = useState(savedWindow);
  useEffect(() => setHours({ from: savedWindow.from, to: savedWindow.to }), [savedWindow.from, savedWindow.to]);
  const dirty = Boolean(data) && (hours.from !== savedWindow.from || hours.to !== savedWindow.to);
  const latest = useRef({ save: async () => {}, discard: () => {} });
  latest.current = {
    save: async () => {
      if (!hours.from || !hours.to || hours.from === hours.to)
        throw new Error('Sleep needs a window: set from and until to different times.');
      const { data: next, error } = await api.PUT('/api/agents/{id}/memory/sleep-window', {
        params: { path: { id: agentId } },
        body: hours,
      });
      if (!next) fail(error, 'Could not save the sleep window.');
      refresh(next as Overview);
    },
    discard: () => setHours(savedWindow),
  };
  useEffect(() => {
    register('memory', {
      label: 'Memory',
      dirty,
      save: () => latest.current.save(),
      discard: () => latest.current.discard(),
    });
    return () => register('memory');
  }, [dirty, register]);

  const all = data?.memories ?? [];
  const forgotten = data?.forgotten ?? [];
  const shown = filter === 'forgotten' ? forgotten : filter === 'all' ? all : all.filter(item => item.type === filter);
  const selected = open ? [...all, ...forgotten].find(item => item.name === open) : undefined;
  const count = (type: string) => all.filter(item => item.type === type).length;
  const options = [
    { value: 'all' as const, label: `All ${all.length}` },
    ...TYPES.map(type => ({ value: type, label: `${type[0].toUpperCase()}${type.slice(1)} ${count(type)}` })),
    ...(forgotten.length ? [{ value: 'forgotten' as const, label: `Forgotten ${forgotten.length}` }] : []),
  ];
  const sleep = data?.sleep;
  const activeHours = Boolean(sleep?.activeFrom && sleep.activeTo);

  async function sleepNow() {
    const { data: next, error } = await api.POST('/api/agents/{id}/memory/sleep', {
      params: { path: { id: agentId } },
    });
    if (!next) return setStatus((error as { message?: string })?.message ?? 'Could not start sleep.');
    refresh(next as Overview);
    setStatus(`${agentName} is asleep: its memory is being reorganised. It keeps working meanwhile.`);
  }

  return (
    <section aria-label="Memory" className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Memory</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          What {agentName} remembers long term. It memorizes as it works and is reminded of related memories as messages
          and events come in. When it sleeps, its memory is reorganised and the index it always sees is rebuilt.
        </p>
      </div>
      <div className="min-w-0 space-y-4 rounded-lg border border-border bg-sidebar/30 p-4">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              {sleep?.sleeping
                ? 'Asleep now.'
                : sleep?.sleptAt
                  ? `Last slept ${when(sleep.sleptAt)}.`
                  : 'Has not slept yet.'}{' '}
              <span className="text-muted-foreground">
                {activeHours
                  ? `Sleeps between ${sleep!.activeTo} and ${sleep!.activeFrom}, outside its heartbeat's active hours.`
                  : 'Active all day, so it sleeps in this window:'}
              </span>
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!data || sleep?.sleeping}
              onClick={() => void sleepNow()}
            >
              {sleep?.sleeping ? 'Asleep…' : 'Sleep now'}
            </Button>
          </div>
          {!activeHours && (
            <div className="grid max-w-md gap-4 sm:grid-cols-2">
              {(['from', 'to'] as const).map(edge => (
                <div key={edge} className="space-y-2">
                  <label htmlFor={`${id}-${edge}`} className="block text-sm font-medium">
                    {edge === 'from' ? 'Sleeps from' : 'Until'}
                  </label>
                  <input
                    id={`${id}-${edge}`}
                    type="time"
                    value={hours[edge]}
                    onChange={event => setHours(current => ({ ...current, [edge]: event.target.value }))}
                    className={`${fieldClass} h-11 sm:h-10`}
                  />
                </div>
              ))}
            </div>
          )}
          {sleep?.lastNight && (
            <div className="rounded-md border border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">Last night</p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{sleep.lastNight}</p>
            </div>
          )}
          {status && (
            <p role="status" className="text-xs text-muted-foreground">
              {status}
            </p>
          )}
        </div>

        <BorderedBreadcrumb
          label="Memory location"
          items={[
            { id: 'root', text: 'Memories', current: !selected, onSelect: selected ? () => setOpen(null) : undefined },
            ...(selected ? [{ id: selected.name, text: selected.title, current: true }] : []),
          ]}
        />
        {overview.isPending && <p className="text-sm text-muted-foreground">Loading memory…</p>}
        {overview.isError && (
          <p role="alert" className="text-sm text-red-400">
            {overview.error.message}{' '}
            <button type="button" className="cursor-pointer underline" onClick={() => void overview.refetch()}>
              Retry
            </button>
          </p>
        )}
        {selected ? (
          <MemoryDetail
            key={`${selected.name}:${selected.updatedAt}:${selected.forgottenAt}`}
            agentId={agentId}
            memory={selected}
            onChanged={() => void refresh()}
            onGone={() => setOpen(null)}
          />
        ) : (
          data && (
            <div key={filter} className="min-w-0 space-y-3 motion-safe:animate-[fade-in_120ms_ease-out]">
              <ChoiceChips label="Memory type" value={filter} options={options} onChange={setFilter} />
              {!shown.length ? (
                <Empty className="min-h-32">
                  <EmptyHeader>
                    <EmptyTitle className="text-base">
                      {all.length || filter === 'forgotten' ? 'Nothing here' : 'No memories yet'}
                    </EmptyTitle>
                    <EmptyDescription>
                      {all.length ? 'No memory of this type.' : `${agentName} has not memorized anything yet.`}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ul aria-label="Memories" className="min-w-0 divide-y divide-border">
                  {shown.map(item => (
                    <li key={item.name}>
                      <button
                        type="button"
                        onClick={() => setOpen(item.name)}
                        className="grid min-h-10 w-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded px-2 py-2 text-left outline-none hover:text-primary focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm">
                            {item.title}
                            {item.conflict && <span className="ml-2 text-xs text-amber-400">conflict</span>}
                            {item.faded && <span className="ml-2 text-xs text-muted-foreground">faded</span>}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">{item.text}</span>
                        </span>
                        <span className="text-right text-xs text-muted-foreground">
                          {item.type} · {TRUST[item.trust] ?? item.trust}
                          <span className="block">{new Date(item.updatedAt).toLocaleDateString()}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                {all.length} of {data.maxCount} memories (Settings → Swarm).
              </p>
              {data.index && (
                <details className="rounded-md border border-border p-3">
                  <summary className="cursor-pointer text-sm font-medium">Index {agentName} sees</summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs [overflow-wrap:anywhere]">
                    {data.index}
                  </pre>
                </details>
              )}
              {(all.length > 0 || forgotten.length > 0) && (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-red-400"
                    onClick={() => setErasing(true)}
                  >
                    Erase all memory
                  </Button>
                </div>
              )}
            </div>
          )
        )}
      </div>
      <ConfirmDialog
        open={erasing}
        onOpenChange={setErasing}
        title={`Erase everything ${agentName} remembers?`}
        description={`All ${all.length + forgotten.length} memories, their earlier versions and the index are deleted for good. Chat history and ${agentName}'s saved context stay.`}
        confirmLabel="Erase all"
        busyLabel="Erasing…"
        onConfirm={async () => {
          const { error, response } = await api.DELETE('/api/agents/{id}/memory', {
            params: { path: { id: agentId } },
          });
          if (!response.ok) fail(error, 'Could not erase memory.');
          setOpen(null);
          await refresh();
        }}
      />
    </section>
  );
}

function MemoryDetail({
  agentId,
  memory,
  onChanged,
  onGone,
}: {
  agentId: string;
  memory: Memory;
  onChanged: () => void;
  onGone: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<{ title: string; text: string; type: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const path = { id: agentId, name: memory.name };
  const versions = useQuery({
    queryKey: ['memory-versions', agentId, memory.name, memory.updatedAt],
    queryFn: async ({ signal }) => {
      const { data, error: failure } = await api.GET('/api/agents/{id}/memory/{name}/versions', {
        params: { path },
        signal,
      });
      if (!data) fail(failure, 'Could not load versions.');
      return data!;
    },
  });
  const act = async (work: () => Promise<{ error?: unknown; response: Response }>, after?: () => void) => {
    setBusy(true);
    setError('');
    try {
      const { error: failure, response } = await work();
      if (!response.ok) fail(failure, 'That did not work. Try again.');
      after?.();
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };
  const save = (changes: { title?: string; text?: string; type?: string }) =>
    act(() =>
      api.PATCH('/api/agents/{id}/memory/{name}', {
        params: { path },
        body: { ...changes, type: changes.type as (typeof TYPES)[number] | undefined },
      }),
    );

  return (
    <div className="min-w-0 space-y-3 motion-safe:animate-[fade-in_120ms_ease-out]">
      <p className="text-xs text-muted-foreground">
        {memory.type} · from {memory.by} ({TRUST[memory.trust] ?? memory.trust})
        {memory.channelId ? ` in ${memory.channelId}` : ''}
        {' · '}created {when(memory.createdAt)} · recalled {memory.recalls}×
        {memory.faded ? ' · faded from the index' : ''}
        {memory.conflict ? ' · conflicts with another memory' : ''}
        {memory.forgottenAt ? ` · forgotten ${when(memory.forgottenAt)}` : ''}
      </p>
      {draft ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <div className="space-y-2">
              <label htmlFor={`${id}-title`} className="block text-sm font-medium">
                Title
              </label>
              <input
                id={`${id}-title`}
                value={draft.title}
                maxLength={120}
                onChange={event => setDraft({ ...draft, title: event.target.value })}
                className={`${fieldClass} h-10`}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor={`${id}-type`} className="block text-sm font-medium">
                Type
              </label>
              <select
                id={`${id}-type`}
                value={draft.type}
                onChange={event => setDraft({ ...draft, type: event.target.value })}
                className={`${fieldClass} h-10 cursor-pointer`}
              >
                {TYPES.map(type => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label htmlFor={`${id}-text`} className="sr-only">
            Memory text
          </label>
          <textarea
            id={`${id}-text`}
            value={draft.text}
            rows={6}
            maxLength={20000}
            onChange={event => setDraft({ ...draft, text: event.target.value })}
            className={`${fieldClass} resize-y py-2`}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy || !draft.title.trim() || !draft.text.trim()}
              onClick={() => void save(draft).then(() => setDraft(null))}
            >
              Save memory
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="whitespace-pre-wrap break-words rounded-lg border border-border bg-sidebar p-3 text-sm [overflow-wrap:anywhere]">
            {memory.text}
          </p>
          <div className="flex flex-wrap gap-2">
            {memory.forgottenAt ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void act(() => api.POST('/api/agents/{id}/memory/{name}/restore', { params: { path } }))}
              >
                Restore
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setDraft({ title: memory.title, text: memory.text, type: memory.type })}
                >
                  Edit
                </Button>
                {memory.faded && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        api.PATCH('/api/agents/{id}/memory/{name}', { params: { path }, body: { faded: false } }),
                      )
                    }
                  >
                    Back in the index
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  className="text-red-400"
                  onClick={() =>
                    void act(() => api.DELETE('/api/agents/{id}/memory/{name}', { params: { path } }), onGone)
                  }
                >
                  Forget
                </Button>
              </>
            )}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
      {versions.data && versions.data.length > 0 && (
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">Earlier versions ({versions.data.length})</summary>
          <ul className="mt-2 space-y-3">
            {versions.data.map(version => (
              <li key={version.createdAt} className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Until {when(version.createdAt)}, changed by{' '}
                  {version.changedBy === 'sleep' ? 'its sleep' : version.changedBy === 'owner' ? 'you' : 'the agent'} ·{' '}
                  {version.title}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{version.text}</p>
                {!memory.forgottenAt && (
                  <button
                    type="button"
                    disabled={busy}
                    className="cursor-pointer text-xs underline disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void save({ title: version.title, text: version.text, type: version.type })}
                  >
                    Restore this version
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
