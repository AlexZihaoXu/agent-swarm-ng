import { useEffect } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { operations } from '@/api/schema';

/** Tickets (docs/tickets.md): an organization's board, its tickets and one ticket with its activity. */
export type TicketBoard = operations['listTickets']['responses'][200]['content']['application/json'];
export type TicketSummary = TicketBoard['tickets'][number];
export type TicketDetail = operations['getTicket']['responses'][200]['content']['application/json'];
export type TicketEvent = TicketDetail['events'][number];
export type TicketChild = TicketDetail['children'][number];
export type TicketRelation = TicketDetail['relations'][number];
export type RelationKind = TicketRelation['kind'];
export type TicketLink = TicketSummary['links'][number];
/** A ticket named elsewhere (a chip): number, key, title and status. */
export type TicketRef = operations['ticketRefs']['responses'][200]['content']['application/json']['tickets'][number];
export type TicketStatus = TicketSummary['status'];
export type TicketPriority = TicketSummary['priority'];
export type TicketSettings = TicketBoard['settings'];
export type AssigneeChoice = { owner: true } | { agentId: string } | null;
/** Where a dragged ticket lands in its column: right below `after`, else right above `before`, else on top. */
export type TicketPlace = { after?: number; before?: number };

/**
 * The board with one ticket moved (docs/tickets.md#dragging): its new status, put next to its neighbour in the
 * board-ordered list, so every view grouping by status shows it there.
 */
export function placeTicket(tickets: TicketSummary[], number: number, status: TicketStatus, place: TicketPlace) {
  const moved = tickets.find(ticket => ticket.number === number);
  if (!moved) return tickets;
  const rest = tickets.filter(ticket => ticket.number !== number);
  const at = (target: number | undefined) => rest.findIndex(ticket => ticket.number === target);
  const after = at(place.after);
  const before = at(place.before);
  const top = rest.findIndex(ticket => ticket.status === status);
  const index = after >= 0 ? after + 1 : before >= 0 ? before : top >= 0 ? top : rest.length;
  return [...rest.slice(0, index), { ...moved, status }, ...rest.slice(index)];
}

/** In board order; Cancelled is listed, not a board column. */
export const STATUSES: { key: TicketStatus; label: string; dot: string }[] = [
  { key: 'backlog', label: 'Backlog', dot: 'bg-zinc-500' },
  { key: 'todo', label: 'Todo', dot: 'bg-zinc-300' },
  { key: 'progress', label: 'In progress', dot: 'bg-amber-400' },
  { key: 'review', label: 'In review', dot: 'bg-sky-400' },
  { key: 'done', label: 'Done', dot: 'bg-emerald-400' },
  { key: 'cancelled', label: 'Cancelled', dot: 'bg-zinc-700' },
];
export const BOARD_STATUSES = STATUSES.filter(status => status.key !== 'cancelled');
export const statusOf = (key: TicketStatus) => STATUSES.find(status => status.key === key)!;
export const PRIORITIES: { key: TicketPriority; label: string; tone: string }[] = [
  { key: 'urgent', label: 'Urgent', tone: 'text-red-300' },
  { key: 'high', label: 'High', tone: 'text-orange-300' },
  { key: 'medium', label: 'Medium', tone: 'text-foreground/80' },
  { key: 'low', label: 'Low', tone: 'text-muted-foreground' },
  { key: 'none', label: 'No priority', tone: 'text-muted-foreground' },
];
export const priorityOf = (key: TicketPriority) => PRIORITIES.find(priority => priority.key === key)!;
/** Relations as seen from a ticket, in the order the detail lists them. */
export const RELATIONS: { key: RelationKind; label: string }[] = [
  { key: 'blocks', label: 'Blocks' },
  { key: 'blocked_by', label: 'Blocked by' },
  { key: 'related', label: 'Related to' },
  { key: 'duplicate_of', label: 'Duplicate of' },
  { key: 'duplicated_by', label: 'Duplicated by' },
];

