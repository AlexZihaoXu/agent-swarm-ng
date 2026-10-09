import { ACTIVITY_WIDTH, PanelResizeHandle, usePanelWidth } from '@/components/panel-resize';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { AnimatePresence, m } from 'motion/react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { surface } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { buildActivityRuns, toolStatus, type ActivityRun, type ActivityStep } from '@/lib/activity-timeline';
import type { ActivityEntry, ChatAgent } from '@/use-chat';
import type { useActivityHistory } from '@/use-activity-history';

type History = ReturnType<typeof useActivityHistory>;
type Expand = (entry: ActivityEntry) => void;

const time = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

// Small line icons (Lucide geometry) for step types; decorative.
const glyphs: Record<string, string> = {
  thinking:
    'M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18ZM12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18ZM12 5v13',
  tool: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z',
  terminal: 'm4 17 6-6-6-6M12 19h8',
  web: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20',
  screen: 'M2 3h20v14H2zM8 21h8M12 17v4',
  message: 'M7.9 20A9 9 0 1 0 4 16.1L2 22Z',
  publish: 'm22 2-7 20-4-9-9-4ZM22 2 11 13',
  error: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM12 8v4M12 16h.01',
  reply: 'M4 12h16M4 6h16M4 18h10',
};
function Glyph({ name, className }: { name: keyof typeof glyphs | string; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('size-3.5 shrink-0', className)}
    >
      <path d={glyphs[name] ?? glyphs.tool} />
    </svg>
  );
}
const toolGlyph = (name: string) =>
  /^(send_message|send_dm|react_to_message)$/.test(name)
    ? 'publish'
    : /^(bash|terminal_)/.test(name)
      ? 'terminal'
      : /^(web_search|fetch_content|get_search_content)$/.test(name)
        ? 'web'
        : /^(glance|look_at|act|use_computer|release_computer|list_computers)$/.test(name)
          ? 'screen'
          : 'tool';

/** Animated disclosure (the AI Elements collapsible pattern) without a Radix Collapsible dependency. */
function Disclosure({
  summary,
  defaultOpen = false,
  children,
  className,
  kind,
}: {
  summary: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
  kind?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div data-activity-kind={kind} data-open={open ? '' : undefined} className={className}>
      <button
        type="button"
        data-disclosure
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="group flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-7"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">{summary}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180',
          )}
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <m.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={surface}
            className="overflow-hidden"
          >
            <div className="pt-2">{children}</div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Entry text, paged from the durable archive on request. */
function EntryText({
  entry,
  history,
  expand,
  terminal = false,
}: {
  entry: ActivityEntry;
  history: History['activityHistory'];
  expand: Expand;
  terminal?: boolean;
}) {
  const waiting = ['streaming', 'running', 'pending'].includes(entry.state ?? '');
  return (
    <div className="min-w-0">
      <pre
        className={cn(
          'max-h-72 min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-md p-2 font-mono text-[11px] leading-relaxed [overflow-wrap:anywhere]',
          terminal ? 'bg-[#141414] text-[#d4d4d4] ring-1 ring-white/10' : 'bg-muted/40 text-muted-foreground',
        )}
      >
        {entry.text || (waiting ? 'Waiting for content…' : '(No text content)')}
      </pre>
      {entry.nextOffset != null && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            Partial view · {new TextEncoder().encode(entry.text).length.toLocaleString()} of{' '}
            {entry.totalLength?.toLocaleString() ?? 'unknown'} bytes loaded
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={history.entryLoading[entry.id]}
            onClick={() => expand(entry)}
          >
            {history.entryLoading[entry.id]
              ? 'Loading text…'
              : history.entryFailed[entry.id]
                ? 'Retry more text'
                : 'Load more text'}
          </Button>
        </div>
      )}
      {history.entryFailed[entry.id] && (
        <p role="alert" className="mt-1 text-[11px] text-muted-foreground">
          Could not load the next text section.
        </p>
      )}
    </div>
  );
}

