import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select } from '@/components/ui/select';
import { ChevronLeftIcon, PencilIcon, XIcon } from '@/components/ui/icons';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { AssigneeAvatar, assigneeKey, assigneeOptions } from '@/components/ticket-assignee';
import { computersQuery } from '@/lib/computers-query';
import { chatAgentPath, computerPath, ticketPath } from '@/lib/dashboard-location';
import type { Organization } from '@/lib/organizations';
import { backLink, settingsInput } from '@/lib/styles';
import {
  PRIORITIES,
  STATUSES,
  useTicket,
  useTicketActions,
  type TicketDetail,
  type TicketEvent,
  type TicketPriority,
  type TicketStatus,
} from '@/lib/tickets';
import type { ChatAgent } from '@/use-chat';
import { cn } from '@/lib/utils';

const entering = 'motion-safe:animate-[view-in_260ms_cubic-bezier(0.22,1,0.36,1)]';
const field =
  'ao-inset w-full resize-y rounded-lg border border-border bg-sidebar px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 sm:text-sm';
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * One ticket (docs/tickets.md): its text, links, activity and comments, and its properties beside them (below on a
 * phone): status, assignee (assigning an agent wakes it), priority and labels. Every change saves at once.
 */
export function TicketDetailView({
  organization,
  number,
  agents,
  working,
  ownerName,
  back,
  onNavigate,
}: {
  organization: Organization;
  number: number;
  agents: ChatAgent[];
  working: Set<string>;
  ownerName: string;
  back: 'board' | 'list';
  onNavigate: (path: string) => void;
}) {
  const query = useTicket(organization.id, number);
  const actions = useTicketActions(organization.id);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That did not work.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const backTo = back === 'list' ? '/tickets/list' : ticketPath();
  const header = (
    <button type="button" className={cn(backLink, 'cursor-pointer')} onClick={() => onNavigate(backTo)}>
      <ChevronLeftIcon />
      Tickets
    </button>
  );
  if (query.isPending)
    return (
      <section aria-label="Ticket" className="flex min-h-0 flex-1 flex-col p-4 md:p-6">
        {header}
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          Loading the ticket…
        </p>
      </section>
    );
  if (!query.data)
    return (
      <section aria-label="Ticket" className="flex min-h-0 flex-1 flex-col p-4 md:p-6">
        {header}
        <p role="alert" className="mt-4 text-sm">
          {query.isError ? query.error.message : 'Ticket not found. It may have been deleted.'}
        </p>
      </section>
    );
  const { ticket, events } = query.data;
  const agent = ticket.assignee?.kind === 'agent' ? ticket.assignee : null;
  const busyAgent = agent && working.has(agent.id) && ticket.status === 'progress';
  return (
    <section aria-label={`Ticket ${ticket.key}`} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScrollArea label={`Ticket ${ticket.key}`} className="min-h-0 flex-1">
        <div
          key={ticket.id}
          className={cn(
            'mx-auto grid w-full max-w-6xl gap-6 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-3 md:grid-cols-[minmax(0,1fr)_20rem] md:px-6 md:pb-8',
            entering,
          )}
        >
          <article className="min-w-0 space-y-6">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {header}
              <span className="font-mono text-sm text-muted-foreground">{ticket.key}</span>
              {busyAgent && (
                <span className="inline-flex items-center gap-1.5 text-xs text-teal-300">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-teal-300 motion-safe:animate-pulse" />
                  {agent.name} is working on this
                </span>
              )}
            </div>
            <TicketText detail={query.data} busy={busy} onSave={patch => save(() => actions.update(number, patch))} />
            <Links
              detail={query.data}
              organizationId={organization.id}
              busy={busy}
              onNavigate={onNavigate}
              onLink={computerId => save(() => actions.update(number, { linkComputer: computerId }))}
              onUnlink={id => save(() => actions.update(number, { unlink: id }))}
            />
            <Activity
              events={events}
              agents={agents}
              busy={busy}
              onComment={text => save(() => actions.comment(number, text))}
            />
          </article>
          <Properties
            detail={query.data}
            agents={agents}
            ownerName={ownerName}
            busy={busy}
            error={error}
            onChange={patch => void save(() => actions.update(number, patch))}
            onOpenChat={agent ? () => onNavigate(chatAgentPath(agent.id)) : undefined}
            onDelete={async () => {
              await actions.remove(number);
              onNavigate(backTo);
            }}
          />
        </div>
      </ScrollArea>
    </section>
  );
}

