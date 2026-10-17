import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { PlusIcon, TicketsIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/page-header';
import { TicketDetailView } from '@/components/ticket-detail';
import { Board, BoardMarks, isWorking, Labels, StateDot, Working } from '@/components/ticket-board';
import { AssigneeAvatar } from '@/components/ticket-assignee';
import { NewTicketDialog, type NewTicketStart } from '@/components/new-ticket-dialog';
import { ShortcutsHelp, TicketToolbar } from '@/components/ticket-filters';
import { takeNewTicketDraft } from '@/components/ticket-refs';
import { useSignedIn } from '@/lib/auth';
import { ticketNumber, ticketPath, type DashboardRoute } from '@/lib/dashboard-location';
import type { Organization } from '@/lib/organizations';
import {
  applyFilters,
  filterSearch,
  parseFilters,
  priorityOf,
  sortTickets,
  todayIn,
  updatedLabel,
  useTicketActions,
  useTicketBoard,
  type BoardState,
  type TicketFilters,
  type TicketSummary,
} from '@/lib/tickets';
import type { ChatAgent } from '@/use-chat';
import { cn } from '@/lib/utils';

const VIEWS = [
  { value: 'board', label: 'Board' },
  { value: 'list', label: 'List' },
] as const;
const entering = 'motion-safe:animate-[view-in_260ms_cubic-bezier(0.22,1,0.36,1)]';
/** The board's address with its filters, so going back from a ticket keeps them. */
let lastBoard = { path: '/tickets', search: '' };
/** Keys typed into a field or a computer (a desktop's frame, a terminal) are never the tab's shortcuts. */
const TYPING = 'input, textarea, select, [contenteditable], [data-keys-to-computer], [data-terminal-emulator], iframe';

/**
 * The Tickets tab (docs/tickets.md): the board of the organization in view, as columns per workflow state (Kibo
 * kanban's board/card composition, cards dragged between columns and places) or a list grouped by state in the
 * same order (Kibo list's groups), search and filters kept in the address, a ticket's detail, the New ticket dialog
 * (also opened from a chat message's menu) and the tab's keys: C new ticket, / search, Esc close or clear, ? help.
 * Shown only while the organization has tickets on.
 */
export function TicketsPanel({
  route,
  organization,
  agents,
  working,
  onNavigate,
}: {
  route: DashboardRoute;
  /** The organization in view, when there is exactly one. */
  organization?: Organization;
  /** The organization's agents (assignees). */
  agents: ChatAgent[];
  /** Agents running a turn now: their tickets in progress show "working". */
  working: Set<string>;
  onNavigate: (path: string) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const filters = parseFilters(location.search);
  const enabled = Boolean(organization?.tickets?.enabled);
  const board = useTicketBoard(enabled ? organization?.id : undefined, filters.q, filters.archived);
  const actions = useTicketActions(enabled ? organization?.id : undefined, filters.q, filters.archived);
  const { name: me, timeZone } = useSignedIn();
  const [creating, setCreating] = useState<NewTicketStart | null>(null);
  const [help, setHelp] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearch = useRef(false);
  const number = route.kind === 'ticket' ? ticketNumber(route.ticketKey) : null;
  const view = route.kind === 'tickets-list' ? 'list' : 'board';
  if (!number) lastBoard = { path: location.pathname, search: location.search };
  const backPath = `${lastBoard.path}${lastBoard.search}`;
  const setFilters = (next: TicketFilters) =>
    navigate({ pathname: location.pathname, search: filterSearch(next, location.search) }, { replace: true });
  // "Create ticket from message…" (a chat message's menu): the dialog opens with it once its organization shows.
  useEffect(() => {
    const draft = enabled && organization ? takeNewTicketDraft(organization.id) : null;
    if (draft) setCreating({ message: { id: draft.messageId, text: draft.text } });
  }, [enabled, organization?.id, location.key]);
  useEffect(() => {
    if (!number && focusSearch.current) {
      focusSearch.current = false;
      searchRef.current?.focus();
    }
  }, [number]);
  // The tab's keys: never while typing, in a computer, or with a dialog or menu open (those take Escape themselves).
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(TYPING) || document.activeElement?.tagName === 'IFRAME') return;
      if (
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper]',
        )
      )
        return;
      const key = event.key;
      if (key === 'c' || key === 'C') {
        event.preventDefault();
        setCreating({});
      } else if (key === '/') {
        event.preventDefault();
        if (number) {
          focusSearch.current = true;
          onNavigate(backPath);
        } else searchRef.current?.focus();
      } else if (key === '?') {
        event.preventDefault();
        setHelp(true);
      } else if (key === 'Escape') {
        if (number) onNavigate(backPath);
        else if (filters.q) setFilters({ ...filters, q: '' });
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });
  if (!organization || !enabled)
    return (
      <section aria-label="Tickets" className="flex min-h-0 flex-1 flex-col items-center justify-center p-6">
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <TicketsIcon />
            </EmptyMedia>
            <EmptyTitle>{organization ? 'Tickets are off' : 'Choose an organization'}</EmptyTitle>
            <EmptyDescription>
              {organization
                ? `Turn on tickets for ${organization.name} in Organization → Tickets to give its people and agents a shared board.`
                : 'Tickets belong to one organization: choose it with the switcher at the top left.'}
            </EmptyDescription>
          </EmptyHeader>
          {organization && (
            <EmptyContent>
              <Button type="button" size="sm" onClick={() => onNavigate('/organization#tickets')}>
                Open organization settings
              </Button>
            </EmptyContent>
          )}
        </Empty>
      </section>
    );
  const ownerName = organization.ownerName ?? me;
  const today = todayIn(timeZone);
  const all = board.data?.tickets ?? [];
  const states = board.data?.states ?? [];
  const tickets = applyFilters(all, filters, today);
  const open = (ticket: TicketSummary) => onNavigate(ticketPath(ticket.key));
  const dialogs = (
    <>
      <NewTicketDialog
        open={Boolean(creating)}
        onOpenChange={next => !next && setCreating(null)}
        start={creating ?? undefined}
        organization={organization}
        agents={agents}
        ownerName={ownerName}
        onCreated={ticket => onNavigate(ticketPath(ticket.key))}
      />
      <ShortcutsHelp open={help} onOpenChange={setHelp} />
    </>
  );
  if (number)
    return (
      <>
        <TicketDetailView
          organization={organization}
          number={number}
          agents={agents}
          working={working}
          ownerName={ownerName}
          backPath={backPath}
          onNavigate={onNavigate}
          onAddSubIssue={parent => setCreating({ parent })}
        />
        {dialogs}
      </>
    );
  const searching = Boolean(filters.q) || tickets.length !== all.length;
  return (
    <section aria-label="Tickets" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PageHeader
        title="Tickets"
        description={`${organization.name} · ${board.data?.settings.prefix ?? organization.tickets.prefix}`}
        width="max-w-none"
        action={
          <Button
            type="button"
            size="sm"
            className="min-h-11 gap-1.5 md:min-h-0"
            title="New ticket (C)"
            onClick={() => setCreating({})}
          >
            <PlusIcon />
            New ticket
          </Button>
        }
      />
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 md:px-6">
        <ChoiceChips
          label="View"
          value={view}
          options={VIEWS}
          onChange={next =>
            onNavigate(`${next === 'list' ? '/tickets/list' : ticketPath()}${filterSearch(filters, location.search)}`)
          }
        />
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-border max-sm:hidden" />
        <TicketToolbar
          filters={filters}
          onChange={setFilters}
          view={view}
          tickets={all}
          states={states}
          agents={agents}
          searchRef={searchRef}
          onHelp={() => setHelp(true)}
        />
      </div>
      {searching && (
        <p role="status" className="shrink-0 px-4 pt-2 text-xs text-muted-foreground md:px-6">
          {tickets.length} {tickets.length === 1 ? 'ticket matches' : 'tickets match'}
        </p>
      )}
      {board.isError && !board.data && (
        <p role="alert" className="px-4 py-3 text-sm text-red-400 md:px-6">
          {board.error.message}{' '}
          <button type="button" className="cursor-pointer underline" onClick={() => void board.refetch()}>
            Retry
          </button>
        </p>
      )}
      {board.isPending ? (
        <p role="status" className="p-6 text-sm text-muted-foreground">
          Loading tickets…
        </p>
      ) : view === 'board' ? (
        <Board
          key="board"
          // Canceled states are not columns unless the status filter asks for them.
          states={states.filter(state => state.category !== 'canceled' || filters.status.includes(state.id))}
          tickets={tickets}
          agents={agents}
          working={working}
          today={today}
          onOpen={open}
          onMove={(ticket, state, place) => actions.move(ticket.number, state, place)}
        />
      ) : (
        <List
          key="list"
          states={states}
          tickets={sortTickets(tickets, filters.sort)}
          agents={agents}
          working={working}
          today={today}
          onOpen={open}
        />
      )}
      {dialogs}
    </section>
  );
}

