import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ActivityEntry, ChatAgent } from '@/use-chat';
import type { useActivityHistory } from '@/use-activity-history';

type History = ReturnType<typeof useActivityHistory>;
function ActivityScreenshot({ agentId, entry }: { agentId: string; entry: ActivityEntry }) {
  const [unavailable, setUnavailable] = useState(false);
  if (entry.kind !== 'tool_result' || !/^(glance|look_at) — result$/.test(entry.label)) return null;
  let reference: { id?: string; agentId?: string };
  try { reference = JSON.parse(entry.text); } catch { return null; }
  if (!reference || reference.agentId !== agentId || typeof reference.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(reference.id)) return null;
  const url = `/api/agents/${encodeURIComponent(agentId)}/screenshots/${reference.id}`;
  return unavailable ? <p className="mt-2 text-xs text-muted-foreground">Screenshot expired or unavailable; its activity metadata remains.</p>
    : <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 block cursor-pointer rounded outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Open recorded screenshot"><img src={url} loading="lazy" alt="Recorded agent view of the computer" onError={() => setUnavailable(true)} className="h-auto w-full rounded border border-border" /></a>;
}
export function AgentActivityPanel({ agent, entries, open, onOpenChange, history, loadActivity, expandActivity, retryActivity, requestError }: {
  agent: ChatAgent; entries: ActivityEntry[]; open: boolean; onOpenChange: (open: boolean) => void;
  requestError?: string;
  history: History['activityHistory']; loadActivity: History['loadActivity']; expandActivity: History['expandActivity']; retryActivity: History['retryActivity'];
}) {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  const contextUsage = history.contextUsage[agent.id];
  const loading = history.loading[agent.id], failed = history.failed[agent.id];
  const anchor = useRef<{ id?: string; height: number; top: number } | null>(null);
  useEffect(() => { if (open) void loadActivity(agent.id); }, [agent.id, open, loadActivity]);
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const update = () => setWide(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useLayoutEffect(() => { follow.current = true; anchor.current = null; }, [agent.id, open]);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    if (anchor.current && anchor.current.id !== entries[0]?.id) {
      element.scrollTop = anchor.current.top + element.scrollHeight - anchor.current.height; anchor.current = null;
    } else if (follow.current) element.scrollTop = element.scrollHeight;
  }, [entries, open, agent.id]);
  const loadOlder = () => {
    if (viewport.current) anchor.current = { id: entries[0]?.id, height: viewport.current.scrollHeight, top: viewport.current.scrollTop };
    follow.current = false;
    void loadActivity(agent.id, true);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={!wide}>
      <Dialog.Trigger asChild>
        <Button variant="outline" size="sm" aria-label="Agent activity" title="Agent activity" className="ml-auto size-11 border-0 p-0 sm:size-8">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-4"><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M15 3v18M18 8h1M18 12h1M18 16h1" strokeLinecap="round" /></svg>
        </Button>
      </Dialog.Trigger>
      {/* Kibo sheet/standard/sheet-standard-2; docked on desktop, modal on narrow screens. */}
      <Dialog.Portal>
        {!wide && <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />}
        <Dialog.Content
          className="fixed bottom-0 right-0 top-[calc(4rem+env(safe-area-inset-top))] z-50 flex w-full max-w-sm sm:top-14 flex-col border-l border-border bg-sidebar shadow-xl outline-none motion-safe:data-[state=open]:animate-[activity-in_180ms_ease-out] motion-safe:data-[state=closed]:animate-[activity-out_140ms_ease-in]"
          onInteractOutside={event => { if (wide) event.preventDefault(); }}
          onOpenAutoFocus={event => { if (wide) event.preventDefault(); }}
        >
          <header className="shrink-0 border-b border-border px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <Dialog.Title className="text-sm font-semibold">Agent activity</Dialog.Title>
              <Dialog.Close asChild><Button variant="outline" size="sm" aria-label="Close activity" className="size-11 border-0 p-0 sm:size-7"><span aria-hidden="true">×</span></Button></Dialog.Close>
            </div>
            <Dialog.Description className="mt-1 text-xs text-muted-foreground">{agent.name} · saved runtime history</Dialog.Description>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Operator view, not channel messages. New activity is saved; reasoning appears only when provided by the endpoint.</p>
            {requestError && <p role="alert" className="mt-2 text-xs text-destructive">Dashboard request (not saved): {requestError}</p>}
            <div className="mt-2 text-xs text-muted-foreground" title={contextUsage?.text}>
              <p className="text-[11px]">Main context · latest estimate</p>
              <p aria-label="Context usage" className="tabular-nums">{contextUsage?.text.split('\n')[0] ?? 'Waiting for a runtime update'}</p>
            </div>
          </header>
          <ScrollArea label="Agent activity history" viewportRef={viewport} className="min-h-0 flex-1" onScroll={event => {
            const element = event.currentTarget;
            follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
          }}>
            <div className="space-y-3 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4">
              {loading && <p role="status" className="text-xs text-muted-foreground">Loading activity…</p>}
              {failed && <div role="alert" className="text-xs text-muted-foreground">Could not load activity. <Button variant="outline" size="sm" disabled={loading} onClick={() => void retryActivity(agent.id)}>Retry activity</Button></div>}
              {history.cursor[agent.id] != null && <Button variant="outline" size="sm" disabled={loading} onClick={loadOlder}>Load older activity</Button>}
              {!loading && !failed && entries.length === 0 && <p className="py-6 text-xs leading-relaxed text-muted-foreground">New activity will appear here when this agent runs. Previously discarded traces cannot be recovered.</p>}
              {entries.map(entry => (
                <details key={entry.id} open={entry.kind !== 'system'} data-activity-kind={entry.kind} className="rounded-lg border border-border bg-background p-3">
                  <summary className="flex min-h-11 items-center text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring sm:min-h-0">
                    <span className="font-medium">{entry.label}</span>
                    <span className="ml-2 text-[10px] text-muted-foreground">{new Date(entry.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>
                  </summary>
                  <ActivityScreenshot agentId={agent.id} entry={entry} />
                  <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{entry.text || '…'}</pre>
                  {entry.nextOffset != null && <Button variant="outline" size="sm" className="mt-2" disabled={history.entryLoading[entry.id]} onClick={() => void expandActivity(agent.id, entry)}>{history.entryLoading[entry.id] ? 'Loading text…' : history.entryFailed[entry.id] ? 'Retry more text' : 'Load more text'}</Button>}
                  {history.entryFailed[entry.id] && <p role="alert" className="mt-1 text-xs text-muted-foreground">Could not load the next text section.</p>}
                  <p className="mt-2 truncate text-[10px] text-muted-foreground/70" title={`Channel ${entry.channelId} · Run ${entry.runId}`}>Channel {entry.channelId} · Run {entry.runId}</p>
                </details>
              ))}
            </div>
          </ScrollArea>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
