import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ActivityEntry, ChatAgent } from '@/use-chat';

export function AgentActivityPanel({ agent, entries, open, onOpenChange }: {
  agent: ChatAgent; entries: ActivityEntry[]; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const update = () => setWide(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useLayoutEffect(() => { follow.current = true; }, [agent.id, open]);
  useLayoutEffect(() => {
    if (follow.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [entries, open, agent.id]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={!wide}>
      <Dialog.Trigger asChild>
        <Button variant="outline" size="sm" aria-label="Agent activity" title="Agent activity" className="ml-auto size-8 border-0 p-0">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-4"><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M15 3v18M18 8h1M18 12h1M18 16h1" strokeLinecap="round" /></svg>
        </Button>
      </Dialog.Trigger>
      {/* Kibo sheet/standard/sheet-standard-2; docked on desktop, modal on narrow screens. */}
      <Dialog.Portal>
        {!wide && <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />}
        <Dialog.Content
          className="fixed bottom-0 right-0 top-14 z-50 flex w-full max-w-sm flex-col border-l border-border bg-sidebar shadow-xl outline-none motion-safe:data-[state=open]:animate-[activity-in_180ms_ease-out] motion-safe:data-[state=closed]:animate-[activity-out_140ms_ease-in]"
          onInteractOutside={event => { if (wide) event.preventDefault(); }}
          onOpenAutoFocus={event => { if (wide) event.preventDefault(); }}
        >
          <header className="shrink-0 border-b border-border px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <Dialog.Title className="text-sm font-semibold">Agent activity</Dialog.Title>
              <Dialog.Close asChild><Button variant="outline" size="sm" aria-label="Close activity" className="size-7 border-0 p-0"><span aria-hidden="true">×</span></Button></Dialog.Close>
            </div>
            <Dialog.Description className="mt-1 text-xs text-muted-foreground">{agent.name} · live runtime history</Dialog.Description>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Operator view, not channel messages. Memory only; reasoning appears only when provided by the endpoint.</p>
          </header>
          <ScrollArea label="Agent activity history" viewportRef={viewport} className="min-h-0 flex-1" onScroll={event => {
            const element = event.currentTarget;
            follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
          }}>
            <div className="space-y-3 p-4">
              {entries.length === 0 && <p className="py-6 text-xs leading-relaxed text-muted-foreground">{agent.real ? 'New activity will appear here when this agent runs. Previously discarded traces cannot be recovered.' : 'Demo agents have no runtime activity.'}</p>}
              {entries.map(entry => (
                <details key={entry.id} open={entry.kind !== 'system'} data-activity-kind={entry.kind} className="rounded-lg border border-border bg-background p-3">
                  <summary className="text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring">
                    <span className="font-medium">{entry.label}</span>
                    <span className="ml-2 text-[10px] text-muted-foreground">{new Date(entry.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{entry.text || '…'}</pre>
                  <p className="mt-2 truncate text-[10px] text-muted-foreground/70" title={entry.channelId}>Channel {entry.channelId}</p>
                </details>
              ))}
            </div>
          </ScrollArea>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