/** Today, as YYYY-MM-DD, in a time zone (the person's: docs/tickets.md#due-dates). */
export function todayIn(zone: string, now = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
const addDays = (date: string, days: number) => {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};
/** Due soon: today or within the next seven days. */
export const DUE_SOON_DAYS = 7;
/** A due date against today: past it (overdue, unless the ticket is closed), today, soon (a week) or later. */
export function dueState(due: string | null, status: TicketStatus, today: string) {
  if (!due) return null;
  if (status === 'done' || status === 'cancelled') return 'closed' as const;
  if (due < today) return 'overdue' as const;
  if (due === today) return 'today' as const;
  return due <= addDays(today, DUE_SOON_DAYS) ? ('soon' as const) : ('later' as const);
}
/** "Oct 20" (with the year when it is not this one). */
export function dueLabel(due: string, today: string) {
  const at = new Date(`${due}T12:00:00Z`);
  return at.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(due.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
}

/**
 * The Tickets tab's search, filters and sort, kept in the address (docs/tickets.md#search-and-filters) beside the
 * organization (`org`): `q`, `status`, `assignee` (`me`, `agents`, `none` or agent ids), `priority`, `label`, `due`
 * (`overdue`, `soon` or `none`) and the list's `sort`.
 */
export type TicketSort = 'manual' | 'updated' | 'priority' | 'due';
export type TicketFilters = {
  q: string;
  status: TicketStatus[];
  assignee: string[];
  priority: TicketPriority[];
  label: string[];
  due: '' | 'overdue' | 'soon' | 'none';
  sort: TicketSort;
};
const FILTER_KEYS = ['q', 'status', 'assignee', 'priority', 'label', 'due', 'sort'] as const;
const listOf = (params: URLSearchParams, key: string) =>
  (params.get(key) ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .slice(0, 50);
export function parseFilters(search: string): TicketFilters {
  const params = new URLSearchParams(search);
  const due = params.get('due');
  const sort = params.get('sort');
  return {
    q: (params.get('q') ?? '').slice(0, 200),
    status: listOf(params, 'status').filter(value => STATUSES.some(status => status.key === value)) as TicketStatus[],
    assignee: listOf(params, 'assignee'),
    priority: listOf(params, 'priority').filter(value =>
      PRIORITIES.some(priority => priority.key === value),
    ) as TicketPriority[],
    label: listOf(params, 'label').map(label => label.toLowerCase()),
    due: due === 'overdue' || due === 'soon' || due === 'none' ? due : '',
    sort: sort === 'updated' || sort === 'priority' || sort === 'due' ? sort : 'manual',
  };
}
/** The address's query with these filters (other parameters, such as the organization, kept). */
export function filterSearch(filters: TicketFilters, current: string) {
  const params = new URLSearchParams(current);
  for (const key of FILTER_KEYS) params.delete(key);
  if (filters.q.trim()) params.set('q', filters.q);
  for (const key of ['status', 'assignee', 'priority', 'label'] as const)
    if (filters[key].length) params.set(key, filters[key].join(','));
  if (filters.due) params.set('due', filters.due);
  if (filters.sort !== 'manual') params.set('sort', filters.sort);
  const search = params.toString();
  return search ? `?${search}` : '';
}
/** How many filters (search and sort aside) are on. */
export const filterCount = (filters: TicketFilters) =>
  filters.status.length +
  filters.assignee.length +
  filters.priority.length +
  filters.label.length +
  (filters.due ? 1 : 0);
/** The tickets these filters keep (the search itself is the server's: `q`). */
export function applyFilters(tickets: TicketSummary[], filters: TicketFilters, today: string) {
  return tickets.filter(ticket => {
    if (filters.status.length && !filters.status.includes(ticket.status)) return false;
    if (filters.priority.length && !filters.priority.includes(ticket.priority)) return false;
    if (filters.label.length && !filters.label.some(label => ticket.labels.includes(label))) return false;
    if (filters.assignee.length) {
      const who = ticket.assignee;
      const match = filters.assignee.some(value =>
        value === 'me'
          ? who?.kind === 'owner'
          : value === 'agents'
            ? who?.kind === 'agent'
            : value === 'none'
              ? !who
              : who?.kind === 'agent' && who.id === value,
      );
      if (!match) return false;
    }
    if (filters.due) {
      const state = dueState(ticket.due, ticket.status, today);
      if (
        filters.due === 'none'
          ? ticket.due
          : filters.due === 'overdue'
            ? state !== 'overdue'
            : !['overdue', 'today', 'soon'].includes(state ?? '')
      )
        return false;
    }
    return true;
  });
}
const PRIORITY_RANK: Record<TicketPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
/** The list's order: manual (the board's), most recently updated, priority, or due date (none last). */
export function sortTickets(tickets: TicketSummary[], sort: TicketSort) {
  if (sort === 'manual') return tickets;
  const sorted = [...tickets];
  if (sort === 'updated') sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (sort === 'priority') sorted.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  if (sort === 'due') sorted.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  return sorted;
}
/** The browser event use-chat raises for a `tickets_updated` run event. */
export const TICKETS_EVENT = 'swarm-tickets-updated';
export type TicketsEventDetail = {
  organizationId: string;
  number: number;
  deleted?: boolean;
  review?: { key: string; title: string; by: string };
};

const failure = (error: unknown, fallback: string) =>
  new Error((error as { message?: string } | undefined)?.message ?? fallback);

/** The organization's board (only the tickets matching `q`, when searching), kept live by `tickets_updated` events. */
export function useTicketBoard(organizationId: string | undefined, q = '') {
  const client = useQueryClient();
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<TicketsEventDetail>).detail;
      if (detail.organizationId !== organizationId) return;
      void client.invalidateQueries({ queryKey: ['tickets', organizationId] });
      void client.invalidateQueries({ queryKey: ['ticket', organizationId, detail.number] });
    };
    window.addEventListener(TICKETS_EVENT, changed);
    return () => window.removeEventListener(TICKETS_EVENT, changed);
  }, [client, organizationId]);
  return useQuery({
    queryKey: ['tickets', organizationId, q],
    enabled: Boolean(organizationId),
    // While a new search answers, the last board stays (no flash of an empty one).
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET('/api/organizations/{id}/tickets', {
        params: { path: { id: organizationId! }, query: q ? { q } : {} },
        signal,
      });
      if (!data) throw failure(error, 'Could not load the tickets.');
      return data;
    },
  });
}

