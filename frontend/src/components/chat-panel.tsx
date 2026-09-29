import { useEffect, useRef, useState } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { type ChatAgent, type RealAgent } from '@/use-chat';
import { useAgentSearch } from '@/use-agent-search';
import { listTime } from '@/lib/format-time';
import { SidebarSearch } from '@/components/sidebar-search';
import { ConversationRow } from '@/components/conversation-row';
import type { ChatMessage } from '@/chat-types';
import { groupMessagesOptions, useGroups, type GroupChat } from '@/use-groups';
import { useQueryClient } from '@tanstack/react-query';
import { AgentAvatar } from '@/components/chat-identity';
import { AgentAvatarArt } from '@/components/agent-avatar-art';
import { defaultAvatar } from '@/lib/agent-avatar';
import { Button } from '@/components/ui/button';
import { GroupEditor } from '@/components/group-editor';
import { cn } from '@/lib/utils';
import { chatGroupPath, type DashboardRoute } from '@/lib/dashboard-location';

function GroupAvatar({ group }: { group: GroupChat }) {
  return (
    <span aria-hidden="true" className="relative size-8 shrink-0">
      {group.members.slice(0, 3).map((member, index) => (
        <span
          key={member.id}
          className="absolute"
          style={{ left: index === 1 ? 13 : index === 2 ? 6 : 0, top: index === 2 ? 13 : 0 }}
        >
          <AgentAvatarArt {...(member.avatar ?? defaultAvatar(member.id))} size={20} />
        </span>
      ))}
      {!group.members.length && (
        <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">#</span>
      )}
    </span>
  );
}
export function ChatPanel({
  route,
  onNavigate,
  agents,
  conversations,
  busy,
  typingIn,
  selectedAgent,
  selectedGroup,
  onAgent,
  onViewAgent,
  onGroup,
  mobile,
  agentsLoading,
  agentsFailed,
  agentsCursor,
  loadAgents,
  onPrefetchAgent,
}: {
  route: DashboardRoute;
  onNavigate: (path: string, options?: { state?: unknown }) => void;
  agents: ChatAgent[];
  conversations: Record<string, ChatMessage[]>;
  busy: Record<string, boolean>;
  typingIn: (channel: string, destination: string) => boolean;
  selectedAgent: string;
  selectedGroup: string;
  onAgent: (id: string, real?: RealAgent) => void;
  onViewAgent: (id: string, real?: RealAgent) => void;
  onGroup: (group: GroupChat) => void;
  mobile: boolean;
  agentsLoading: boolean;
  agentsFailed: boolean;
  agentsCursor: number | null;
  loadAgents: (after?: number) => Promise<void>;
  onPrefetchAgent: (agent: ChatAgent) => void;
}) {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [context, setContext] = useState<{ kind: 'dm'; agent: ChatAgent } | { kind: 'group'; group: GroupChat } | null>(
    null,
  );
  const panelRef = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const fromContext = useRef(false);
  useEffect(() => {
    if (['group-new', 'group-edit', 'group-delete'].includes(route.kind) || !fromContext.current) return;
    fromContext.current = false;
    const frame = requestAnimationFrame(() => {
      const target = returnFocus.current;
      if (target?.isConnected && target.getClientRects().length) target.focus();
      else panelRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [route.kind]);
  const groups = useGroups(search.trim());
  const { query: matches, agents: people } = useAgentSearch(search, agents);
  const items = [
    ...people.map(agent => ({
      kind: 'dm' as const,
      id: agent.id,
      name: agent.name,
      timestamp:
        conversations[agent.channelId]?.at(-1)?.timestamp ??
        agent.real?.lastMessage?.timestamp ??
        agent.real?.createdAt ??
        0,
      agent,
    })),
    ...(groups.data?.pages.flatMap(page => page.groups) ?? []).map(group => ({
      kind: 'group' as const,
      id: group.id,
      name: group.name,
      timestamp: group.lastMessage?.timestamp ?? group.createdAt,
      group,
    })),
  ]
    .filter(item => item.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => b.timestamp - a.timestamp || a.name.localeCompare(b.name));
  const loading = groups.isFetching || (search.trim() ? matches.isFetching : agentsLoading);
  const failed = groups.isError || (search.trim() ? matches.isError : agentsFailed);
  const more = groups.hasNextPage || (search.trim() ? matches.hasNextPage : agentsCursor !== null);
  const load = () => {
    if (groups.isError) void groups.refetch();
    else if (groups.hasNextPage) void groups.fetchNextPage();
    if (search.trim()) {
      if (matches.isError) void matches.refetch();
      else if (matches.hasNextPage) void matches.fetchNextPage();
    } else if (agentsFailed || agentsCursor !== null) void loadAgents(agentsCursor ?? undefined);
  };
  // Match the Agents sidebar's Kibo context-menu-standard-1 composition.
  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <aside
            ref={panelRef}
            aria-label="Chats"
            tabIndex={0}
            className={cn(
              'phone-list-enter min-h-0 w-full shrink-0 flex-col border-border bg-sidebar pb-[calc(5rem+env(safe-area-inset-bottom))] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:flex md:w-72 md:border-r md:pb-0',
              mobile ? 'hidden' : 'flex',
            )}
            onContextMenuCapture={event => {
              const row = (event.target as HTMLElement).closest<HTMLElement>('[data-chat-kind][data-chat-id]');
              const item = items.find(item => item.kind === row?.dataset.chatKind && item.id === row?.dataset.chatId);
              setContext(
                item?.kind === 'dm'
                  ? { kind: 'dm', agent: item.agent }
                  : item?.kind === 'group'
                    ? { kind: 'group', group: item.group }
                    : null,
              );
              returnFocus.current = row ?? panelRef.current;
            }}
            onKeyDown={event => {
              if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
              event.preventDefault();
              const target = event.target as HTMLElement;
              const bounds = target.getBoundingClientRect();
              target.dispatchEvent(
                new MouseEvent('contextmenu', {
                  bubbles: true,
                  cancelable: true,
                  button: 2,
                  clientX: bounds.left + 16,
                  clientY: bounds.top + 16,
                }),
              );
            }}
          >
            <SidebarSearch
              label="Search chats"
              placeholder="Search chats"
              maxLength={80}
              value={search}
              onChange={setSearch}
              action={
                <GroupEditor
                  open={route.kind === 'group-new'}
                  onOpenChange={open => onNavigate(open ? '/chat/groups/new' : '/chat')}
                  onSaved={onGroup}
                >
                  <Button
                    variant="outline"
                    size="sm"
                    className="size-11 shrink-0 p-0 text-lg sm:size-8"
                    aria-label="Create group chat"
                    title="Create group chat"
                  >
                    +
                  </Button>
                </GroupEditor>
              }
            />
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
              {!items.length && !loading && !failed && (
                <p role="status" className="px-2 py-4 text-xs text-muted-foreground">
                  {search ? 'No chats found.' : 'Create an agent in Agents or start a group chat.'}
                </p>
              )}
              <ul className="space-y-0.5">
                {items.map(item => {
                  const selected =
                    item.kind === 'group' ? item.id === selectedGroup : !selectedGroup && item.id === selectedAgent;
                  const latest = item.kind === 'dm' ? conversations[item.agent.channelId]?.at(-1) : undefined;
                  const preview =
                    item.kind === 'group'
                      ? `${item.group.lastMessage ? `${item.group.lastMessage.role === 'user' ? 'You' : item.group.lastMessage.authorName}: ${item.group.lastMessage.text}` : ''}`
                      : (latest?.text ?? item.agent.real?.lastMessage?.text ?? '');
                  return (
                    <ConversationRow
                      key={`${item.kind}:${item.id}`}
                      data={{ 'data-chat-kind': item.kind, 'data-chat-id': item.id }}
                      label={`Open ${item.kind === 'group' ? 'group chat' : 'conversation with'} ${item.name}`}
                      selected={selected}
                      selectionGroup="chat"
                      onPrefetch={() =>
                        item.kind === 'group'
                          ? void client.prefetchQuery({ ...groupMessagesOptions(client, item.id), staleTime: 10_000 })
                          : onPrefetchAgent(item.agent)
                      }
                      onClick={() => (item.kind === 'group' ? onGroup(item.group) : onAgent(item.id, item.agent.real))}
                      avatar={
                        item.kind === 'group' ? (
                          <GroupAvatar group={item.group} />
                        ) : (
                          <AgentAvatar
                            initials={item.agent.initials}
                            avatar={item.agent.avatar}
                            size="md"
                            ready={Boolean(item.agent.real)}
                            working={busy[item.agent.channelId]}
                            typing={typingIn(item.agent.channelId, item.agent.channelId)}
                          />
                        )
                      }
                      name={item.name}
                      time={listTime(item.timestamp)}
                      previewPrefix={item.kind === 'dm' && latest?.author === 'user' ? 'You: ' : ''}
                      preview={preview}
                    />
                  );
                })}
              </ul>
              {(loading || failed || more) && (
                <Button variant="outline" size="sm" className="mt-3 w-full" disabled={loading} onClick={load}>
                  {loading ? 'Loading chats…' : failed ? 'Retry loading chats' : 'Load more chats'}
                </Button>
              )}
            </div>
          </aside>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            className="context-menu-content phone-menu-targets z-50 min-w-48 rounded-lg border border-border bg-background p-1 shadow-lg"
            onCloseAutoFocus={event => {
              if (route.kind === 'group-edit' || route.kind === 'group-new') event.preventDefault();
            }}
          >
            <ContextMenu.Item
              onSelect={() => {
                fromContext.current = true;
                onNavigate('/chat/groups/new');
              }}
              className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-muted"
            >
              <span
                aria-hidden="true"
                className="flex size-4 shrink-0 items-center justify-center text-lg leading-none text-muted-foreground"
              >
                +
              </span>
              Create group chat
            </ContextMenu.Item>
            {context && (
              <ContextMenu.Item
                onSelect={() =>
                  context.kind === 'group' ? onGroup(context.group) : onAgent(context.agent.id, context.agent.real)
                }
                className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-muted"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                  className="size-4 shrink-0"
                >
                  <path d="M4 5h16v12H8l-4 3V5z" />
                </svg>
                Open chat
              </ContextMenu.Item>
            )}
            {context?.kind === 'group' && (
              <>
                <ContextMenu.Item
                  onSelect={() => {
                    fromContext.current = true;
                    onNavigate(`${chatGroupPath(context.group.id)}/edit`, { state: { returnTo: '/chat' } });
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-muted"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    className="size-4 shrink-0"
                  >
                    <path
                      d="m15 5 4 4M5 15 16 4a2.8 2.8 0 0 1 4 4L9 19l-5 1z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Edit group chat
                </ContextMenu.Item>
                <ContextMenu.Item
                  onSelect={() => {
                    fromContext.current = true;
                    onNavigate(`${chatGroupPath(context.group.id)}/delete`, { state: { returnTo: '/chat' } });
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-red-400 outline-none data-[highlighted]:bg-red-500/10"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="size-4 shrink-0"
                  >
                    <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />
                  </svg>
                  Delete group chat
                </ContextMenu.Item>
              </>
            )}
            {context?.kind === 'dm' && (
              <ContextMenu.Item
                onSelect={() => onViewAgent(context.agent.id, context.agent.real)}
                className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-muted"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  className="size-4 shrink-0"
                >
                  <circle cx="12" cy="8" r="3" />
                  <path d="M5 20v-2a7 7 0 0 1 14 0v2" />
                </svg>
                View in Agents
              </ContextMenu.Item>
            )}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </>
  );
}