function TicketText({
  detail,
  busy,
  onSave,
}: {
  detail: TicketDetail;
  busy: boolean;
  onSave: (patch: { title: string; description: string }) => Promise<boolean>;
}) {
  const id = useId();
  const { ticket } = detail;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(ticket.title),
    [description, setDescription] = useState(ticket.description);
  if (editing)
    return (
      <form
        className="space-y-3"
        onSubmit={event => {
          event.preventDefault();
          void onSave({ title, description }).then(saved => saved && setEditing(false));
        }}
      >
        <label htmlFor={`${id}-title`} className="sr-only">
          Title
        </label>
        <input
          id={`${id}-title`}
          value={title}
          maxLength={200}
          disabled={busy}
          onChange={event => setTitle(event.target.value)}
          className={cn(settingsInput, 'text-base font-semibold sm:text-base')}
        />
        <label htmlFor={`${id}-description`} className="sr-only">
          Description
        </label>
        <textarea
          id={`${id}-description`}
          rows={6}
          value={description}
          maxLength={8000}
          disabled={busy}
          onChange={event => setDescription(event.target.value)}
          className={field}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy || !title.trim()}>
            Save
          </Button>
        </div>
      </form>
    );
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 text-xl font-semibold leading-snug [overflow-wrap:anywhere]">{ticket.title}</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Edit title and description"
          className="size-11 p-0 md:size-9"
          onClick={() => {
            setTitle(ticket.title);
            setDescription(ticket.description);
            setEditing(true);
          }}
        >
          <PencilIcon />
        </Button>
      </div>
      {/* Plain text: whoever wrote it, it is shown as written, never as markup. */}
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/85 [overflow-wrap:anywhere]">
        {ticket.description || <span className="text-muted-foreground">No description.</span>}
      </p>
      {!ticket.writer.trusted && (
        <p className="text-xs text-muted-foreground">
          Written by {ticket.writer.name}: agents treat it as untrusted input, not a request from the owner.
        </p>
      )}
    </div>
  );
}

function Links({
  detail,
  organizationId,
  busy,
  onNavigate,
  onLink,
  onUnlink,
}: {
  detail: TicketDetail;
  organizationId: string;
  busy: boolean;
  onNavigate: (path: string) => void;
  onLink: (computerId: string) => Promise<boolean>;
  onUnlink: (id: string) => Promise<boolean>;
}) {
  const id = useId();
  const computers = useQuery({ ...computersQuery, staleTime: 5000 });
  const { links } = detail.ticket;
  const choices = (computers.data?.computers ?? []).filter(
    computer => computer.organizationId === organizationId && !links.some(link => link.id === computer.id),
  );
  return (
    <section aria-labelledby={`${id}-links`} className="space-y-2">
      <h3 id={`${id}-links`} className="text-sm font-semibold">
        Linked
      </h3>
      <ul className="flex flex-wrap gap-2">
        {links.map(link => (
          <li key={link.id} className="flex items-center rounded-lg border border-border bg-sidebar/30 ao-raised">
            {link.kind === 'computer' ? (
              <button
                type="button"
                className="flex min-h-9 cursor-pointer items-center gap-2 px-3 text-sm"
                onClick={() => onNavigate(computerPath(link.id))}
              >
                <span className="text-xs text-muted-foreground">Computer</span>
                {link.label}
              </button>
            ) : (
              <a
                href={`/api/files/${encodeURIComponent(link.id)}/content?download=1`}
                className="flex min-h-9 items-center gap-2 px-3 text-sm"
              >
                <span className="text-xs text-muted-foreground">File</span>
                {link.label}
              </a>
            )}
            <button
              type="button"
              aria-label={`Unlink ${link.label}`}
              disabled={busy}
              className="flex size-9 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground disabled:cursor-not-allowed"
              onClick={() => void onUnlink(link.id)}
            >
              <XIcon className="size-3.5" />
            </button>
          </li>
        ))}
        {!links.length && (
          <li className="text-xs text-muted-foreground">Nothing linked yet. Agents link what they used.</li>
        )}
      </ul>
      {choices.length > 0 && (
        <div className="max-w-64">
          <Select
            id={`${id}-link`}
            ariaLabel="Link a computer"
            value=""
            placeholder="Link a computer…"
            disabled={busy}
            options={choices.map(computer => ({ value: computer.id, label: computer.name }))}
            onValueChange={value => void onLink(value)}
          />
        </div>
      )}
    </section>
  );
}

