import { useRef, useState, type ReactNode } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';

// Compositions: Kibo context-menu/standard/context-menu-standard-1 and dialog/standard/dialog-standard-1.
export function AgentPanel({ children, className }: { children: ReactNode; className: string }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  return (
    <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
      <ContextMenu.Root onOpenChange={open => {
        if (open) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }}>
        <ContextMenu.Trigger asChild>
          <aside
            ref={panelRef}
            aria-label="Agents"
            tabIndex={0}
            className={`${className} outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
            onKeyDown={event => {
              if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
              event.preventDefault();
              const target = event.target as HTMLElement;
              const bounds = target.getBoundingClientRect();
              target.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true, cancelable: true, button: 2,
                clientX: bounds.left + 16, clientY: bounds.top + 16,
              }));
            }}
          >
            {children}
          </aside>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            className="z-50 min-w-48 rounded-lg border border-border bg-background p-1 shadow-lg"
            onCloseAutoFocus={event => { if (dialogOpen) event.preventDefault(); }}
          >
            <ContextMenu.Item onSelect={() => setDialogOpen(true)} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-muted">
              <span aria-hidden="true" className="text-lg leading-none text-muted-foreground">+</span>
              Create new agent
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 motion-safe:data-[state=open]:animate-[fade-in_160ms_ease-out] motion-safe:data-[state=closed]:animate-[fade-out_120ms_ease-in]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background p-6 shadow-xl motion-safe:data-[state=open]:animate-[dialog-in_160ms_ease-out] motion-safe:data-[state=closed]:animate-[dialog-out_120ms_ease-in]"
          onCloseAutoFocus={event => {
            event.preventDefault();
            const target = returnFocus.current;
            if (target && target !== document.body && target.isConnected) target.focus();
            else panelRef.current?.focus();
          }}
        >
          <Dialog.Title className="text-lg font-semibold">Create new agent</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Agent creation will be available here. Nothing is created in this preview.
          </Dialog.Description>
          <div className="mt-6 flex justify-end">
            <Dialog.Close asChild><Button variant="outline" size="sm">Close</Button></Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