/** Kibo list: groups per state in board order (canceled ones when they have tickets), one row per ticket. */
function List({
  states,
  tickets,
  agents,
  working,
  today,
  onOpen,
}: {
  states: BoardState[];
  tickets: TicketSummary[];
  agents: ChatAgent[];
  working: Set<string>;
  today: string;
  onOpen: (ticket: TicketSummary) => void;
}) {
  return (
    <ScrollArea label="Ticket list" className="min-h-0 flex-1">
      <div className={cn('space-y-3 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 md:px-6 md:pb-6', entering)}>
        {states
          .filter(state => state.category !== 'canceled' || tickets.some(item => item.state.id === state.id))
          .map(state => {
            const rows = tickets.filter(ticket => ticket.state.id === state.id);
            return (
              <section
                key={state.id}
                aria-label={state.name}
                className="overflow-hidden rounded-lg border border-border bg-sidebar/30 ao-card"
              >
                <h3 className="flex items-center gap-2 bg-foreground/5 px-3 py-2 text-sm font-semibold">
                  <StateDot color={state.color} />
                  {state.name}
                  <span className="text-xs font-normal text-muted-foreground">{rows.length}</span>
                </h3>
                <ul className="divide-y divide-border">
                  {rows.map(ticket => (
                    <li key={ticket.id}>
                      <button
                        type="button"
                        onClick={() => onOpen(ticket)}
                        className="grid w-full cursor-pointer grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-left text-sm outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 md:grid-cols-[5rem_minmax(0,1fr)_auto_5.5rem_1.5rem_5.5rem]"
                      >
                        <span className="font-mono text-xs text-muted-foreground">{ticket.key}</span>
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate">{ticket.title}</span>
                          {isWorking(ticket, working) && <Working />}
                          <BoardMarks ticket={ticket} today={today} />
                        </span>
                        <span className="flex gap-1 max-md:hidden">
                          <Labels labels={ticket.labels} />
                        </span>
                        <span className={cn('text-xs max-md:hidden', priorityOf(ticket.priority).tone)}>
                          {ticket.priority === 'none' ? '' : priorityOf(ticket.priority).label}
                        </span>
                        <span className="flex justify-end">
                          <AssigneeAvatar assignee={ticket.assignee} agents={agents} />
                          <span className="sr-only">
                            {ticket.assignee ? `Assigned to ${ticket.assignee.name}` : 'Unassigned'}
                          </span>
                        </span>
                        <span className="text-right text-xs text-muted-foreground max-md:hidden">
                          {updatedLabel(ticket.updatedAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                  {!rows.length && <li className="px-3 py-2.5 text-xs text-muted-foreground">Nothing here.</li>}
                </ul>
              </section>
            );
          })}
      </div>
    </ScrollArea>
  );
}
