import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select } from '@/components/ui/select';
import { ChevronLeftIcon, PencilIcon, PlusIcon, TrashIcon, XIcon } from '@/components/ui/icons';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { MessageMarkdown } from '@/components/message-markdown';
import { TicketScope } from '@/components/ticket-refs';
import { ArchivedMark, BoardMarks, StateDot } from '@/components/ticket-board';
import { AssigneeAvatar, assigneeKey, assigneeOptions } from '@/components/ticket-assignee';
import { useSignedIn } from '@/lib/auth';
import { computersQuery } from '@/lib/computers-query';
import { chatAgentPath, chatGroupPath, computerPath, ticketPath } from '@/lib/dashboard-location';
import { requestJump } from '@/lib/message-jump';
import type { Organization } from '@/lib/organizations';
import { backLink, settingsInput } from '@/lib/styles';
import {
  dueLabel,
  dueState,
  PRIORITIES,
  RELATIONS,
  todayIn,
  useTicket,
  useTicketActions,
  useTicketBoard,
  type RelationKind,
  type TicketDetail,
  type TicketEvent,
  type TicketLink,
  type TicketPriority,
} from '@/lib/tickets';
import type { ChatAgent } from '@/use-chat';
import { cn } from '@/lib/utils';

const entering = 'motion-safe:animate-[view-in_260ms_cubic-bezier(0.22,1,0.36,1)]';
const field =
  'ao-inset w-full resize-y rounded-lg border border-border bg-sidebar px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 sm:text-sm';
const card = 'space-y-2 rounded-lg border border-border bg-sidebar/30 ao-card p-4';
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
type Patch = {
  /** A state's id. */
  status?: string;
  archived?: boolean;
  priority?: TicketPriority;
  labels?: string[];
  assignee?: { owner: true } | { agentId: string } | null;
  due?: string | null;
  parent?: number | null;
};

/**
 * One ticket (docs/tickets.md): its parent (a breadcrumb), text (Markdown), sub-issues, relations, links, activity
 * and comments, and its properties beside them (below on a phone): status (the board's states), assignee (assigning
 * an agent wakes it), priority, due date, parent, labels, Archive / Restore. Every change saves at once. Its ids in text show as ticket chips.
 */
