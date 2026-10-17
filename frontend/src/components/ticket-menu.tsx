import { useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ArchiveIcon, LinkIcon, MoreIcon, MoveIcon, OpenIcon, RestoreIcon, TrashIcon } from '@/components/ui/icons';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { TOAST_MS } from '@/components/message-toasts';
import { ticketPath } from '@/lib/dashboard-location';
import { useTouchHold } from '@/lib/use-touch-hold';
import { stateColor, useTicketActions, type BoardState, type TicketBoard } from '@/lib/tickets';
import { cn } from '@/lib/utils';

/** What a ticket's menus act on: a card, a list row or the open ticket. */
export type MenuTicket = { number: number; key: string; archived: unknown; state: { id: string } };
/** How long an archived card takes to leave the board (none with reduced motion). */
const LEAVE_MS = 180;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const errorText = (failure: unknown) => (failure instanceof Error ? failure.message : 'The change was not saved.');

/** The ticket's address with its organization (docs/tickets.md#copy-link). */
export const ticketLink = (organizationId: string, key: string) =>
  `${window.location.origin}${ticketPath(key)}?org=${encodeURIComponent(organizationId)}`;

/** A short notice at the top (the app's toaster), optionally with Undo: Kibo sonner-interactive-1's action. */
function notice(id: string, text: string, icon: ReactElement, undo?: () => void) {
  toast.custom(
    toastId => (
      <div className="flex w-full items-center gap-3 rounded-xl border border-border bg-background/95 p-3 text-sm shadow-xl backdrop-blur ao-top">
        <span className="text-muted-foreground">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{text}</span>
        {undo && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-9 md:min-h-7"
            onClick={() => {
              toast.dismiss(toastId);
              undo();
            }}
          >
            Undo
          </Button>
        )}
      </div>
    ),
    { id, duration: TOAST_MS },
  );
}

/**
 * A ticket's commands for its menus and the E key (docs/tickets.md#archive): copy its link, move it, archive or
 * restore it (a toast with Undo; from the board an archived card fades out first) and delete it after a confirmation.
 * `dialog` is the confirmation, rendered once by the tab.
 */