/** The recorded screenshot a result refers to, or null when the result is ordinary text. */
function screenshotId(agentId: string, entry: ActivityEntry) {
  if (entry.kind !== 'tool_result' || !/^(glance|look_at|read) — (result|image)$/.test(entry.label)) return null;
  try {
    const reference = JSON.parse(entry.text) as { id?: unknown; agentId?: unknown };
    return reference?.agentId === agentId && typeof reference.id === 'string' && /^[0-9a-f-]{36}$/i.test(reference.id)
      ? reference.id
      : null;
  } catch {
    return null;
  }
}

function ActivityScreenshot({ agentId, entry }: { agentId: string; entry: ActivityEntry }) {
  const [unavailable, setUnavailable] = useState(false);
  const id = screenshotId(agentId, entry);
  if (!id) return null;
  const reference = { id };
  const url = `/api/agents/${encodeURIComponent(agentId)}/screenshots/${reference.id}`;
  return unavailable ? (
    <p className="text-[11px] text-muted-foreground">
      Screenshot expired or unavailable ({reference.id}); its activity metadata remains.
    </p>
  ) : (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Open recorded screenshot"
    >
      <img
        src={url}
        loading="lazy"
        alt="Recorded agent view of the computer"
        onError={() => setUnavailable(true)}
        className="h-auto w-full rounded-md border border-border"
      />
    </a>
  );
}

const statusBadge = {
  running: ['Running', 'text-teal-300 bg-teal-400/10'],
  done: ['Done', 'text-muted-foreground bg-foreground/[0.06]'],
  error: ['Error', 'text-red-300 bg-red-500/10'],
} as const;

function Step({
  step,
  agentId,
  history,
  expand,
}: {
  step: ActivityStep;
  agentId: string;
  history: History['activityHistory'];
  expand: Expand;
}) {
  if (step.type === 'tool') {
    const status = toolStatus(step);
    const [label, tone] = statusBadge[status];
    const terminal = toolGlyph(step.name) === 'terminal';
    const shot =
      step.result && screenshotId(agentId, step.result) ? (
        <ActivityScreenshot agentId={agentId} entry={step.result} />
      ) : null;
    return (
      // AI Elements "Tool": a card per call with a status badge; parameters and result on demand.
      <div className="rounded-lg border border-border bg-background/60 px-2.5 py-1">
        <Disclosure
          kind="tool"
          summary={
            <>
              <Glyph name={toolGlyph(step.name)} className="text-muted-foreground" />
              <span className="shrink-0 font-mono text-[11px] font-medium">{step.name}</span>
              {step.call?.text && step.call.text !== step.call.label && (
                <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
                  {step.call.text.replace(/\s+/g, ' ')}
                </span>
              )}
              <span className={cn('ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px]', tone)}>
                {status === 'running' && (
                  <span className="presence-pulse mr-1 inline-block size-1.5 rounded-full bg-current align-middle" />
                )}
                {label}
              </span>
            </>
          }
        >
          <div className="space-y-2 pb-1.5">
            {step.call && step.call.text && step.call.text !== step.call.label && (
              <div>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Input</p>
                <EntryText entry={step.call} history={history} expand={expand} />
              </div>
            )}
            {step.result && (
              <div>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {status === 'error' ? 'Error' : 'Result'}
                </p>
                {shot || <EntryText entry={step.result} history={history} expand={expand} terminal={terminal} />}
              </div>
            )}
            {step.details.map(detail => (
              <Disclosure
                key={detail.id}
                kind="metadata"
                summary={<span className="text-[11px] text-muted-foreground">{detail.label}</span>}
              >
                <EntryText entry={detail} history={history} expand={expand} />
              </Disclosure>
            ))}
          </div>
        </Disclosure>
        {shot && <div className="pb-1.5">{shot}</div>}
      </div>
    );
  }
  const { entry } = step;
  const titles: Record<typeof step.type, string> = {
    thinking: ['streaming', 'running'].includes(entry.state ?? '') ? 'Thinking…' : 'Thought',
    message: 'Received',
    reply: 'Replied',
    publish: 'Published to chat',
    error: 'Error',
    note: entry.label,
  };
  // A one-line preview: markdown markers and extra whitespace removed.
  const preview = entry.text
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (
    // AI Elements "Chain of Thought" step: icon, short label, a one-line preview; full text on demand.
    <Disclosure
      kind={entry.kind}
      className={cn(step.type === 'error' && 'text-red-300')}
      summary={
        <>
          <Glyph name={step.type} className={step.type === 'error' ? 'text-red-400' : 'text-muted-foreground'} />
          <span className="shrink-0 font-medium">{titles[step.type]}</span>
          <span className="min-w-0 truncate text-muted-foreground">{preview}</span>
        </>
      }
    >
      <EntryText entry={entry} history={history} expand={expand} />
    </Disclosure>
  );
}

