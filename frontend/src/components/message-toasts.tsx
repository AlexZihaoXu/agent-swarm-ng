import { useEffect, useRef } from 'react';
import { Toaster, toast } from 'sonner';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { AgentAvatarArt } from '@/components/agent-avatar-art';
import { defaultAvatar } from '@/lib/agent-avatar';
import { onMessageAnnounced } from '@/lib/message-toasts';
import { useOrganizations } from '@/lib/organizations';
import {
  chatAgentPath,
  chatGroupPath,
  isAgentSettings,
  parseDashboardPath,
  ticketNumber,
  ticketPath,
} from '@/lib/dashboard-location';
import { useSignedIn } from '@/lib/auth';
import type { ChatAgent } from '@/use-chat';

/** How long a toast stays (it pauses while hovered). */
export const TOAST_MS = 6000;

/**
 * Toasts for new agent messages somewhere else (docs/notifications.md#toasts): an agent writing while another one's
 * chat is open, a group chat, or an agent of another organization. Shown at the top while the dashboard is in front
 * (push notifications cover the rest), never for the conversation already open; they fade away on their own, and a
 * click opens the conversation (switching organization when needed). Kibo sonner-position-2 + sonner-content-2.
 */
export function MessageToasts({
  agents,
  onNavigate,
}: {
  /** Every agent the person can reach, in all organizations. */
  agents: ChatAgent[];
  onNavigate: (path: string) => void;
}) {
  const client = useQueryClient();
  const { organizations, inScope } = useOrganizations();
  const { name: me } = useSignedIn();
  const latest = useRef({ agents, onNavigate, organizations, inScope, me });
  latest.current = { agents, onNavigate, organizations, inScope, me };
  useEffect(
    () =>
      onMessageAnnounced(item => {
        const { agents, onNavigate, organizations, inScope, me } = latest.current;
        // The address, not the last rendered page: navigation renders as a transition, so for a moment after a click
        // the screen still shows the page before.
        const route = parseDashboardPath(window.location.pathname);
        if (document.visibilityState !== 'visible') return;
        const show = (options: {
          title: string;
          where?: string;
          text: string;
          avatar: React.ReactNode;
          path: string;
        }) =>
          toast.custom(
            id => (
              <button
                type="button"
                onClick={() => {
                  toast.dismiss(id);
                  onNavigate(options.path);
                }}
                className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border bg-background/95 p-3 text-left shadow-xl backdrop-blur outline-none ao-top focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="relative size-8 shrink-0">{options.avatar}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="truncate text-sm font-semibold">{options.title}</span>
                    {options.where && (
                      <span className="shrink-0 truncate text-xs text-muted-foreground">{options.where}</span>
                    )}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                    {options.text || 'Sent a message'}
                  </span>
                </span>
              </button>
            ),
            { id: item.id, duration: TOAST_MS },
          );
        if (item.kind === 'agent') {
          const agent = agents.find(candidate => candidate.id === item.agentId);
          if (!agent) return;
          const organization = agent.real?.organizationId;
          // A floating chat with it on screen (Portal's, or the desktop viewer's) counts as open too.
          if (
            [...document.querySelectorAll<HTMLElement>('[data-floating-chat]')].some(
              element => element.dataset.floatingChat === agent.id && element.getClientRects().length > 0,
            )
          )
            return;
          // Not the chat already open (its settings over it count as open).
          if (
            route.agentId === agent.id &&
            inScope(organization) &&
            (route.kind === 'chat-agent' || isAgentSettings(route))
          )
            return;
          show({
            title: agent.name,
            where: inScope(organization)
              ? undefined
              : `in ${organizations.find(item => item.id === organization)?.name ?? 'another organization'}`,
            text: item.text,
            avatar: <AgentAvatarArt {...(agent.avatar ?? defaultAvatar(agent.id))} size={32} state="idle" />,
            path: chatAgentPath(agent.id),
          });
          return;
        }
        if (item.kind === 'ticket') {
          // Not one's own move, nor the ticket already open.
          const open =
            route.kind === 'ticket' &&
            ticketNumber(route.ticketKey) === ticketNumber(item.key) &&
            inScope(item.organizationId);
          if (item.by === me || open) return;
          const agent = agents.find(
            candidate => candidate.name === item.by && candidate.real?.organizationId === item.organizationId,
          );
          show({
            title: item.by,
            where: inScope(item.organizationId)
              ? undefined
              : `in ${organizations.find(org => org.id === item.organizationId)?.name ?? 'another organization'}`,
            text: `Moved ${item.key} “${item.title}” to In review.`,
            avatar: (
              <AgentAvatarArt {...(agent?.avatar ?? defaultAvatar(agent?.id ?? item.by))} size={32} state="idle" />
            ),
            path: `${ticketPath(item.key)}?org=${encodeURIComponent(item.organizationId)}`,
          });
          return;
        }
        if (route.groupId === item.groupId) return;
        const pages = client.getQueryData<
          InfiniteData<{ groups: { id: string; name: string; organizationId?: string }[] }>
        >(['groups', '']);
        const group = pages?.pages.flatMap(page => page.groups).find(candidate => candidate.id === item.groupId);
        show({
          title: item.authorName,
          where: `in ${group?.name ?? 'a group chat'}`,
          text: item.text,
          avatar: (
            <AgentAvatarArt
              {...(item.authorAvatar ?? defaultAvatar(item.authorId ?? item.authorName))}
              size={32}
              state="idle"
            />
          ),
          path: chatGroupPath(item.groupId),
        });
      }),
    [client],
  );
  // Below the header bar (phones: below the slim top bar).
  return (
    <Toaster
      position="top-center"
      offset={64}
      mobileOffset={{ top: 56, left: 16, right: 16 }}
      visibleToasts={3}
      theme="dark"
      style={{ '--width': '24rem' } as React.CSSProperties}
    />
  );
}
