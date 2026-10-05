import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { fileViewUrl } from '@/lib/chat-files';
import { dialogMotion, dialogOverlay } from '@/lib/styles';
import { cn } from '@/lib/utils';

/**
 * An HTML chat file rendered in a sandboxed frame. The page is untrusted: `sandbox="allow-scripts"` (never
 * allow-same-origin) gives it an opaque origin, so it cannot read the dashboard, its cookies or its API, and the view
 * route's own CSP refuses its fetches and every resource from outside the page. It cannot navigate the dashboard or
 * open windows; if it navigates itself (which no browser rule prevents), the frame is closed at once. `revision`
 * reloads a live scratch page after its agent edits it.
 */
export function HtmlViewer({ id, name, revision = 0 }: { id: string; name: string; revision?: number }) {
  const [open, setOpen] = useState(false);
  const [leftPage, setLeftPage] = useState(false);
  const loads = useRef(0);
  // A fresh frame (opening, or a live page's new revision) starts counting again.
  useEffect(() => {
    loads.current = 0;
    setLeftPage(false);
  }, [open, revision]);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={`View ${name}`}
          title="View the page (sandboxed)"
          className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[11px] text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring max-sm:min-h-11 max-sm:px-2.5"
        >
          View
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          className={cn(
            'fixed inset-0 z-50 flex flex-col overflow-hidden bg-background pb-[env(safe-area-inset-bottom)] outline-none sm:inset-auto sm:pb-0 sm:top-1/2 sm:left-1/2 sm:h-[min(90dvh,60rem)] sm:w-[calc(100%-2rem)] sm:max-w-6xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border sm:border-border sm:shadow-xl ao-card',
            dialogMotion,
          )}
        >
          <header className="flex shrink-0 items-center gap-3 border-b border-border pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-2 pl-[max(1rem,env(safe-area-inset-left))] sm:px-5 sm:py-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-sm font-semibold" title={name}>
                {name}
              </Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground">
                An agent’s page, sandboxed: it cannot reach the dashboard or load anything from the network.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button
                variant="flat"
                size="sm"
                className="size-11 shrink-0 p-0 sm:size-10"
                aria-label="Close page viewer"
              >
                ×
              </Button>
            </Dialog.Close>
          </header>
          {leftPage ? (
            <div
              role="status"
              className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground"
            >
              This page tried to open another address, so it was closed. Reopen it to view it again.
            </div>
          ) : (
            <iframe
              key={revision}
              // The page may navigate itself (no browser rule stops that): the first load is the page, any later one is
              // it leaving, which is stopped here so it can never show something else inside this dialog.
              onLoad={() => {
                loads.current++;
                if (loads.current > 1) setLeftPage(true);
              }}
              src={fileViewUrl(id)}
              title={name}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              className="min-h-0 w-full flex-1 border-0 bg-white"
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