export function useTicket(organizationId: string | undefined, number: number | null) {
  return useQuery({
    queryKey: ['ticket', organizationId, number],
    enabled: Boolean(organizationId && number),
    queryFn: async ({ signal }) => {
      const { data, error, response } = await api.GET('/api/organizations/{id}/tickets/{number}', {
        params: { path: { id: organizationId!, number: number! } },
        signal,
      });
      if (response.status === 404) return null;
      if (!data) throw failure(error, 'Could not load the ticket.');
      return data;
    },
  });
}

/** Saves a change to a ticket and puts the answer in the caches (the board refreshes from its event too). */
export function useTicketActions(organizationId: string | undefined, q = '') {
  const client = useQueryClient();
  const settle = (detail: TicketDetail) => {
    client.setQueryData(['ticket', organizationId, detail.ticket.number], detail);
    void client.invalidateQueries({ queryKey: ['tickets', organizationId] });
    return detail;
  };
  const id = organizationId ?? '';
  return {
    create: async (body: operations['createTicket']['requestBody']['content']['application/json']) => {
      const { data, error } = await api.POST('/api/organizations/{id}/tickets', { params: { path: { id } }, body });
      if (!data) throw failure(error, 'Could not create the ticket.');
      return settle(data);
    },
    update: async (number: number, body: operations['updateTicket']['requestBody']['content']['application/json']) => {
      const { data, error } = await api.PATCH('/api/organizations/{id}/tickets/{number}', {
        params: { path: { id, number } },
        body,
      });
      if (!data) throw failure(error, 'Could not save the change.');
      return settle(data);
    },
    /** A drag on the board: shown at once, saved as a status change (if any) and a place, undone if it fails. */
    move: async (number: number, status: TicketStatus, place: TicketPlace) => {
      const key = ['tickets', organizationId, q];
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<TicketBoard>(key);
      const current = before?.tickets.find(ticket => ticket.number === number);
      if (before)
        client.setQueryData<TicketBoard>(key, {
          ...before,
          tickets: placeTicket(before.tickets, number, status, place),
        });
      const { data, error } = await api.PATCH('/api/organizations/{id}/tickets/{number}', {
        params: { path: { id, number } },
        body: { ...(current?.status === status ? {} : { status }), place },
      });
      if (!data) {
        if (before) client.setQueryData(key, before);
        void client.invalidateQueries({ queryKey: key });
        throw failure(error, 'Could not move the ticket.');
      }
      return settle(data);
    },
    comment: async (number: number, text: string) => {
      const { data, error } = await api.POST('/api/organizations/{id}/tickets/{number}/comments', {
        params: { path: { id, number } },
        body: { text },
      });
      if (!data) throw failure(error, 'Could not post the comment.');
      return settle(data);
    },
    editComment: async (number: number, commentId: string, text: string) => {
      const { data, error } = await api.PATCH('/api/organizations/{id}/tickets/{number}/comments/{commentId}', {
        params: { path: { id, number, commentId } },
        body: { text },
      });
      if (!data) throw failure(error, 'Could not save the comment.');
      return settle(data);
    },
    deleteComment: async (number: number, commentId: string) => {
      const { data, error } = await api.DELETE('/api/organizations/{id}/tickets/{number}/comments/{commentId}', {
        params: { path: { id, number, commentId } },
      });
      if (!data) throw failure(error, 'Could not delete the comment.');
      return settle(data);
    },
    remove: async (number: number) => {
      const { data, error } = await api.DELETE('/api/organizations/{id}/tickets/{number}', {
        params: { path: { id, number } },
      });
      if (!data) throw failure(error, 'Could not delete the ticket.');
      client.removeQueries({ queryKey: ['ticket', organizationId, number] });
      void client.invalidateQueries({ queryKey: ['tickets', organizationId] });
    },
  };
}

/** "2 min ago", "Oct 12": when a ticket last changed. */
export function updatedLabel(iso: string, now = Date.now()) {
  const at = Date.parse(iso);
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