export function useTicketCommands({
  organizationId,
  q,
  showArchived,
  states,
  onNavigate,
  onDeleted,
}: {
  organizationId: string | undefined;
  q: string;
  /** Show archived is on: an archived card stays on the board (marked), so it does not leave. */
  showArchived: boolean;
  /** The organization's states, in board order. */
  states: BoardState[];
  onNavigate: (path: string) => void;
  onDeleted: (number: number) => void;
}) {
  const client = useQueryClient();
  const actions = useTicketActions(organizationId, q, showArchived);
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(new Set());
  const [deleting, setDeleting] = useState<MenuTicket | null>(null);
  const boardKey = ['tickets', organizationId, q, showArchived];
  const leave = (number: number, on: boolean) =>
    setLeaving(previous => {
      const next = new Set(previous);
      if (on) next.add(number);
      else next.delete(number);
      return next;
    });

  async function setArchived(
    ticket: MenuTicket,
    archived: boolean,
    options: { fromBoard?: boolean; undo?: boolean } = {},
  ) {
    const { fromBoard = false, undo = true } = options;
    const animate = fromBoard && archived && !showArchived;
    if (animate) {
      // Focus goes to the card beside it (keyboard users keep their place), unless it is elsewhere already.
      const card = document.querySelector<HTMLElement>(`[data-ticket-number="${ticket.number}"]`);
      const item = card?.closest('li');
      const beside = (item?.nextElementSibling ?? item?.previousElementSibling)?.querySelector<HTMLElement>(
        '[data-ticket-number]',
      );
      leave(ticket.number, true);
      if (!reducedMotion()) await new Promise(resolve => setTimeout(resolve, LEAVE_MS));
      await client.cancelQueries({ queryKey: boardKey });
      client.setQueryData<TicketBoard>(
        boardKey,
        data => data && { ...data, tickets: data.tickets.filter(item => item.number !== ticket.number) },
      );
      const focus = document.activeElement;
      if (beside && (!focus || focus === document.body || focus === card)) beside.focus();
    }
    try {
      await actions.update(ticket.number, { archived });
    } catch (failure) {
      void client.invalidateQueries({ queryKey: ['tickets', organizationId] });
      notice(
        `ticket-archive:${ticket.key}`,
        `${ticket.key} could not be ${archived ? 'archived' : 'restored'}: ${errorText(failure)}`,
        <ArchiveIcon />,
      );
      return;
    } finally {
      if (animate) leave(ticket.number, false);
    }
    const again = { ...ticket, archived };
    notice(
      `ticket-archive:${ticket.key}`,
      `${archived ? 'Archived' : 'Restored'} ${ticket.key}`,
      archived ? <ArchiveIcon /> : <RestoreIcon />,
      undo ? () => void setArchived(again, !archived, { undo: false }) : undefined,
    );
  }

  const commands = {
    states,
    leaving,
    open: (ticket: MenuTicket) => onNavigate(ticketPath(ticket.key)),
    copyLink: async (ticket: MenuTicket) => {
      try {
        await navigator.clipboard.writeText(ticketLink(organizationId ?? '', ticket.key));
        notice(`ticket-link:${ticket.key}`, `Copied the link to ${ticket.key}`, <LinkIcon />);
      } catch {
        notice(`ticket-link:${ticket.key}`, 'The link could not be copied', <LinkIcon />);
      }
    },
    move: async (ticket: MenuTicket, state: BoardState) => {
      if (ticket.state.id === state.id) return;
      const { id, name, color, category } = state;
      try {
        await actions.move(ticket.number, { id, name, color, category });
      } catch (failure) {
        notice(`ticket-move:${ticket.key}`, `${ticket.key} could not be moved: ${errorText(failure)}`, <MoveIcon />);
      }
    },
    setArchived,
    askDelete: (ticket: MenuTicket) => setDeleting(ticket),
  };
  const dialog = (
    <ConfirmDialog
      open={Boolean(deleting)}
      onOpenChange={open => !open && setDeleting(null)}
      title={`Delete ${deleting?.key ?? 'the ticket'}?`}
      description="Its comments and activity go with it; its sub-issues stay, without a parent. To keep it out of the way, archive it instead."
      confirmLabel="Delete"
      busyLabel="Deleting…"
      onConfirm={async () => {
        if (!deleting) return;
        await actions.remove(deleting.number);
        onDeleted(deleting.number);
      }}
    />
  );
  return { commands, dialog };
}
export type TicketCommands = ReturnType<typeof useTicketCommands>['commands'];

const menuContent =
  'context-menu-content phone-menu-targets z-50 min-w-52 rounded-lg border border-border bg-background p-1 text-sm ao-top shadow-lg';
const menuItem =
  'flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-3 py-2 outline-none data-[highlighted]:bg-muted data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 md:min-h-0';
const Shortcut = ({ children }: { children: string }) => (
  <kbd className="ml-auto pl-4 font-mono text-xs text-muted-foreground">{children}</kbd>
);

/** The ticket's actions shared by its context menu and the detail's More menu: Archive / Restore and Delete…. */
function ArchiveAndDelete({
  Item,
  Separator,
  ticket,
  commands,
  fromBoard,
}: {
  Item: typeof ContextMenu.Item;
  Separator: typeof ContextMenu.Separator;
  ticket: MenuTicket;
  commands: TicketCommands;
  fromBoard: boolean;
}) {
  return (
    <>
      <Item className={menuItem} onSelect={() => void commands.setArchived(ticket, !ticket.archived, { fromBoard })}>
        {ticket.archived ? (
          <RestoreIcon className="text-muted-foreground" />
        ) : (
          <ArchiveIcon className="text-muted-foreground" />
        )}
        {ticket.archived ? 'Restore' : 'Archive'}
        <Shortcut>E</Shortcut>
      </Item>
      <Separator className="my-1 h-px bg-border" />
      <Item className={cn(menuItem, 'text-red-400')} onSelect={() => commands.askDelete(ticket)}>
        <TrashIcon />
        Delete…
      </Item>
    </>
  );
}