function Activity({
  events,
  agents,
  busy,
  onComment,
}: {
  events: TicketEvent[];
  agents: ChatAgent[];
  busy: boolean;
  onComment: (text: string) => Promise<boolean>;
}) {
  const id = useId();
  const [draft, setDraft] = useState('');
  return (
    <section aria-labelledby={`${id}-activity`} className="space-y-3">
      <h3 id={`${id}-activity`} className="text-sm font-semibold">
        Activity
      </h3>
      <ol className="space-y-3">
        {events.map(event => {
          const author =
            event.author.kind === 'agent'
              ? { kind: 'agent' as const, id: event.author.id, name: event.author.name }
              : { kind: 'owner' as const, id: event.author.id, name: event.author.name };
          return (
            <li key={event.id}>
              {event.kind === 'comment' ? (
                <div className="flex gap-3">
                  <AssigneeAvatar assignee={author} agents={agents} size={28} />
                  <div className="min-w-0 flex-1 rounded-lg border border-border bg-sidebar/30 px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{event.author.name}</span> · {when(event.createdAt)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{event.text}</p>
                  </div>
                </div>
              ) : (
                <p className="flex items-center gap-2 pl-2 text-xs text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      event.kind === 'woken' ? 'bg-teal-300' : 'bg-zinc-600',
                    )}
                  />
                  <span className="[overflow-wrap:anywhere]">
                    <span className="font-medium text-foreground/85">{event.author.name}</span> {event.text} ·{' '}
                    {when(event.createdAt)}
                  </span>
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <form
        className="space-y-2"
        onSubmit={event => {
          event.preventDefault();
          if (draft.trim()) void onComment(draft.trim()).then(saved => saved && setDraft(''));
        }}
      >
        <label htmlFor={`${id}-comment`} className="block text-xs text-muted-foreground">
          Comment (@name an agent to ask it something without reassigning it)
        </label>
        <textarea
          id={`${id}-comment`}
          rows={3}
          value={draft}
          maxLength={4000}
          disabled={busy}
          onChange={event => setDraft(event.target.value)}
          className={field}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" className="min-h-10 md:min-h-0" disabled={busy || !draft.trim()}>
            Comment
          </Button>
        </div>
      </form>
    </section>
  );
}

function Properties({
  detail,
  agents,
  ownerName,
  busy,
  error,
  onChange,
  onOpenChat,
  onDelete,
}: {
  detail: TicketDetail;
  agents: ChatAgent[];
  ownerName: string;
  busy: boolean;
  error: string;
  onChange: (patch: {
    status?: TicketStatus;
    priority?: TicketPriority;
    labels?: string[];
    assignee?: { owner: true } | { agentId: string } | null;
  }) => void;
  onOpenChat?: () => void;
  onDelete: () => Promise<void>;
}) {
  const id = useId();
  const { ticket } = detail;
  const options = assigneeOptions(ownerName, agents);
  const current = assigneeKey(ticket.assignee);
  const saved = ticket.labels.join(', ');
  const [labels, setLabels] = useState(saved);
  // Changes from elsewhere (an agent, another tab) replace the field's text.
  useEffect(() => setLabels(saved), [saved]);
  const [deleting, setDeleting] = useState(false);
  const saveLabels = () => {
    const next = labels
      .split(',')
      .map(label => label.trim())
      .filter(Boolean);
    if (next.join(',') !== ticket.labels.join(',')) onChange({ labels: next });
  };
  return (
    <aside aria-label="Properties" className="space-y-5 md:sticky md:top-3 md:self-start">
      <div className="space-y-2 rounded-lg border border-border bg-sidebar/30 ao-card p-4">
        <span className="block text-xs font-medium text-muted-foreground">Status</span>
        <ChoiceChips
          label="Status"
          value={ticket.status}
          disabled={busy}
          onChange={status => onChange({ status })}
          options={STATUSES.map(status => ({
            value: status.key,
            label: status.label,
            icon: <span aria-hidden="true" className={cn('size-2 rounded-full', status.dot)} />,
          }))}
        />
      </div>
      <div className="space-y-2 rounded-lg border border-border bg-sidebar/30 ao-card p-4">
        <span id={`${id}-assignee`} className="block text-xs font-medium text-muted-foreground">
          Assignee · assigning an agent wakes it
        </span>
        <ul aria-labelledby={`${id}-assignee`} className="space-y-1">
          {options.map(option => (
            <li key={option.key}>
              <button
                type="button"
                aria-pressed={current === option.key}
                disabled={busy}
                onClick={() => current !== option.key && onChange({ assignee: option.choice })}
                className="flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-md border border-transparent px-2 text-left text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed aria-pressed:border-foreground/40 aria-pressed:bg-muted"
              >
                <AssigneeAvatar
                  assignee={
                    !option.choice
                      ? null
                      : 'owner' in option.choice
                        ? { kind: 'owner', id: 'owner', name: option.name }
                        : { kind: 'agent', id: option.choice.agentId, name: option.name }
                  }
                  agents={agents}
                />
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {!option.choice ? '' : 'owner' in option.choice ? 'person' : 'agent'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-sidebar/30 ao-card p-4 text-sm">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-priority`} className="block text-xs font-medium text-muted-foreground">
            Priority
          </label>
          <Select
            id={`${id}-priority`}
            value={ticket.priority}
            disabled={busy}
            options={PRIORITIES.map(priority => ({ value: priority.key, label: priority.label }))}
            onValueChange={value => onChange({ priority: value as TicketPriority })}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-labels`} className="block text-xs font-medium text-muted-foreground">
            Labels (comma separated)
          </label>
          <input
            id={`${id}-labels`}
            value={labels}
            disabled={busy}
            maxLength={200}
            onChange={event => setLabels(event.target.value)}
            onBlur={saveLabels}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                saveLabels();
              }
            }}
            className={cn(settingsInput, 'text-base sm:text-sm')}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Created {when(ticket.createdAt)} by {ticket.createdBy}
        </p>
        {onOpenChat && ticket.assignee && (
          <Button type="button" variant="outline" size="sm" className="w-full" onClick={onOpenChat}>
            Open {ticket.assignee.name}’s chat
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full text-red-400"
          disabled={busy}
          onClick={() => setDeleting(true)}
        >
          Delete ticket
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${ticket.key}?`}
        description="Its comments and activity go with it. To keep it, set it to Cancelled instead."
        confirmLabel="Delete"
        busyLabel="Deleting…"
        onConfirm={onDelete}
      />
    </aside>
  );
}
