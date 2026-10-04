import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type Category = 'all' | 'signin' | 'users' | 'agents' | 'computers' | 'organizations' | 'system';
type AuditEvent = {
  sequence: number;
  at: string;
  kind: string;
  outcome: string;
  actor: string | null;
  ip: string | null;
  targetId: string | null;
  targetName: string | null;
  detail: Record<string, unknown> | null;
  ipLabel?: string | null;
  ipTrusted?: boolean;
};

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'signin', label: 'Sign-in' },
  { value: 'users', label: 'Users' },
  { value: 'agents', label: 'Agents' },
  { value: 'computers', label: 'Computers' },
  { value: 'organizations', label: 'Organizations' },
  { value: 'system', label: 'System' },
];

const EVENTS: Record<string, string> = {
  'auth.login': 'Sign-in',
  'auth.setup': 'Password set (first sign-in)',
  'auth.logout': 'Sign-out',
  'auth.password': 'Password change',
  'auth.lockdown': 'Sign-in locked down',
  'auth.unlock': 'Lockdown lifted',
  'auth.address': 'Known address changed',
  'user.create': 'User created',
  'user.update': 'User changed',
  'user.delete': 'User deleted',
  'agent.create': 'Agent created',
  'agent.update': 'Agent edited',
  'agent.delete': 'Agent deleted',
  'computer.create': 'Computer created',
  'computer.update': 'Computer settings changed',
  'computer.delete': 'Computer deleted',
  'organization.create': 'Organization created',
  'organization.update': 'Organization renamed',
  'organization.delete': 'Organization deleted',
  'organization.move': 'Moved into organization',
  'system.start': 'Platform started',
  'system.stop': 'Platform stopped',
};

const OUTCOMES: Record<string, { label: string; className: string }> = {
  ok: { label: 'OK', className: 'bg-emerald-500/15 text-emerald-400' },
  failed: { label: 'Failed', className: 'bg-red-500/15 text-red-400' },
  denied: { label: 'Denied', className: 'bg-amber-500/15 text-amber-400' },
};

/** Local date and time to the millisecond; the exact UTC instant is in the title. */
const timeFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hourCycle: 'h23',
  timeZoneName: 'short',
});

/** What else is worth showing: the reason, the section and changed fields, a new name, a status. Never values. */
function describe(event: AuditEvent) {
  const detail = event.detail ?? {};
  const parts: string[] = [];
  if (typeof detail.reason === 'string') parts.push(detail.reason);
  if (typeof detail.section === 'string' && detail.section !== 'agent') parts.push(detail.section);
  if (Array.isArray(detail.fields) && detail.fields.length && event.kind !== 'organization.move')
    parts.push(detail.fields.join(', '));
  if (typeof detail.newName === 'string') parts.push(`now “${detail.newName}”`);
  if (typeof detail.moved === 'string') parts.push(detail.moved);
  if (typeof detail.memory === 'string') parts.push(`memory “${detail.memory}”`);
  if (typeof detail.signal === 'string') parts.push(detail.signal);
  if (typeof detail.change === 'string') parts.push(`${detail.change}${detail.trusted ? ' (trusted)' : ''}`);
  if (typeof detail.addresses === 'string') parts.push(`from ${detail.addresses}`);
  if (typeof detail.status === 'number') parts.push(`HTTP ${detail.status}`);
  return parts.join(' · ');
}

/**
 * Settings → Audit log (docs/audit-log.md): sign-in attempts, organizations, computers and agents created, edited or
 * deleted, and the platform starting and stopping. Kibo's Dense Table (table/advanced/table-advanced-2), newest
 * first, filtered by category, with older events on request.
 */