/**
 * Right-click on a card or a list row (Kibo context-menu-standard-7, its submenu for Move to): Open, Copy link, Move to
 * (the organization's states, the current one marked), Archive / Restore and Delete…; the context-menu key or
 * Shift+F10 opens it from the keyboard. With `touch` off (cards, whose press-and-hold picks them up) a touch or pen
 * never opens it; with it on (list rows) a long press does, as in the chat list.
 */
export function TicketContextMenu({
  ticket,
  commands,
  touch,
  children,
}: {
  ticket: MenuTicket;
  commands: TicketCommands;
  touch: boolean;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const pointer = useRef('mouse');
  const touchHold = useTouchHold();
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    pointer.current = 'keyboard';
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: bounds.left + 16,
        clientY: bounds.top + 16,
      }),
    );
  };
  return (
    <ContextMenu.Root open={open} onOpenChange={next => setOpen(next && (touch || pointer.current !== 'touch'))}>
      <ContextMenu.Trigger
        asChild
        {...(touch ? touchHold : {})}
        onPointerDownCapture={event => (pointer.current = event.pointerType === 'mouse' ? 'mouse' : 'touch')}
        onKeyDown={onKeyDown}
      >
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuContent} aria-label={`Actions for ${ticket.key}`} collisionPadding={8}>
          <ContextMenu.Item className={menuItem} onSelect={() => commands.open(ticket)}>
            <OpenIcon className="text-muted-foreground" />
            Open
          </ContextMenu.Item>
          <ContextMenu.Item className={menuItem} onSelect={() => void commands.copyLink(ticket)}>
            <LinkIcon className="text-muted-foreground" />
            Copy link
          </ContextMenu.Item>
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={cn(menuItem, 'data-[state=open]:bg-muted')}>
              <MoveIcon className="text-muted-foreground" />
              Move to
              <span aria-hidden="true" className="ml-auto pl-4 text-muted-foreground">
                ›
              </span>
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent
                sideOffset={4}
                collisionPadding={8}
                className={cn(
                  menuContent,
                  'z-[60] min-w-44 max-h-[min(24rem,var(--radix-context-menu-content-available-height))] overflow-y-auto',
                )}
              >
                <ContextMenu.RadioGroup
                  value={ticket.state.id}
                  onValueChange={id => {
                    const state = commands.states.find(item => item.id === id);
                    if (state) void commands.move(ticket, state);
                  }}
                >
                  {commands.states.map(state => (
                    <ContextMenu.RadioItem key={state.id} value={state.id} className={cn(menuItem, 'relative pl-7')}>
                      <ContextMenu.ItemIndicator className="absolute left-2.5 size-1.5 rounded-full bg-foreground" />
                      <span
                        aria-hidden="true"
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: stateColor(state.color) }}
                      />
                      {state.name}
                    </ContextMenu.RadioItem>
                  ))}
                </ContextMenu.RadioGroup>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>
          <ContextMenu.Separator className="my-1 h-px bg-border" />
          <ArchiveAndDelete
            Item={ContextMenu.Item}
            Separator={ContextMenu.Separator}
            ticket={ticket}
            commands={commands}
            fromBoard
          />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** The open ticket's More (⋯) menu in its header, as the chat's More menu: Copy link, Archive / Restore, Delete…. */
export function TicketMoreMenu({ ticket, commands }: { ticket: MenuTicket; commands: TicketCommands }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`More for ${ticket.key}`}
          title="More"
          className="size-9 shrink-0 p-0"
        >
          <MoreIcon />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={5}
          collisionPadding={12}
          aria-label={`More for ${ticket.key}`}
          className="z-50 min-w-52 rounded-lg border border-border bg-background p-1 text-sm ao-top shadow-lg motion-safe:data-[state=open]:animate-[dialog-in_200ms_cubic-bezier(0.22,1,0.36,1)] motion-safe:data-[state=closed]:animate-[dialog-out_130ms_ease-in]"
        >
          <DropdownMenu.Item className={menuItem} onSelect={() => void commands.copyLink(ticket)}>
            <LinkIcon className="text-muted-foreground" />
            Copy link
          </DropdownMenu.Item>
          <ArchiveAndDelete
            Item={DropdownMenu.Item}
            Separator={DropdownMenu.Separator}
            ticket={ticket}
            commands={commands}
            fromBoard={false}
          />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
