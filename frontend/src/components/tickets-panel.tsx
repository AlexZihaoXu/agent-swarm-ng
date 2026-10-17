import { useId, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { PlusIcon, TicketsIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/page-header';
import { TicketDetailView } from '@/components/ticket-detail';
import { AssigneeAvatar, assigneeOptions } from '@/components/ticket-assignee';
import { useSignedIn } from '@/lib/auth';
import { ticketNumber, ticketPath, type DashboardRoute } from '@/lib/dashboard-location';
import type { Organization } from '@/lib/organizations';
import { dialogMotion, dialogOverlay, settingsInput } from '@/lib/styles';
import {
  BOARD_STATUSES,
  PRIORITIES,
  STATUSES,
  priorityOf,
  updatedLabel,
  useTicketActions,
  useTicketBoard,
  type TicketPriority,
  type TicketSummary,
} from '@/lib/tickets';
import type { ChatAgent } from '@/use-chat';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'agents' | 'mine';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'agents', label: 'Assigned to agents' },
  { value: 'mine', label: 'Assigned to me' },
];
const VIEWS = [
  { value: 'board', label: 'Board' },
  { value: 'list', label: 'List' },
] as const;
const entering = 'motion-safe:animate-[view-in_260ms_cubic-bezier(0.22,1,0.36,1)]';

