import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { XIcon } from '@/components/ui/icons';
import { settingsCard, settingsInput } from '@/lib/styles';
import { noAutofill } from '@/lib/no-autofill';
import { cn } from '@/lib/utils';
import type { ChatAgent, RealAgent } from '@/use-chat';
import type { RegisterSection } from '@/lib/settings-sections';
import type { paths } from '@/api/schema';

type Timer = paths['/api/agents/{id}/timers']['get']['responses'][200]['content']['application/json']['timers'][number];
type Change = paths['/api/agents/{id}/timers']['put']['requestBody']['content']['application/json']['changes'][number];
/** What the owner typed for one row; empty fields are unchanged. */
type Draft = { cancel?: boolean; note?: string; next?: string; everyMinutes?: string; total?: string };

/** `datetime-local` text in this browser's zone, and back. */
const localInput = (iso: string) => {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const minutesText = (seconds?: number) => (seconds === undefined ? '' : String(Math.round((seconds / 60) * 100) / 100));
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** The changes a draft makes to its timer, in the API's terms (nothing when it matches). */
function changeOf(timer: Timer, draft: Draft): Change | null {
  if (draft.cancel) return { id: timer.id, cancel: true };
  const change: Change = { id: timer.id };
  if (draft.note !== undefined && draft.note.trim() !== timer.note) change.note = draft.note.trim();
  if (draft.next !== undefined && draft.next !== localInput(timer.nextAt) && draft.next)
    change.nextAt = new Date(draft.next).toISOString();
  if (timer.kind === 'reminder') {
    if (draft.everyMinutes !== undefined && draft.everyMinutes !== minutesText(timer.everySeconds))
      change.everySeconds = Number(draft.everyMinutes) * 60;
    const total = timer.total === 'unlimited' ? '' : String(timer.total ?? '');
    if (draft.total !== undefined && draft.total.trim() !== total)
      change.total = draft.total.trim() ? Number(draft.total) : null;
  }
  return Object.keys(change).length > 1 ? change : null;
}

/**
 * Agents → agent → Timers (docs/agent-time.md#owner-changes): the timers and reminders the agent set, with their
 * next time, kept across restarts. The owner may change or cancel them; Save first says the agent will be told, and
 * after saving it is (a platform note in its next turn). The list follows the agent's own changes live.
 */
export function AgentTimerSettings({
  agent,
  register,
}: {
  agent: ChatAgent & { real: RealAgent };
  register: RegisterSection;
}) {
  const id = useId();
  const client = useQueryClient();
  const key = ['agent-timers', agent.id];
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/agents/{id}/timers', { params: { path: { id: agent.id } } });
      if (!data || error) throw new Error(error?.message ?? 'Could not load the timers.');
      return data.timers;
    },
  });
  useEffect(() => {
    const refresh = (event: Event) => {
      if ((event as CustomEvent<string>).detail === agent.id) void client.invalidateQueries({ queryKey: key });
    };
    window.addEventListener('swarm-timers-updated', refresh);
    return () => window.removeEventListener('swarm-timers-updated', refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id, client]);
  const timers = query.data ?? [];
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState('');
  const pending = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);
  // A timer that fired or was cancelled meanwhile drops its draft.
  const live = timers.filter(timer => drafts[timer.id]);
  const changes = live.flatMap(timer => changeOf(timer, drafts[timer.id]!) ?? []);
  const dirty = changes.length > 0;
  const draft = (timerId: string, patch: Draft) => {
    setStatus('');
    setDrafts(current => ({ ...current, [timerId]: { ...current[timerId], ...patch } }));
  };

  async function persist() {
    const { data, error } = await api.PUT('/api/agents/{id}/timers', {
      params: { path: { id: agent.id } },
      body: { changes },
    });
    if (!data || error) throw new Error(error?.message ?? 'Could not save the timers.');
    client.setQueryData(key, data.timers);
    setDrafts({});
    setStatus(`Saved. ${agent.name} has been told what changed.`);
  }
  const latest = useRef({ save: async () => {}, discard: () => {} });
  latest.current = {
    // The page's Save waits for the owner to confirm the notice.
    save: () => {
      setStatus('');
      setConfirming(true);
      return new Promise<void>((resolve, reject) => {
        pending.current = { resolve, reject };
      });
    },
    discard: () => {
      setDrafts({});
      setStatus('');
    },
  };
  useEffect(() => {
    register('timers', {
      label: 'Timers',
      dirty,
      save: () => latest.current.save(),
      discard: () => latest.current.discard(),
    });
    return () => register('timers');
  }, [dirty, register]);

  return (
    <section aria-label="Timers" className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Timers</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          The timers and repeating reminders {agent.name} set for itself. They survive restarts: anything that came due
          while Agent Swarm was down fires when it is back, and {agent.name} is told how late it is. Change or cancel
          them here; {agent.name} is told what you changed.
        </p>
      </div>
      <div className={cn(settingsCard, 'space-y-3')}>
        {query.isPending ? (
          <p className="text-sm text-muted-foreground">Loading timers…</p>
        ) : query.isError ? (
          <p role="alert" className="text-sm">
            Could not load the timers.{' '}
            <button type="button" className="cursor-pointer underline" onClick={() => void query.refetch()}>
              Retry
            </button>
          </p>
        ) : !timers.length ? (
          <p className="text-sm text-muted-foreground">
            No timers or reminders. {agent.name} sets them with set_timer and set_reminder.
          </p>
        ) : (
          <ul className="space-y-3" aria-label={`${agent.name}'s timers`}>
            {timers.map(timer => {
              const row = drafts[timer.id] ?? {};
              const cancelled = Boolean(row.cancel);
              const field = `${id}-${timer.id}`;
              return (
                <li
                  key={timer.id}
                  aria-label={`${timer.kind === 'reminder' ? 'Reminder' : 'Timer'}: ${timer.note || '(no note)'}`}
                  className={cn('rounded-lg border border-border bg-background/60 p-3', cancelled && 'opacity-60')}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {timer.kind === 'reminder' ? 'Reminder' : 'Timer'}
                        <span className="ml-2 font-normal text-muted-foreground">
                          next {when(timer.nextAt)}
                          {timer.kind === 'reminder' &&
                            ` · fired ${timer.fired ?? 0}${timer.total === 'unlimited' ? '' : ` of ${timer.total}`}`}
                        </span>
                      </p>
                      {cancelled && <p className="text-xs text-muted-foreground">Cancelled when you save.</p>}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 shrink-0 gap-1.5 px-2"
                      aria-label={cancelled ? `Keep ${timer.note || timer.id}` : `Cancel ${timer.note || timer.id}`}
                      onClick={() => draft(timer.id, { cancel: !cancelled })}
                    >
                      {cancelled ? (
                        'Undo'
                      ) : (
                        <>
                          <XIcon />
                          Cancel
                        </>
                      )}
                    </Button>
                  </div>
                  {!cancelled && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5 sm:col-span-2">
                        <label htmlFor={`${field}-note`} className="block text-xs font-medium">
                          Note
                        </label>
                        <input
                          id={`${field}-note`}
                          value={row.note ?? timer.note}
                          maxLength={256}
                          onChange={event => draft(timer.id, { note: event.target.value })}
                          className={settingsInput}
                          {...noAutofill}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor={`${field}-next`} className="block text-xs font-medium">
                          Next time
                        </label>
                        <input
                          id={`${field}-next`}
                          type="datetime-local"
                          value={row.next ?? localInput(timer.nextAt)}
                          onChange={event => draft(timer.id, { next: event.target.value })}
                          className={settingsInput}
                        />
                      </div>
                      {timer.kind === 'reminder' && (
                        <>
                          <div className="space-y-1.5">
                            <label htmlFor={`${field}-every`} className="block text-xs font-medium">
                              Every (minutes)
                            </label>
                            <input
                              id={`${field}-every`}
                              inputMode="decimal"
                              value={row.everyMinutes ?? minutesText(timer.everySeconds)}
                              onChange={event => draft(timer.id, { everyMinutes: event.target.value })}
                              className={settingsInput}
                              {...noAutofill}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label htmlFor={`${field}-total`} className="block text-xs font-medium">
                              Times in all
                            </label>
                            <input
                              id={`${field}-total`}
                              inputMode="numeric"
                              placeholder="Until cancelled"
                              value={row.total ?? (timer.total === 'unlimited' ? '' : String(timer.total ?? ''))}
                              onChange={event => draft(timer.id, { total: event.target.value })}
                              className={settingsInput}
                              {...noAutofill}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {status && (
          <p role="status" className="text-xs text-muted-foreground">
            {status}
          </p>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        tone="info"
        onOpenChange={open => {
          setConfirming(open);
          // Closed without saving: the changes stay unsaved.
          if (!open && pending.current) {
            pending.current.reject(new Error('Timer changes not saved.'));
            pending.current = null;
          }
        }}
        title="Save timer changes?"
        description={
          <>
            <span className="block">
              {agent.name} will be told what you changed ({changes.length} timer{changes.length === 1 ? '' : 's'}), in
              its next turn, so it can adjust its plans. If it is working right now, it hears about it straight away.
            </span>
          </>
        }
        confirmLabel="Save and tell it"
        busyLabel="Saving…"
        onConfirm={async () => {
          await persist();
          pending.current?.resolve();
          pending.current = null;
        }}
      />
    </section>
  );
}
