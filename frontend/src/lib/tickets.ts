import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { operations } from '@/api/schema';

/** Tickets (docs/tickets.md): an organization's board, its tickets and one ticket with its activity. */
export type TicketBoard = operations['listTickets']['responses'][200]['content']['application/json'];
export type TicketSummary = TicketBoard['tickets'][number];
export type TicketDetail = operations['getTicket']['responses'][200]['content']['application/json'];
export type TicketEvent = TicketDetail['events'][number];
export type TicketStatus = TicketSummary['status'];
export type TicketPriority = TicketSummary['priority'];
export type TicketSettings = TicketBoard['settings'];
export type AssigneeChoice = { owner: true } | { agentId: string } | null;

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

/** The organization's board, kept live by `tickets_updated` events. */
export function useTicketBoard(organizationId: string | undefined) {
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
    queryKey: ['tickets', organizationId],
    enabled: Boolean(organizationId),
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET('/api/organizations/{id}/tickets', {
        params: { path: { id: organizationId! } },
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
export function useTicketActions(organizationId: string | undefined) {
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
    comment: async (number: number, text: string) => {
      const { data, error } = await api.POST('/api/organizations/{id}/tickets/{number}/comments', {
        params: { path: { id, number } },
        body: { text },
      });
      if (!data) throw failure(error, 'Could not post the comment.');
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