function Run({
  run,
  agentId,
  latest,
  history,
  expand,
}: {
  run: ActivityRun;
  agentId: string;
  latest: boolean;
  history: History['activityHistory'];
  expand: Expand;
}) {
  const failed = run.steps.some(step => step.type === 'error');
  return (
    <section
      data-anchor-id={`run:${run.id}`}
      aria-label={`Run at ${time(run.started)}`}
      className="card-enter rounded-xl border border-border bg-background/40 ao-card p-3"
      title={`Channel ${run.channelId} · Run ${run.id}`}
    >
      <Disclosure
        defaultOpen={latest || run.active}
        summary={
          <>
            <span
              aria-hidden="true"
              className={cn(
                'size-2 shrink-0 rounded-full',
                run.active ? 'presence-pulse bg-teal-400' : failed ? 'bg-red-400' : 'bg-muted-foreground/60',
              )}
            />
            <span className="font-medium">{run.active ? 'Working' : failed ? 'Ended with an error' : 'Run'}</span>
            <span className="text-muted-foreground">
              {time(run.started)} · {run.steps.length} {run.steps.length === 1 ? 'step' : 'steps'}
            </span>
          </>
        }
      >
        {/* The connecting line is the chain; each step hangs off it. */}
        <ol className="relative ml-1 space-y-1.5 border-l border-border pl-3">
          {run.steps.map(step => (
            <li key={step.id} data-anchor-id={step.id} className="min-w-0">
              <Step step={step} agentId={agentId} history={history} expand={expand} />
            </li>
          ))}
          {run.steps.length === 0 && <li className="text-xs text-muted-foreground">No steps recorded.</li>}
        </ol>
        {(run.outcome || run.details.length > 0) && (
          <div className="mt-2 flex min-w-0 flex-col gap-1 border-t border-border pt-2">
            {run.outcome && (
              <p className="min-w-0 truncate text-[11px] text-muted-foreground">
                {run.outcome.label}
                {run.outcome.text && run.outcome.text !== run.outcome.label ? ` · ${run.outcome.text}` : ''}
              </p>
            )}
            {run.details.length > 0 && (
              <Disclosure
                summary={
                  <span className="text-[11px] text-muted-foreground">
                    Details · {run.details.length} provider and runtime{' '}
                    {run.details.length === 1 ? 'record' : 'records'}
                  </span>
                }
              >
                <div className="space-y-1">
                  {run.details.map(detail => (
                    <Disclosure
                      key={detail.id}
                      kind={detail.kind}
                      summary={
                        <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                          {detail.label} · {time(detail.timestamp)}
                        </span>
                      }
                    >
                      <EntryText entry={detail} history={history} expand={expand} />
                    </Disclosure>
                  ))}
                </div>
              </Disclosure>
            )}
          </div>
        )}
      </Disclosure>
    </section>
  );
}