/**
 * The Tickets tab (docs/tickets.md): the board of the organization in view, as columns per status (Kibo
 * kanban's board/card composition) or a list grouped by status (Kibo list's groups), filters, a ticket's detail and
 * the New ticket dialog. Statuses change in the detail (no drag and drop, so no extra dependency and it works the
 * same with a finger, a mouse or the keyboard). Shown only while the organization has tickets on.
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
  const enabled = Boolean(organization?.tickets?.enabled);
  const board = useTicketBoard(enabled ? organization?.id : undefined);
  const { name: me } = useSignedIn();
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
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
                ? `Turn on tickets for ${organization.name} in Settings → Tickets to give its people and agents a shared board.`
                : 'Tickets belong to one organization: choose it with the switcher at the top left.'}
            </EmptyDescription>
          </EmptyHeader>
          {organization && (
            <EmptyContent>
              <Button type="button" size="sm" onClick={() => onNavigate('/settings#tickets')}>
                Open Settings
              </Button>
            </EmptyContent>
          )}
        </Empty>
      </section>
    );
  const ownerName = organization.ownerName ?? me;
  const number = route.kind === 'ticket' ? ticketNumber(route.ticketKey) : null;
  const view = route.kind === 'tickets-list' ? 'list' : 'board';
  const tickets = (board.data?.tickets ?? []).filter(ticket =>
    filter === 'agents'
      ? ticket.assignee?.kind === 'agent'
      : filter === 'mine'
        ? ticket.assignee?.kind === 'owner' && ticket.assignee.name === me
        : true,
  );
  const open = (ticket: TicketSummary) => onNavigate(ticketPath(ticket.key));
  if (number)
    return (
      <TicketDetailView
        organization={organization}
        number={number}
        agents={agents}
        working={working}
        ownerName={ownerName}
        back={view}
        onNavigate={onNavigate}
      />
    );
  return (
    <section aria-label="Tickets" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PageHeader
        title="Tickets"
        description={`${organization.name} · ${board.data?.settings.prefix ?? organization.tickets.prefix}`}
        width="max-w-none"
        action={
          <Button type="button" size="sm" className="min-h-11 gap-1.5 md:min-h-0" onClick={() => setCreating(true)}>
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
          onChange={next => onNavigate(next === 'list' ? '/tickets/list' : ticketPath())}
        />
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-border max-sm:hidden" />
        <ChoiceChips label="Filter" value={filter} options={FILTERS} onChange={setFilter} />
      </div>
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
        <Board key="board" tickets={tickets} agents={agents} working={working} onOpen={open} />
      ) : (
        <List key="list" tickets={tickets} agents={agents} working={working} onOpen={open} />
      )}
      <NewTicketDialog
        open={creating}
        onOpenChange={setCreating}
        organization={organization}
        agents={agents}
        ownerName={ownerName}
        onCreated={ticket => onNavigate(ticketPath(ticket.key))}
      />
    </section>
  );
}

function Working() {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-teal-300">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-teal-300 motion-safe:animate-pulse" />
      working
    </span>
  );
}
const isWorking = (ticket: TicketSummary, working: Set<string>) =>
  ticket.status === 'progress' && ticket.assignee?.kind === 'agent' && working.has(ticket.assignee.id);
function Labels({ labels }: { labels: string[] }) {
  return labels.map(label => (
    <span key={label} className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
      {label}
    </span>
  ));
}

/** Kibo kanban: one column per status, cards that open the ticket. Phones scroll the columns sideways. */
function Board({
  tickets,
  agents,
  working,
  onOpen,
}: {
  tickets: TicketSummary[];
  agents: ChatAgent[];
  working: Set<string>;
  onOpen: (ticket: TicketSummary) => void;
}) {
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto overscroll-x-contain px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 md:snap-none md:px-6 md:pb-6',
        entering,
      )}
    >
      {BOARD_STATUSES.map(status => {
        const cards = tickets.filter(ticket => ticket.status === status.key);
        return (
          <section
            key={status.key}
            aria-label={status.label}
            className="flex max-h-full w-[min(18rem,82vw)] shrink-0 snap-start flex-col overflow-hidden rounded-lg border border-border bg-sidebar/30 ao-card md:w-auto md:min-w-56 md:flex-1"
          >
            <h3 className="flex shrink-0 items-center gap-2 p-3 text-sm font-semibold">
              <span aria-hidden="true" className={cn('size-2 rounded-full', status.dot)} />
              {status.label}
              <span className="text-xs font-normal text-muted-foreground">{cards.length}</span>
            </h3>
            <ScrollArea label={`${status.label} tickets`} className="min-h-0 flex-1">
              <ul className="flex flex-col gap-2 px-2 pb-2">
                {cards.map(ticket => (
                  <li key={ticket.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(ticket)}
                      className="flex w-full cursor-pointer flex-col gap-2 rounded-md border border-border bg-background p-3 text-left ao-raised outline-none transition-colors hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-muted-foreground">{ticket.key}</span>
                        {ticket.priority !== 'none' && (
                          <span className={priorityOf(ticket.priority).tone}>{priorityOf(ticket.priority).label}</span>
                        )}
                        {isWorking(ticket, working) && <Working />}
                      </span>
                      <span className="text-sm leading-snug [overflow-wrap:anywhere]">{ticket.title}</span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Labels labels={ticket.labels} />
                        <span className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
                          {ticket.links.length > 0 && (
                            <span>
                              {ticket.links.length} link{ticket.links.length === 1 ? '' : 's'}
                            </span>
                          )}
                          <AssigneeAvatar assignee={ticket.assignee} agents={agents} />
                          <span className="sr-only">
                            {ticket.assignee ? `Assigned to ${ticket.assignee.name}` : 'Unassigned'}
                          </span>
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
                {!cards.length && <li className="px-1 py-2 text-xs text-muted-foreground">Nothing here.</li>}
              </ul>
            </ScrollArea>
          </section>
        );
      })}
    </div>
  );
}

/** Kibo list: groups per status (Cancelled too, when there are any), one row per ticket. */
function List({
  tickets,
  agents,
  working,
  onOpen,
}: {
  tickets: TicketSummary[];
  agents: ChatAgent[];
  working: Set<string>;
  onOpen: (ticket: TicketSummary) => void;
}) {
  return (
    <ScrollArea label="Ticket list" className="min-h-0 flex-1">
      <div className={cn('space-y-3 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 md:px-6 md:pb-6', entering)}>
        {STATUSES.filter(status => status.key !== 'cancelled' || tickets.some(item => item.status === 'cancelled')).map(
          status => {
            const rows = tickets.filter(ticket => ticket.status === status.key);
            return (
              <section
                key={status.key}
                aria-label={status.label}
                className="overflow-hidden rounded-lg border border-border bg-sidebar/30 ao-card"
              >
                <h3 className="flex items-center gap-2 bg-foreground/5 px-3 py-2 text-sm font-semibold">
                  <span aria-hidden="true" className={cn('size-2 rounded-full', status.dot)} />
                  {status.label}
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
          },
        )}
      </div>
    </ScrollArea>
  );
}

const PRIORITY_CHOICES = PRIORITIES.filter(priority => priority.key !== 'none').map(priority => ({
  value: priority.key,
  label: priority.label,
}));

/** New ticket: title, description (a request from the person writing it), assignee and priority. */
function NewTicketDialog({
  open,
  onOpenChange,
  organization,
  agents,
  ownerName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organization: Organization;
  agents: ChatAgent[];
  ownerName: string;
  onCreated: (ticket: TicketSummary) => void;
}) {
  const id = useId();
  const actions = useTicketActions(organization.id);
  const options = assigneeOptions(ownerName, agents);
  const [title, setTitle] = useState(''),
    [description, setDescription] = useState(''),
    [assignee, setAssignee] = useState('none'),
    [priority, setPriority] = useState<TicketPriority>('medium');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const chosen = options.find(option => option.key === assignee)!;
  const hint = !chosen.choice
    ? organization.tickets.agentsPickUp
      ? 'Unassigned tickets wait in Todo; an agent with the ticket tools may pick it up.'
      : 'Unassigned tickets wait in Todo until you assign someone.'
    : 'owner' in chosen.choice
      ? `Assigned to ${chosen.name}: no agent is woken.`
      : organization.tickets.wakeOnAssign
        ? `${chosen.name} is woken right away with this ticket.`
        : `${chosen.name} is not woken (waking on assignment is off).`;
  const close = (next: boolean) => {
    if (busy) return;
    onOpenChange(next);
    if (!next) setError('');
  };
  async function create() {
    setBusy(true);
    setError('');
    try {
      const made = await actions.create({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        assignee: chosen.choice,
      });
      setTitle('');
      setDescription('');
      setAssignee('none');
      setPriority('medium');
      onOpenChange(false);
      onCreated(made.ticket);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not create the ticket.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={close}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-background ao-card p-6 shadow-xl ${dialogMotion}`}
        >
          <form
            className="space-y-4"
            onSubmit={event => {
              event.preventDefault();
              if (title.trim()) void create();
            }}
          >
            <div>
              <Dialog.Title className="text-lg font-semibold">New ticket</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                In {organization.name}. Agents read the description as a request from you.
              </Dialog.Description>
            </div>
            <div className="space-y-2">
              <label htmlFor={`${id}-title`} className="block text-sm font-medium">
                Title
              </label>
              <input
                id={`${id}-title`}
                autoFocus
                value={title}
                maxLength={200}
                disabled={busy}
                placeholder="Back up the Keep folders nightly"
                onChange={event => setTitle(event.target.value)}
                className={cn(settingsInput, 'text-base sm:text-sm')}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor={`${id}-description`} className="block text-sm font-medium">
                Description
              </label>
              <textarea
                id={`${id}-description`}
                rows={4}
                value={description}
                maxLength={8000}
                disabled={busy}
                placeholder="What done looks like, where to look, anything to avoid."
                onChange={event => setDescription(event.target.value)}
                className="ao-inset w-full resize-y rounded-lg border border-border bg-sidebar px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 sm:text-sm"
              />
            </div>
            <div className="space-y-2">
              <span className="block text-sm font-medium">Assignee</span>
              <ChoiceChips
                label="Assignee"
                value={assignee}
                disabled={busy}
                onChange={setAssignee}
                options={options.map(option => ({
                  value: option.key,
                  label: option.name,
                  icon: option.choice ? (
                    <AssigneeAvatar
                      assignee={
                        'owner' in option.choice
                          ? { kind: 'owner', id: 'owner', name: option.name }
                          : { kind: 'agent', id: option.choice.agentId, name: option.name }
                      }
                      agents={agents}
                      size={16}
                    />
                  ) : undefined,
                }))}
              />
            </div>
            <div className="space-y-2">
              <span className="block text-sm font-medium">Priority</span>
              <ChoiceChips
                label="Priority"
                value={priority}
                disabled={busy}
                onChange={setPriority}
                options={PRIORITY_CHOICES}
              />
            </div>
            <p role="status" className="text-xs text-muted-foreground">
              {hint}
            </p>
            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-10"
                disabled={busy}
                onClick={() => close(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" className="min-h-10" disabled={busy || !title.trim()}>
                {busy ? 'Creating…' : 'Create ticket'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