export function TicketDetailView({
  organization,
  number,
  agents,
  working,
  ownerName,
  backPath,
  onNavigate,
  onAddSubIssue,
}: {
  organization: Organization;
  number: number;
  agents: ChatAgent[];
  working: Set<string>;
  ownerName: string;
  /** The board or list (with its filters) the ticket was opened from. */
  backPath: string;
  onNavigate: (path: string) => void;
  onAddSubIssue: (parent: { number: number; key: string; title: string }) => void;
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
  const header = (
    <button type="button" className={cn(backLink, 'cursor-pointer')} onClick={() => onNavigate(backPath)}>
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
  const busyAgent = agent && working.has(agent.id) && ticket.state.category === 'started';
  const update = (patch: Parameters<typeof actions.update>[1]) => save(() => actions.update(number, patch));
  return (
    <TicketScope organization={organization}>
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
                <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
                  {ticket.parent && (
                    <>
                      <button
                        type="button"
                        className="flex min-h-9 min-w-0 cursor-pointer items-center gap-1.5 rounded-md text-muted-foreground hover:text-foreground"
                        onClick={() => onNavigate(ticketPath(ticket.parent!.key))}
                      >
                        <span className="font-mono">{ticket.parent.key}</span>
                        <span className="max-w-40 truncate max-sm:hidden">{ticket.parent.title}</span>
                      </button>
                      <span aria-hidden="true" className="text-muted-foreground">
                        ›
                      </span>
                    </>
                  )}
                  <span aria-current="page" className="font-mono text-muted-foreground">
                    {ticket.key}
                  </span>
                </nav>
                <CopyLink organizationId={organization.id} ticketKey={ticket.key} />
                {ticket.archived && <ArchivedMark />}
                {busyAgent && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-teal-300">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-teal-300 motion-safe:animate-pulse" />
                    {agent.name} is working on this
                  </span>
                )}
              </div>
              <TicketText detail={query.data} busy={busy} onSave={patch => update(patch)} />
              <SubIssues
                detail={query.data}
                agents={agents}
                onNavigate={onNavigate}
                onAdd={() => onAddSubIssue({ number: ticket.number, key: ticket.key, title: ticket.title })}
              />
              <Relations
                detail={query.data}
                organizationId={organization.id}
                busy={busy}
                onNavigate={onNavigate}
                onAdd={(kind, other) => update({ addRelations: [{ kind, number: other }] })}
                onRemove={(kind, other) => update({ removeRelations: [{ kind, number: other }] })}
              />
              <Links
                detail={query.data}
                organizationId={organization.id}
                busy={busy}
                onNavigate={onNavigate}
                onLink={computerId => update({ linkComputer: computerId })}
                onUnlink={id => update({ unlink: id })}
              />
              <Activity
                events={events}
                agents={agents}
                busy={busy}
                organization={organization}
                onComment={text => save(() => actions.comment(number, text))}
                onEdit={(id, text) => save(() => actions.editComment(number, id, text))}
                onDelete={id => save(() => actions.deleteComment(number, id))}
              />
            </article>
            <Properties
              detail={query.data}
              organizationId={organization.id}
              agents={agents}
              ownerName={ownerName}
              busy={busy}
              error={error}
              onChange={patch => void update(patch)}
              onOpenChat={agent ? () => onNavigate(chatAgentPath(agent.id)) : undefined}
              onDelete={async () => {
                await actions.remove(number);
                onNavigate(backPath);
              }}
            />
          </div>
        </ScrollArea>
      </section>
    </TicketScope>
  );
}

/** Copies the ticket's address (with its organization, so it opens there for anyone who reaches it). */
function CopyLink({ organizationId, ticketKey }: { organizationId: string; ticketKey: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="ml-auto min-h-9 text-xs md:min-h-7"
      onClick={async () => {
        clearTimeout(timer.current);
        const url = `${window.location.origin}${ticketPath(ticketKey)}?org=${encodeURIComponent(organizationId)}`;
        try {
          await navigator.clipboard.writeText(url);
          setState('copied');
        } catch {
          setState('failed');
        }
        timer.current = setTimeout(() => setState('idle'), 2000);
      }}
    >
      <span aria-live="polite">
        {state === 'copied' ? 'Link copied' : state === 'failed' ? 'Copy failed' : 'Copy link'}
      </span>
    </Button>
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
          Description (Markdown)
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
      {/* Markdown through the chat's safe renderer: no HTML, no images fetched, only safe links. */}
      {ticket.description ? (
        <div className="text-sm leading-relaxed text-foreground/85 [overflow-wrap:anywhere]">
          <MessageMarkdown text={ticket.description} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No description.</p>
      )}
      {!ticket.writer.trusted && (
        <p className="text-xs text-muted-foreground">
          Written by {ticket.writer.name}: agents treat it as untrusted input, not a request from the owner.
        </p>
      )}
    </div>
  );
}

/** Sub-issues with done/total progress (Linear's), each opening its ticket; "+ Add sub-issue" opens New ticket. */
function SubIssues({
  detail,
  agents,
  onNavigate,
  onAdd,
}: {
  detail: TicketDetail;
  agents: ChatAgent[];
  onNavigate: (path: string) => void;
  onAdd: () => void;
}) {
  const id = useId();
  const { done, total } = detail.ticket.subIssues;
  return (
    <section aria-labelledby={`${id}-subs`} className="space-y-2">
      <div className="flex items-center gap-3">
        <h3 id={`${id}-subs`} className="text-sm font-semibold">
          Sub-issues
        </h3>
        {total > 0 && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              role="progressbar"
              aria-label="Sub-issues done"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={done}
              className="h-1.5 w-20 overflow-hidden rounded-full bg-foreground/10"
            >
              <span
                className="block h-full rounded-full bg-emerald-400 transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${(done / total) * 100}%` }}
              />
            </span>
            {done}/{total} done
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto min-h-9 gap-1 text-xs md:min-h-7"
          onClick={onAdd}
        >
          <PlusIcon className="size-3.5" />
          Add sub-issue
        </Button>
      </div>
      {detail.children.length > 0 ? (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-sidebar/30">
          {detail.children.map(child => (
            <li key={child.number}>
              <button
                type="button"
                onClick={() => onNavigate(ticketPath(child.key))}
                className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 px-3 text-left text-sm transition-colors hover:bg-muted/60"
              >
                <StateDot color={child.state.color} />
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{child.key}</span>
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate',
                    child.state.category === 'canceled' && 'line-through opacity-70',
                  )}
                >
                  {child.title}
                </span>
                <span className="sr-only">({child.state.name})</span>
                <AssigneeAvatar assignee={child.assignee} agents={agents} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No sub-issues. Split the work up; agents can too.</p>
      )}
    </section>
  );
}

/** Blocks, blocked by, related, duplicates: each opening its ticket, removable; one added from the board's tickets. */
function Relations({
  detail,
  organizationId,
  busy,
  onNavigate,
  onAdd,
  onRemove,
}: {
  detail: TicketDetail;
  organizationId: string;
  busy: boolean;
  onNavigate: (path: string) => void;
  onAdd: (kind: RelationKind, number: number) => Promise<boolean>;
  onRemove: (kind: RelationKind, number: number) => Promise<boolean>;
}) {
  const id = useId();
  const board = useTicketBoard(organizationId);
  const [kind, setKind] = useState<RelationKind>('blocked_by');
  const { ticket, relations } = detail;
  const choices = (board.data?.tickets ?? [])
    .filter(
      item => item.number !== ticket.number && !relations.some(rel => rel.kind === kind && rel.number === item.number),
    )
    .map(item => ({ value: String(item.number), label: `${item.key} ${item.title}` }));
  return (
    <section aria-labelledby={`${id}-relations`} className="space-y-2">
      <h3 id={`${id}-relations`} className="text-sm font-semibold">
        Relations
      </h3>
      {relations.length > 0 ? (
        <ul className="space-y-1.5">
          {RELATIONS.filter(group => relations.some(rel => rel.kind === group.key)).map(group => (
            <li key={group.key} className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'w-24 shrink-0 text-xs text-muted-foreground',
                  group.key === 'blocked_by' && ticket.blocked && 'font-medium text-red-300',
                )}
              >
                {group.label}
              </span>
              {relations
                .filter(rel => rel.kind === group.key)
                .map(rel => (
                  <span
                    key={rel.number}
                    className="flex items-center rounded-lg border border-border bg-sidebar/30 ao-raised"
                  >
                    <button
                      type="button"
                      className="flex min-h-9 max-w-64 cursor-pointer items-center gap-2 px-2.5 text-sm"
                      onClick={() => onNavigate(ticketPath(rel.key))}
                    >
                      <StateDot color={rel.state.color} />
                      <span className="font-mono text-xs text-muted-foreground">{rel.key}</span>
                      <span className="truncate">{rel.title}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${group.label.toLowerCase()} ${rel.key}`}
                      disabled={busy}
                      className="flex size-9 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground disabled:cursor-not-allowed"
                      onClick={() => void onRemove(rel.kind, rel.number)}
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  </span>
                ))}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          None. Mark what blocks it: its agent is woken when the last blocker is done.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-36">
          <Select
            id={`${id}-kind`}
            ariaLabel="Relation"
            value={kind}
            disabled={busy}
            options={RELATIONS.map(item => ({ value: item.key, label: item.label }))}
            onValueChange={value => setKind(value as RelationKind)}
          />
        </div>
        <div className="min-w-0 flex-1 basis-48 sm:max-w-72">
          <Select
            id={`${id}-other`}
            ariaLabel="Add a relation to"
            value=""
            placeholder="Add a ticket…"
            disabled={busy || !choices.length}
            searchable
            searchPlaceholder="Find a ticket…"
            options={choices}
            onValueChange={value => void onAdd(kind, Number(value))}
          />
        </div>
      </div>
    </section>
  );
}

/** Opens a linked message where it was written: its conversation, scrolled to it. */
function openMessage(link: TicketLink, onNavigate: (path: string) => void) {
  const where = link.conversation;
  if (!where) return;
  if (where.kind === 'chat') {
    requestJump(`chat:${where.id}`, link.id);
    if (where.agentId) onNavigate(chatAgentPath(where.agentId));
  } else {
    requestJump(`group:${where.id}`, link.id);
    onNavigate(chatGroupPath(where.id));
  }
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
  const item = 'flex min-h-9 cursor-pointer items-center gap-2 px-3 text-sm';
  return (
    <section aria-labelledby={`${id}-links`} className="space-y-2">
      <h3 id={`${id}-links`} className="text-sm font-semibold">
        Linked
      </h3>
      <ul className="flex flex-wrap gap-2">
        {links.map(link => (
          <li
            key={link.id}
            className="flex min-w-0 items-center rounded-lg border border-border bg-sidebar/30 ao-raised"
          >
            {link.kind === 'computer' ? (
              <button type="button" className={item} onClick={() => onNavigate(computerPath(link.id))}>
                <span className="text-xs text-muted-foreground">Computer</span>
                {link.label}
              </button>
            ) : link.kind === 'message' ? (
              <button
                type="button"
                className={cn(item, 'min-w-0 max-w-80')}
                title={`Open the message in ${link.conversation?.name ?? 'its chat'}`}
                onClick={() => openMessage(link, onNavigate)}
              >
                <span className="shrink-0 text-xs text-muted-foreground">Message · {link.conversation?.name}</span>
                <span className="truncate">{link.label}</span>
              </button>
            ) : (
              <a href={`/api/files/${encodeURIComponent(link.id)}/content?download=1`} className={item}>
                <span className="text-xs text-muted-foreground">File</span>
                {link.label}
              </a>
            )}
            <button
              type="button"
              aria-label={`Unlink ${link.label}`}
              disabled={busy}
              className="flex size-9 shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground disabled:cursor-not-allowed"
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

/** A comment: Markdown, with Edit for one's own and Delete for one's own (the owner: any); deleted, a tombstone. */
function Comment({
  event,
  agents,
  busy,
  mine,
  owner,
  onEdit,
  onDelete,
}: {
  event: TicketEvent;
  agents: ChatAgent[];
  busy: boolean;
  mine: boolean;
  owner: boolean;
  onEdit: (text: string) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(event.text);
  const [deleting, setDeleting] = useState(false);
  const author =
    event.author.kind === 'agent'
      ? { kind: 'agent' as const, id: event.author.id, name: event.author.name }
      : { kind: 'owner' as const, id: event.author.id, name: event.author.name };
  if (event.deleted)
    return (
      <p className="flex items-center gap-2 pl-2 text-xs italic text-muted-foreground">
        <TrashIcon className="size-3.5" />
        Comment by {event.author.name} deleted by {event.deleted.by} · {when(event.deleted.at)}
      </p>
    );
  return (
    <div className="flex gap-3">
      <AssigneeAvatar assignee={author} agents={agents} size={28} />
      <div className="group min-w-0 flex-1 rounded-lg border border-border bg-sidebar/30 px-3 py-2">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">
            <span className="font-medium text-foreground">{event.author.name}</span> · {when(event.createdAt)}
            {event.editedAt && <span title={`Edited ${when(event.editedAt)}`}> · edited</span>}
          </span>
          {!editing && (mine || owner) && (
            <span className="ml-auto flex shrink-0 gap-0.5">
              {mine && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Edit comment"
                  className="size-9 p-0 md:size-7"
                  disabled={busy}
                  onClick={() => {
                    setDraft(event.text);
                    setEditing(true);
                  }}
                >
                  <PencilIcon className="size-3.5" />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Delete comment"
                className="size-9 p-0 md:size-7"
                disabled={busy}
                onClick={() => setDeleting(true)}
              >
                <TrashIcon className="size-3.5" />
              </Button>
            </span>
          )}
        </div>
        {editing ? (
          <form
            className="mt-2 space-y-2"
            onSubmit={submit => {
              submit.preventDefault();
              if (draft.trim()) void onEdit(draft.trim()).then(saved => saved && setEditing(false));
            }}
          >
            <label htmlFor={`${id}-edit`} className="sr-only">
              Edit comment
            </label>
            <textarea
              id={`${id}-edit`}
              rows={3}
              value={draft}
              maxLength={4000}
              disabled={busy}
              autoFocus
              onChange={change => setDraft(change.target.value)}
              className={field}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy || !draft.trim()}>
                Save
              </Button>
            </div>
          </form>
        ) : (
          <div className="mt-1 text-sm [overflow-wrap:anywhere]">
            <MessageMarkdown text={event.text} />
          </div>
        )}
      </div>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this comment?"
        description="Its text goes; the activity keeps a note of who deleted it and when."
        confirmLabel="Delete"
        busyLabel="Deleting…"
        onConfirm={async () => {
          await onDelete();
        }}
      />
    </div>
  );
}

function Activity({
  events,
  agents,
  busy,
  organization,
  onComment,
  onEdit,
  onDelete,
}: {
  events: TicketEvent[];
  agents: ChatAgent[];
  busy: boolean;
  organization: Organization;
  onComment: (text: string) => Promise<boolean>;
  onEdit: (id: string, text: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const id = useId();
  const { name: me } = useSignedIn();
  // People's names are unique; the backend checks the author (and the owner) again.
  const owner = (organization.ownerName ?? me) === me;
  const [draft, setDraft] = useState('');
  return (
    <section aria-labelledby={`${id}-activity`} className="space-y-3">
      <h3 id={`${id}-activity`} className="text-sm font-semibold">
        Activity
      </h3>
      <ol className="space-y-3">
        {events.map(event => (
          <li key={event.id}>
            {event.kind === 'comment' ? (
              <Comment
                event={event}
                agents={agents}
                busy={busy}
                mine={event.author.kind === 'person' && event.author.name === me}
                owner={owner}
                onEdit={text => onEdit(event.id, text)}
                onDelete={() => onDelete(event.id)}
              />
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
        ))}
      </ol>
      <form
        className="space-y-2"
        onSubmit={event => {
          event.preventDefault();
          if (draft.trim()) void onComment(draft.trim()).then(saved => saved && setDraft(''));
        }}
      >
        <label htmlFor={`${id}-comment`} className="block text-xs text-muted-foreground">
          Comment (Markdown; @name an agent to ask it something without reassigning it)
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
  organizationId,
  agents,
  ownerName,
  busy,
  error,
  onChange,
  onOpenChat,
  onDelete,
}: {
  detail: TicketDetail;
  organizationId: string;
  agents: ChatAgent[];
  ownerName: string;
  busy: boolean;
  error: string;
  onChange: (patch: Patch) => void;
  onOpenChat?: () => void;
  onDelete: () => Promise<void>;
}) {
  const id = useId();
  const { ticket } = detail;
  const { timeZone } = useSignedIn();
  const today = todayIn(timeZone);
  const board = useTicketBoard(organizationId);
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
  const due = dueState(ticket.due, ticket.state.category, today);
  // The board's states (the ticket's own until they load).
  const states = board.data?.states ?? [ticket.state];
  const parents = (board.data?.tickets ?? [])
    .filter(item => item.number !== ticket.number)
    .map(item => ({ value: String(item.number), label: `${item.key} ${item.title}` }));
  return (
    <aside aria-label="Properties" className="space-y-5 md:sticky md:top-3 md:self-start">
      <div className={card}>
        <span className="block text-xs font-medium text-muted-foreground">Status</span>
        <ChoiceChips
          label="Status"
          value={ticket.state.id}
          disabled={busy}
          onChange={status => onChange({ status })}
          options={states.map(state => ({
            value: state.id,
            label: state.name,
            icon: <StateDot color={state.color} />,
          }))}
        />
        {(ticket.blocked || ticket.subIssues.total > 0) && (
          <p className="flex flex-wrap items-center gap-2 pt-1">
            <BoardMarks ticket={{ ...ticket, due: null }} today={today} />
          </p>
        )}
      </div>
      <div className={card}>
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
          <label htmlFor={`${id}-due`} className="block text-xs font-medium text-muted-foreground">
            Due date
            {due === 'overdue' && <span className="ml-1.5 font-semibold text-red-300">Overdue</span>}
            {due === 'today' && <span className="ml-1.5 font-semibold text-amber-300">Today</span>}
          </label>
          <div className="flex gap-2">
            <input
              id={`${id}-due`}
              type="date"
              value={ticket.due ?? ''}
              disabled={busy}
              onChange={event => onChange({ due: event.target.value || null })}
              className={cn(
                settingsInput,
                'cursor-text text-base sm:text-sm',
                due === 'overdue' && 'border-red-400/50 text-red-300',
              )}
            />
            {ticket.due && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Remove the due date"
                className="size-11 shrink-0 p-0 sm:size-10"
                disabled={busy}
                onClick={() => onChange({ due: null })}
              >
                <XIcon />
              </Button>
            )}
          </div>
          {ticket.due && (
            <p className="text-[11px] text-muted-foreground">
              {dueLabel(ticket.due, today)}. Its agent is reminded once when the day starts.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-parent`} className="block text-xs font-medium text-muted-foreground">
            Parent (a sub-issue of)
          </label>
          <Select
            id={`${id}-parent`}
            value={ticket.parent ? String(ticket.parent.number) : 'none'}
            disabled={busy}
            searchable
            searchPlaceholder="Find a ticket…"
            options={[{ value: 'none', label: 'None' }, ...parents]}
            onValueChange={value => onChange({ parent: value === 'none' ? null : Number(value) })}
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
          className="w-full"
          disabled={busy}
          onClick={() => onChange({ archived: !ticket.archived })}
        >
          {ticket.archived ? 'Restore from the archive' : 'Archive ticket'}
        </Button>
        {ticket.archived && (
          <p className="text-[11px] text-muted-foreground">
            Archived {when(ticket.archived.at)} by {ticket.archived.by}: hidden from the board and from agents’ lists.
            Changes keep it archived; Restore brings it back.
          </p>
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
        description="Its comments and activity go with it; its sub-issues stay, without a parent. To keep it out of the way, archive it instead."
        confirmLabel="Delete"
        busyLabel="Deleting…"
        onConfirm={onDelete}
      />
    </aside>
  );
}