export function AgentActivityPanel({
  agent,
  entries,
  open,
  onOpenChange,
  history,
  loadActivity,
  expandActivity,
  retryActivity,
  requestError,
  compaction = null,
}: {
  agent: ChatAgent;
  /** Background compaction right now: summarizing older context, or asleep until that is done. */
  compaction?: 'running' | 'sleeping' | null;
  entries: ActivityEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestError?: string;
  history: History['activityHistory'];
  loadActivity: History['loadActivity'];
  expandActivity: History['expandActivity'];
  retryActivity: History['retryActivity'];
}) {
  const activityWidth = usePanelWidth('activity', ACTIVITY_WIDTH, '--activity-width');
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  const contextUsage = history.contextUsage[agent.id];
  const usageLine = contextUsage?.text.split('\n')[0];
  const percent = Number(usageLine?.match(/([\d.]+)%/)?.[1] ?? NaN);
  const loading = history.loading[agent.id],
    failed = history.failed[agent.id];
  const hasOlder = history.cursor[agent.id] != null;
  const anchor = useRef<{ id: string; offset: number } | null>(null);
  useEffect(() => {
    if (open) void loadActivity(agent.id);
  }, [agent.id, open, loadActivity]);
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const update = () => setWide(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useLayoutEffect(() => {
    follow.current = true;
    anchor.current = null;
  }, [agent.id, open]);
  // Remember the first visible step (or collapsed run) so it stays put when older activity arrives above it or a
  // run gains earlier steps. Steps win over their run, since a run can grow above them.
  const measure = () => {
    const root = viewport.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top;
    for (const element of root.querySelectorAll<HTMLElement>('[data-anchor-id]')) {
      const rect = element.getBoundingClientRect();
      if (rect.bottom <= top || rect.height === 0) continue;
      anchor.current = { id: element.dataset.anchorId!, offset: rect.top - top };
      if (element.tagName !== 'SECTION' || !element.querySelector('[data-anchor-id]')) return;
    }
  };
  useLayoutEffect(() => {
    const root = viewport.current;
    if (!root) return;
    if (follow.current) {
      root.scrollTop = root.scrollHeight;
      return;
    }
    const element =
      anchor.current && root.querySelector<HTMLElement>(`[data-anchor-id="${CSS.escape(anchor.current.id)}"]`);
    if (element)
      root.scrollTop += element.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.current!.offset;
  }, [entries, hasOlder, open, agent.id]);
  const loadOlder = () => {
    if (loading || !hasOlder) return;
    follow.current = false;
    measure();
    void loadActivity(agent.id, true);
  };
  const olderRef = useRef(loadOlder);
  olderRef.current = loadOlder;
  // Older history loads itself near the top (as a chat does), and keeps loading while the panel is not yet full.
  // A page that adds nothing stops the filling, so a cursor without new entries cannot loop.
  const filledAt = useRef(-1);
  useEffect(() => {
    const root = viewport.current;
    if (!open || !root || !hasOlder || loading || filledAt.current === entries.length) return;
    if (root.scrollHeight <= root.clientHeight + 8) {
      filledAt.current = entries.length;
      olderRef.current();
    }
  }, [open, hasOlder, loading, entries.length]);
  const runs = buildActivityRuns(entries);
  const expand: Expand = entry => void expandActivity(agent.id, entry);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={!wide}>
      <Dialog.Trigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label="Agent activity"
          title="Agent activity"
          className="ml-auto size-11 border-0 p-0 sm:size-8"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            className="size-4"
          >
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M15 3v18M18 8h1M18 12h1M18 16h1" strokeLinecap="round" />
          </svg>
        </Button>
      </Dialog.Trigger>
      {/* Kibo sheet/standard/sheet-standard-2; docked on desktop, modal on narrow screens. */}
      <Dialog.Portal>
        {!wide && (
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 motion-safe:data-[state=open]:animate-[fade-in_200ms_ease-out] motion-safe:data-[state=closed]:animate-[fade-out_160ms_ease-in]" />
        )}
        <Dialog.Content
          style={activityWidth.style}
          className="fixed bottom-0 right-0 top-[calc(4rem+env(safe-area-inset-top))] z-50 flex w-full min-w-0 max-w-sm sm:top-14 md:w-[min(var(--panel-width),calc(100vw-24rem))] md:max-w-none flex-col border-l border-border bg-sidebar shadow-xl outline-none motion-safe:data-[state=open]:animate-[activity-in_180ms_ease-out] motion-safe:data-[state=closed]:animate-[activity-out_140ms_ease-in]"
          onInteractOutside={event => {
            if (wide) event.preventDefault();
          }}
          onOpenAutoFocus={event => {
            if (wide) event.preventDefault();
          }}
        >
          <header className="min-w-0 shrink-0 border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Dialog.Title className="text-sm font-semibold">Agent activity</Dialog.Title>
              <Popover.Root>
                <Popover.Trigger
                  aria-label="About agent activity"
                  className="flex size-6 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    className="size-3.5"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
                  </svg>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    side="bottom"
                    align="start"
                    sideOffset={6}
                    className="context-menu-content z-[60] max-w-72 rounded-lg border border-border bg-background p-3 text-xs leading-relaxed text-muted-foreground ao-top shadow-lg"
                  >
                    Saved runtime history for operators; none of it is sent to chat. Reasoning appears only when the
                    model provides it, and credentials and hidden provider data are never stored here.
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
              <Dialog.Close asChild>
                <Button
                  variant="flat"
                  size="sm"
                  aria-label="Close activity"
                  className="ml-auto size-11 border-0 p-0 sm:size-7"
                >
                  <span aria-hidden="true">×</span>
                </Button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">{agent.name}</Dialog.Description>
            <div className="mt-2" title={contextUsage?.text}>
              <div className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
                <span>Context</span>
                <span aria-label="Context usage" className="tabular-nums">
                  {usageLine ?? 'Waiting for a runtime update'}
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
                <div
                  className={cn(
                    'h-full rounded-full transition-[width] duration-500',
                    percent > 85 ? 'bg-red-400' : percent > 60 ? 'bg-amber-300' : 'bg-teal-400',
                  )}
                  style={{ width: `${Number.isFinite(percent) ? Math.min(100, percent) : 0}%` }}
                />
              </div>
            </div>
            {requestError && (
              <p role="alert" className="mt-2 text-xs text-destructive">
                Dashboard request (not saved): {requestError}
              </p>
            )}
          </header>
          <ScrollArea
            label="Agent activity history"
            viewportRef={viewport}
            className="min-h-0 min-w-0 flex-1"
            viewportClassName="[overflow-anchor:none]"
            onScroll={event => {
              const element = event.currentTarget;
              follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
              measure();
              if (element.scrollTop < 120) olderRef.current();
            }}
          >
            <div className="w-full min-w-0 space-y-3 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4">
              {hasOlder && (
                <button
                  type="button"
                  onClick={loadOlder}
                  disabled={loading}
                  className="sr-only focus:not-sr-only focus:rounded-md focus:px-2 focus:py-1 focus:text-xs"
                >
                  Load older activity
                </button>
              )}
              {/* Held in place whenever older activity exists, so starting a load never pushes the content. */}
              {(loading || hasOlder) && (
                <div
                  role={loading ? 'status' : undefined}
                  aria-label={loading ? 'Loading activity…' : undefined}
                  aria-hidden={loading ? undefined : true}
                  className="space-y-2"
                >
                  <Skeleton className="h-16 rounded-xl" />
                  <Skeleton className="h-10 rounded-xl" />
                </div>
              )}
              {failed && (
                <div role="alert" className="text-xs text-muted-foreground">
                  Could not load activity.{' '}
                  <Button variant="outline" size="sm" disabled={loading} onClick={() => void retryActivity(agent.id)}>
                    Retry activity
                  </Button>
                </div>
              )}
              {!loading && !failed && entries.length === 0 && (
                <p className="py-6 text-xs leading-relaxed text-muted-foreground">
                  New activity will appear here when this agent runs.
                </p>
              )}
              {runs.map((run, index) => (
                <Run
                  key={run.id}
                  run={run}
                  agentId={agent.id}
                  latest={index === runs.length - 1}
                  history={history}
                  expand={expand}
                />
              ))}
              {compaction && (
                <section
                  role="status"
                  aria-label="Background compaction"
                  className="card-enter rounded-xl border border-violet-400/30 bg-violet-400/5 p-3"
                >
                  <div className="flex min-w-0 items-center gap-2 text-xs">
                    {compaction === 'sleeping' ? (
                      <span aria-hidden="true" className="shrink-0 font-semibold text-violet-300">
                        zzz
                      </span>
                    ) : (
                      <span aria-hidden="true" className="relative size-3 shrink-0">
                        <span className="compaction-ring absolute inset-0 rounded-full" />
                      </span>
                    )}
                    <span className="font-medium">{compaction === 'sleeping' ? 'Sleeping…' : 'Compacting…'}</span>
                    <span className="min-w-0 truncate text-muted-foreground">
                      {compaction === 'sleeping'
                        ? 'Context is full; continuing once the summary is ready'
                        : 'Summarizing older context in the background'}
                    </span>
                  </div>
                </section>
              )}
            </div>
          </ScrollArea>
          <PanelResizeHandle panel={activityWidth} side="left" label="Resize the activity panel" />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
