import { useState, type ComponentProps } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CreateAgentForm } from '@/components/create-agent-form';
import { DeleteAgentForm } from '@/components/delete-agent-form';
import { EditAgentForm } from '@/components/edit-agent-form';
import { AgentAvatar } from '@/components/chat-identity';
import { XIcon } from '@/components/ui/icons';
import { useRetained } from '@/lib/use-retained';
import { dialogOverlay } from '@/lib/styles';
import { isAgentSettings, type DashboardRoute } from '@/lib/dashboard-location';
import type { ChatAgent, RealAgent } from '@/use-chat';

type Editor = Omit<ComponentProps<typeof EditAgentForm>, 'agent' | 'route' | 'sectionSlot'>;

/**
 * An agent's settings, as a modal over its chat (`/agents/:id`, opened from the chat list's menu, Portal or any
 * link): the section jump links on the left on wide screens, full screen on phones. Closing (✕, Escape, the backdrop)
 * goes through `onClose`, which asks first when something is unsaved.
 */
export function AgentSettingsDialog({
  agent,
  route,
  onClose,
  wide,
  editor,
}: {
  agent?: ChatAgent;
  route: DashboardRoute;
  onClose: () => void;
  /** Wide screens list the sections beside the settings. */
  wide: boolean;
  editor: Editor;
}) {
  const open = Boolean(agent) && isAgentSettings(route);
  // While it animates closed, it keeps showing the agent it showed.
  const shown = useRetained(agent, open);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={next => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background outline-none md:inset-auto md:left-1/2 md:top-1/2 md:h-[min(52rem,88dvh)] md:w-[min(68rem,calc(100vw-3rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:border md:border-border md:ao-card md:shadow-xl motion-safe:data-[state=open]:animate-[dialog-in_200ms_cubic-bezier(0.22,1,0.36,1)] motion-safe:data-[state=closed]:animate-[dialog-out_130ms_ease-in]"
        >
          {shown && (
            <>
              <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:px-5 md:pt-3">
                <AgentAvatar
                  initials={shown.initials}
                  avatar={shown.avatar}
                  ready={Boolean(shown.real)}
                  typing={false}
                  working={false}
                />
                <div className="min-w-0 flex-1">
                  <Dialog.Title className="truncate text-base font-semibold">{shown.name}</Dialog.Title>
                  <p className="text-xs text-muted-foreground">Agent settings</p>
                </div>
                <Dialog.Close
                  aria-label="Close agent settings"
                  title="Close"
                  className="flex size-11 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:size-9"
                >
                  <XIcon />
                </Dialog.Close>
              </header>
              <div className="flex min-h-0 flex-1">
                {/* Wide screens: the jump links, which the editor fills in. */}
                <div
                  ref={setSlot}
                  className="hidden w-56 shrink-0 overflow-y-auto border-r border-border bg-sidebar p-3 md:block"
                />
                <EditAgentForm
                  key={shown.id}
                  agent={shown}
                  route={route}
                  sectionSlot={wide ? slot : null}
                  {...editor}
                />
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Creating an agent (`/agents/new`) and deleting one (`/agents/:id/delete`), each a small dialog over the chat. */
export function AgentFormDialogs({
  agents,
  route,
  onClose,
  onCreated,
  onDelete,
  onDeleted,
}: {
  agents: ChatAgent[];
  route: DashboardRoute;
  onClose: () => void;
  onCreated: (agent: RealAgent) => void;
  onDelete: (agent: ChatAgent, confirmation: string) => Promise<void>;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const deletingAgent = route.kind === 'agent-delete' ? agents.find(item => item.id === route.agentId) : undefined;
  const open = route.kind === 'agent-new' || Boolean(deletingAgent);
  const shownDelete = useRetained(deletingAgent, open);
  return (
    <Dialog.Root open={open} onOpenChange={next => !next && !deleting && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          // Where focus goes next is the chat list's (back to the row it was opened from, or the list).
          onCloseAutoFocus={event => event.preventDefault()}
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-h-[90dvh] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-background ao-card p-2 shadow-xl motion-safe:data-[state=open]:animate-[dialog-in_200ms_cubic-bezier(0.22,1,0.36,1)] motion-safe:data-[state=closed]:animate-[dialog-out_130ms_ease-in]"
        >
          <ScrollArea label="Agent editor" viewportTabIndex={-1} viewportClassName="max-h-[calc(90dvh-1rem)]">
            <div className="p-4">
              {shownDelete ? (
                <DeleteAgentForm
                  key={shownDelete.id}
                  agent={shownDelete}
                  onDelete={onDelete}
                  onBusyChange={setDeleting}
                  onDone={onDeleted}
                />
              ) : (
                <CreateAgentForm onCreated={onCreated} />
              )}
            </div>
          </ScrollArea>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