export function AuditLog({ onNavigate }: { onNavigate: (path: string) => void }) {
  // A banner's "View logs" opens it on a category (?category=signin).
  const asked = new URLSearchParams(useLocation().search).get('category');
  const [category, setCategory] = useState<Category>(
    CATEGORIES.some(item => item.value === asked) ? (asked as Category) : 'all',
  );
  // A banner's link while the page is already open switches the category too.
  useEffect(() => {
    if (CATEGORIES.some(item => item.value === asked)) setCategory(asked as Category);
  }, [asked]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  // Older pages belong to the category they were asked for: a filter change meanwhile drops them.
  const shown = useRef(category);
  shown.current = category;

  const load = async (before?: number, signal?: AbortSignal) => {
    const { data, error: failure } = await api.GET('/api/audit', {
      params: { query: { ...(category === 'all' ? {} : { category }), ...(before ? { before } : {}), limit: 100 } },
      signal,
    });
    if (!data || failure) throw new Error('Could not load the audit log.');
    return data as { events: AuditEvent[]; next: number | null };
  };

  useEffect(() => {
    const controller = new AbortController();
    // A new category starts from its own first page.
    setEvents([]);
    setNext(null);
    setLoading(true);
    setError('');
    load(undefined, controller.signal)
      .then(data => {
        setEvents(data.events);
        setNext(data.next);
      })
      .catch(caught => {
        if (!controller.signal.aborted) setError((caught as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, attempt]);

  const older = async () => {
    if (next === null) return;
    const asked = category;
    setLoading(true);
    try {
      const data = await load(next);
      if (shown.current !== asked) return;
      setEvents(current => [...current, ...data.events]);
      setNext(data.next);
    } catch (caught) {
      if (shown.current === asked) setError((caught as Error).message);
    } finally {
      if (shown.current === asked) setLoading(false);
    }
  };

  return (
    <section
      aria-label="Audit log"
      className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col motion-safe:animate-[view-in_180ms_cubic-bezier(0.22,1,0.36,1)] md:px-6"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-0">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Audit log</h2>
          <p className="text-xs text-muted-foreground">
            Sign-ins and changes to users, agents, computers and organizations
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-11 sm:min-h-0"
            onClick={() => setAttempt(value => value + 1)}
          >
            Refresh
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-11 sm:min-h-0"
            onClick={() => onNavigate('/settings')}
          >
            Back to settings
          </Button>
        </div>
      </header>
      <div className="shrink-0 border-b border-border px-4 py-3 md:px-0">
        <ChoiceChips label="Show" value={category} options={CATEGORIES} onChange={setCategory} />
      </div>
      <ScrollArea label="Audit events" className="min-h-0 flex-1">
        <div className="px-4 py-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-0 md:pb-6">
          {error && (
            <p role="alert" className="mb-3 text-sm text-red-400">
              {error}
            </p>
          )}
          {/* Wide on phones: the table scrolls sideways inside its frame, never the page. */}
          <div className="relative w-full overflow-x-auto rounded-md border border-border bg-background">
            <table className="w-full min-w-[46rem] caption-bottom text-sm">
              <thead>
                <tr className="h-8 border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Who</th>
                  <th className="px-3 py-2 font-medium">IP address</th>
                  <th className="px-3 py-2 font-medium">Target</th>
                  <th className="px-3 py-2 text-right font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {events.map(event => {
                  const outcome = OUTCOMES[event.outcome] ?? { label: event.outcome, className: 'bg-muted' };
                  const detail = describe(event);
                  return (
                    <tr key={event.sequence} className="h-8 border-b border-border/60 last:border-0 align-top">
                      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs tabular-nums">
                        <time dateTime={event.at} title={event.at}>
                          {timeFormat.format(new Date(event.at))}
                        </time>
                      </td>
                      <td className="px-3 py-1.5">
                        <div>{EVENTS[event.kind] ?? event.kind}</div>
                        {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
                      </td>
                      <td className="max-w-40 truncate px-3 py-1.5" title={event.actor ?? undefined}>
                        {event.actor ?? '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                        {event.ipLabel && (
                          <span className="mr-1.5 font-medium" title={event.ipTrusted ? 'Trusted address' : undefined}>
                            {event.ipLabel}
                            {event.ipTrusted ? ' ✓' : ''}
                          </span>
                        )}
                        <span className="font-mono">{event.ip ?? '—'}</span>
                      </td>
                      <td className="max-w-48 truncate px-3 py-1.5" title={event.targetId ?? undefined}>
                        {event.targetName ?? event.targetId ?? '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', outcome.className)}>
                          {outcome.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {!events.length && !loading && !error && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                      Nothing logged here yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center gap-3">
            {next !== null && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-11 sm:min-h-0"
                disabled={loading}
                onClick={() => void older()}
              >
                Load older events
              </Button>
            )}
            {loading && (
              <p role="status" className="text-sm text-muted-foreground">
                Loading…
              </p>
            )}
          </div>
        </div>
      </ScrollArea>
    </section>
  );
}
