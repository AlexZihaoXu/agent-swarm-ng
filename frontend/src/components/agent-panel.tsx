import { useRef, useState, type ReactNode } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as Dialog from '@radix-ui/react-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CreateAgentForm } from '@/components/create-agent-form';
import { DeleteAgentForm } from '@/components/delete-agent-form';
import { EditAgentForm } from '@/components/edit-agent-form';
import type { AvatarAppearance } from '@/lib/agent-avatar';
import type { ChatAgent, RealAgent } from '@/use-chat';

// Compositions: Kibo context-menu/standard/context-menu-standard-1 and dialog/standard/dialog-standard-1.
export function AgentPanel({ children, className, agents, onCreated, onDelete, onEditAvatar }: { children: ReactNode; className: string; agents: ChatAgent[]; onCreated: (agent: RealAgent) => void; onDelete: (agent: ChatAgent, confirmation: string) => Promise<void>; onEditAvatar: (agent: ChatAgent, avatar: AvatarAppearance, allowedDmAgentIds: string[]) => Promise<void> }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [contextAgent, setContextAgent] = useState<ChatAgent | null>(null);
  const [deletingAgent, setDeletingAgent] = useState<ChatAgent | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editingAgent, setEditingAgent] = useState<ChatAgent | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  return (
    <Dialog.Root open={dialogOpen} onOpenChange={open => { if (!deleting) setDialogOpen(open); }}>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <aside
            ref={panelRef}
            aria-label="Agents"
            tabIndex={0}
            className={`${className} outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
            onContextMenuCapture={event => {
              const card = (event.target as HTMLElement).closest<HTMLElement>('[data-agent-id]');
              setContextAgent(agents.find(agent => agent.id === card?.dataset.agentId) ?? null);
              returnFocus.current = card ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
            }}
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
            <ContextMenu.Item onSelect={() => { setDeletingAgent(null); setEditingAgent(null); setDialogOpen(true); }} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-muted">
              <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center text-lg leading-none text-muted-foreground">+</span>
              Create new agent
            </ContextMenu.Item>
            {contextAgent && <ContextMenu.Item onSelect={() => { setDeletingAgent(null); setEditingAgent(contextAgent); setDialogOpen(true); }} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-muted">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-4"><path d="m15 5 4 4M5 15 16 4a2.8 2.8 0 0 1 4 4L9 19l-5 1z" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Edit agent
            </ContextMenu.Item>}
            {contextAgent && <ContextMenu.Item onSelect={() => { setEditingAgent(null); setDeletingAgent(contextAgent); setDialogOpen(true); }} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-red-400 outline-none data-[highlighted]:bg-muted">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6" /></svg>
              Delete agent
            </ContextMenu.Item>}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 motion-safe:data-[state=open]:animate-[fade-in_160ms_ease-out] motion-safe:data-[state=closed]:animate-[fade-out_120ms_ease-in]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-h-[90dvh] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-background p-2 shadow-xl motion-safe:data-[state=open]:animate-[dialog-in_160ms_ease-out] motion-safe:data-[state=closed]:animate-[dialog-out_120ms_ease-in]"
          onCloseAutoFocus={event => {
            event.preventDefault();
            const target = returnFocus.current;
            if (target && target !== document.body && target.isConnected) target.focus();
            else panelRef.current?.focus();
          }}
        >
          {editingAgent ? <EditAgentForm key={editingAgent.id} agent={editingAgent} onSave={onEditAvatar} onDone={() => setDialogOpen(false)} onBusyChange={setDeleting} /> : <ScrollArea label="Agent editor" viewportTabIndex={-1} viewportClassName="max-h-[calc(90dvh-1rem)] [&>div]:!block"><div className="p-4">
          {deletingAgent
            ? <DeleteAgentForm key={deletingAgent.id} agent={deletingAgent} onDelete={onDelete} onBusyChange={setDeleting} onDone={() => setDialogOpen(false)} />
            : <CreateAgentForm onCreated={agent => { onCreated(agent); setDialogOpen(false); }} /> }
          </div></ScrollArea>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
