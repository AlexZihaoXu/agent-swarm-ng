import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type { Root, RootContent, Parent, PhrasingContent } from 'mdast';
import { api } from '@/api/client';
import { ticketPath } from '@/lib/dashboard-location';
import type { Organization } from '@/lib/organizations';
import { statusOf, TICKETS_EVENT, type TicketRef, type TicketsEventDetail } from '@/lib/tickets';
import { cn } from '@/lib/utils';

/**
 * Ticket references (docs/tickets.md#references): in a conversation of an organization with tickets on, an id such
 * as HOME-14 shows as a chip with the ticket's status and title, linking to it. Ids are resolved in small batches
 * through the organization's lookup route, which answers only people who reach that organization and only with its
 * own tickets; an id it does not resolve stays plain text. A message's menu can also file a ticket from it.
 */
type Scope = {
  organizationId: string;
  prefix: string;
  open: (key: string) => void;
  /** Opens the New ticket dialog on the Tickets tab, prefilled with the message and linking it. */
  createFrom: (message: { id: string; text: string }) => void;
};
const Context = createContext<Scope | null>(null);
export const useTicketScope = () => useContext(Context);

/** A message to file, waiting for the Tickets tab of its organization to open the New ticket dialog with it. */
export type NewTicketDraft = { organizationId: string; text: string; messageId: string };
let draft: NewTicketDraft | null = null;
/** The waiting message for this organization's Tickets tab, taken once. */
export function takeNewTicketDraft(organizationId: string) {
  if (draft?.organizationId !== organizationId) return null;
  const taken = draft;
  draft = null;
  return taken;
}

/** The scope of a conversation (or a ticket) of `organization`: chips and "Create ticket" only while tickets are on. */
export function TicketScope({ organization, children }: { organization?: Organization; children: ReactNode }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const id = organization?.tickets?.enabled ? organization.id : undefined;
  const prefix = organization?.tickets?.prefix ?? '';
  // Chips follow the board live: a change refreshes the references of that organization.
  useEffect(() => {
    if (!id) return;
    const changed = (event: Event) => {
      if ((event as CustomEvent<TicketsEventDetail>).detail.organizationId === id)
        void client.invalidateQueries({ queryKey: ['ticket-ref', id] });
    };
    window.addEventListener(TICKETS_EVENT, changed);
    return () => window.removeEventListener(TICKETS_EVENT, changed);
  }, [client, id]);
  const scope = useMemo<Scope | null>(
    () =>
      id
        ? {
            organizationId: id,
            prefix,
            open: key => navigate(`${ticketPath(key)}?org=${encodeURIComponent(id)}`),
            createFrom: message => {
              draft = { organizationId: id, text: message.text, messageId: message.id };
              navigate(`/tickets?org=${encodeURIComponent(id)}`);
            },
          }
        : null,
    [id, prefix, navigate],
  );
  return <Context.Provider value={scope}>{children}</Context.Provider>;
}

// One lookup per organization for the ids that came up within a moment of each other (a page of messages).
const BATCH_MS = 25;
const BATCH_MAX = 50;
const batches = new Map<string, Map<number, ((ref: TicketRef | null) => void)[]>>();
function lookup(organizationId: string, number: number) {
  return new Promise<TicketRef | null>(resolve => {
    let batch = batches.get(organizationId);
    if (!batch) {
      batch = new Map();
      batches.set(organizationId, batch);
      setTimeout(() => void flush(organizationId), BATCH_MS);
    }
    batch.set(number, [...(batch.get(number) ?? []), resolve]);
  });
}
async function flush(organizationId: string) {
  const batch = batches.get(organizationId);
  batches.delete(organizationId);
  if (!batch) return;
  const numbers = [...batch.keys()];
  for (let start = 0; start < numbers.length; start += BATCH_MAX) {
    const chunk = numbers.slice(start, start + BATCH_MAX);
    const { data } = await api
      .GET('/api/organizations/{id}/ticket-refs', {
        params: { path: { id: organizationId }, query: { numbers: chunk.join(',') } },
      })
      .catch(() => ({ data: undefined }));
    for (const number of chunk) {
      const found = data?.tickets.find(ticket => ticket.number === number) ?? null;
      for (const resolve of batch.get(number) ?? []) resolve(found);
    }
  }
}

/** A chip for HOME-14: its status dot, id and title; plain text until (and unless) it resolves. */
export function TicketChip({ text, number }: { text: string; number: number }) {
  const scope = useTicketScope();
  const ref = useQuery({
    queryKey: ['ticket-ref', scope?.organizationId, number],
    enabled: Boolean(scope),
    staleTime: 30_000,
    queryFn: () => lookup(scope!.organizationId, number),
  });
  if (!scope || !ref.data) return <>{text}</>;
  const status = statusOf(ref.data.status);
  return (
    <button
      type="button"
      data-ticket-chip={ref.data.key}
      title={`${ref.data.key} · ${status.label}: ${ref.data.title}`}
      onClick={event => {
        event.stopPropagation();
        scope.open(ref.data!.key);
      }}
      className={cn(
        'mx-px inline-flex max-w-[min(18rem,100%)] cursor-pointer items-center gap-1 rounded-md border border-current/25 bg-background/40 px-1.5 align-baseline text-[0.85em] leading-snug no-underline outline-none transition-colors hover:bg-background/70 focus-visible:ring-1 focus-visible:ring-current',
        (ref.data.status === 'done' || ref.data.status === 'cancelled') && 'opacity-75',
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', status.dot)} />
      <span className="shrink-0 font-mono">{ref.data.key}</span>
      <span className={cn('truncate', ref.data.status === 'cancelled' && 'line-through')}>{ref.data.title}</span>
      <span className="sr-only">({status.label})</span>
    </button>
  );
}

/**
 * A remark plugin marking `PREFIX-N` in text (never inside code or links) as `<span data-ticket-ref>`, which the
 * Markdown renderer shows as a TicketChip.
 */
export function remarkTicketRefs(prefix: string) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_-])${escaped}-(\\d{1,9})(?![\\p{L}\\p{N}_])`, 'gu');
  const split = (value: string): PhrasingContent[] | null => {
    const parts: PhrasingContent[] = [];
    let last = 0;
    for (const match of value.matchAll(pattern)) {
      if (match.index > last) parts.push({ type: 'text', value: value.slice(last, match.index) });
      parts.push({
        type: 'emphasis',
        children: [{ type: 'text', value: match[0] }],
        data: { hName: 'span', hProperties: { dataTicketRef: match[1] } },
      });
      last = match.index + match[0].length;
    }
    if (!parts.length) return null;
    if (last < value.length) parts.push({ type: 'text', value: value.slice(last) });
    return parts;
  };
  const walk = (node: Parent) => {
    node.children = node.children.flatMap(child => {
      if (child.type === 'text') return (split(child.value) as RootContent[] | null) ?? [child];
      if (child.type !== 'link' && child.type !== 'linkReference' && 'children' in child) walk(child as Parent);
      return [child];
    });
  };
  return () => (tree: Root) => walk(tree);
}
