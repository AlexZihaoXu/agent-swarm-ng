import { useRef, useState } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { asAgent, type ChatAgent, type RealAgent } from '@/use-chat';
import type { ChatMessage } from '@/chat-types';
import { useGroups, type GroupChat } from '@/use-groups';
import { AgentAvatar } from '@/components/chat-identity';
import { AgentAvatarArt } from '@/components/agent-avatar-art';
import { defaultAvatar } from '@/lib/agent-avatar';
import { Button } from '@/components/ui/button';
import { GroupEditor } from '@/components/group-editor';
import { DeleteGroupForm } from '@/components/delete-group-form';
import { SlideUpFadeSwap } from '@/components/ui/slide-up-fade-swap';
import { renderMessagePreview } from '@/components/message-markdown';
import { cn } from '@/lib/utils';

function GroupAvatar({ group }: { group: GroupChat }) {
  return <span aria-hidden="true" className="relative size-8 shrink-0">{group.members.slice(0, 3).map((member, index) => <span key={member.id} className="absolute" style={{ left: index === 1 ? 13 : index === 2 ? 6 : 0, top: index === 2 ? 13 : 0 }}><AgentAvatarArt {...(member.avatar ?? defaultAvatar(member.id))} size={20} /></span>)}{!group.members.length && <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">#</span>}</span>;
}
export function ChatPanel({ agents, conversations, busy, typingIn, selectedAgent, selectedGroup, onAgent, onViewAgent, onGroup, mobile, agentsLoading, agentsFailed, agentsCursor, loadAgents }: {
  agents: ChatAgent[]; conversations: Record<string, ChatMessage[]>; busy: Record<string, boolean>; typingIn: (channel: string, destination: string) => boolean;
  selectedAgent: string; selectedGroup: string; onAgent: (id: string, real?: RealAgent) => void; onViewAgent: (id: string, real?: RealAgent) => void; onGroup: (group: GroupChat) => void; mobile: boolean;
  agentsLoading: boolean; agentsFailed: boolean; agentsCursor: number | null; loadAgents: (after?: number) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [context, setContext] = useState<{ kind: 'dm'; agent: ChatAgent } | { kind: 'group'; group: GroupChat } | null>(null);
  const [editor, setEditor] = useState<{ group?: GroupChat } | null>(null);
  const [deleting, setDeleting] = useState<GroupChat | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const openingDelete = useRef(false);
  const groups = useGroups(search.trim());
  const matches = useInfiniteQuery({ queryKey: ['chat-agent-search', search.trim()], enabled: Boolean(search.trim()), initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await api.GET('/api/agents', { params: { query: { search: search.trim(), after: pageParam } }, signal });
      if (error || !data) throw new Error('Could not search chats.'); return data;
    }, getNextPageParam: page => page.nextCursor ?? undefined,
  });
  const people = search.trim() ? (matches.data?.pages.flatMap(page => page.agents).map(real => agents.find(agent => agent.id === real.id) ?? asAgent(real)) ?? []) : agents;
  const items = [
    ...people.map(agent => ({ kind: 'dm' as const, id: agent.id, name: agent.name, timestamp: conversations[agent.channelId]?.at(-1)?.timestamp ?? agent.real?.lastMessage?.timestamp ?? agent.real?.createdAt ?? 0, agent })),
    ...(groups.data?.pages.flatMap(page => page.groups) ?? []).map(group => ({ kind: 'group' as const, id: group.id, name: group.name, timestamp: group.lastMessage?.timestamp ?? group.createdAt, group })),
  ].filter(item => item.name.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => b.timestamp - a.timestamp || a.name.localeCompare(b.name));
  const loading = groups.isFetching || (search.trim() ? matches.isFetching : agentsLoading);
  const failed = groups.isError || (search.trim() ? matches.isError : agentsFailed);
  const more = groups.hasNextPage || (search.trim() ? matches.hasNextPage : agentsCursor !== null);
  const load = () => {
    if (groups.isError) void groups.refetch(); else if (groups.hasNextPage) void groups.fetchNextPage();
    if (search.trim()) { if (matches.isError) void matches.refetch(); else if (matches.hasNextPage) void matches.fetchNextPage(); }
    else if (agentsFailed || agentsCursor !== null) void loadAgents(agentsCursor ?? undefined);
  };
  // Match the Agents sidebar's Kibo context-menu-standard-1 composition.
  return <><ContextMenu.Root><ContextMenu.Trigger asChild><aside ref={panelRef} aria-label="Chats" tabIndex={0} className={cn('phone-list-enter min-h-0 w-full shrink-0 flex-col border-border bg-sidebar pb-[calc(5rem+env(safe-area-inset-bottom))] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:flex md:w-72 md:border-r md:pb-0', mobile ? 'hidden' : 'flex')}
    onContextMenuCapture={event => {
      const row = (event.target as HTMLElement).closest<HTMLElement>('[data-chat-kind][data-chat-id]');
      const item = items.find(item => item.kind === row?.dataset.chatKind && item.id === row?.dataset.chatId);
      setContext(item?.kind === 'dm' ? { kind: 'dm', agent: item.agent } : item?.kind === 'group' ? { kind: 'group', group: item.group } : null);
      returnFocus.current = row ?? (document.activeElement instanceof HTMLElement ? document.activeElement : panelRef.current);
    }}
    onKeyDown={event => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      event.preventDefault();
      const target = event.target as HTMLElement;
      const bounds = target.getBoundingClientRect();
      target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: bounds.left + 16, clientY: bounds.top + 16 }));
    }}
  >
    <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))] md:pt-3">
      <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-foreground/15 bg-[#262626] px-2.5 focus-within:ring-1 focus-within:ring-ring sm:h-8">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-3.5 shrink-0 text-muted-foreground"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" strokeLinecap="round" /></svg>
        <input type="search" aria-label="Search chats" placeholder="Search chats" maxLength={80} value={search} onChange={event => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground" />
      </div>
      <GroupEditor onSaved={onGroup}><Button variant="outline" size="sm" className="size-11 shrink-0 p-0 text-lg sm:size-8" aria-label="Create group chat" title="Create group chat">+</Button></GroupEditor>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
      {!items.length && !loading && !failed && <p role="status" className="px-2 py-4 text-xs text-muted-foreground">{search ? 'No chats found.' : 'Create an agent in Agents or start a group chat.'}</p>}
      <ul className="space-y-0.5">{items.map(item => {
        const selected = item.kind === 'group' ? item.id === selectedGroup : !selectedGroup && item.id === selectedAgent;
        const latest = item.kind === 'dm' ? conversations[item.agent.channelId]?.at(-1) : undefined;
        const preview = item.kind === 'group' ? `${item.group.lastMessage ? `${item.group.lastMessage.role === 'user' ? 'You' : item.group.lastMessage.authorName}: ${item.group.lastMessage.text}` : ''}` : latest?.text ?? item.agent.real?.lastMessage?.text ?? '';
        return <li key={`${item.kind}:${item.id}`}><button type="button" data-chat-kind={item.kind} data-chat-id={item.id} aria-label={`Open ${item.kind === 'group' ? 'group chat' : 'conversation with'} ${item.name}`} aria-current={selected ? 'true' : undefined} onClick={() => item.kind === 'group' ? onGroup(item.group) : onAgent(item.id, item.agent.real)} className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring', selected ? 'bg-foreground/10' : 'hover:bg-foreground/5')}>
          {item.kind === 'group' ? <GroupAvatar group={item.group} /> : <AgentAvatar initials={item.agent.initials} avatar={item.agent.avatar} size="md" ready={Boolean(item.agent.real)} working={busy[item.agent.channelId]} typing={typingIn(item.agent.channelId, item.agent.channelId)} />}
          <span className="min-w-0 flex-1"><span className="flex items-baseline justify-between gap-2"><span className="truncate text-sm font-medium">{item.name}</span><SlideUpFadeSwap className="shrink-0 text-[11px] text-muted-foreground" text={new Date(item.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} /></span><SlideUpFadeSwap renderText={renderMessagePreview} className="mt-0.5 block text-xs text-muted-foreground" prefix={item.kind === 'dm' && latest?.author === 'user' ? 'You: ' : ''} text={preview} /></span>
        </button></li>;
      })}</ul>
      {(loading || failed || more) && <Button variant="outline" size="sm" className="mt-3 w-full" disabled={loading} onClick={load}>{loading ? 'Loading chats…' : failed ? 'Retry loading chats' : 'Load more chats'}</Button>}
    </div>
    <div className="flex shrink-0 items-center gap-2.5 px-4 py-3"><span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-foreground/10 text-[11px]">YO</span><span className="text-sm font-medium">Your account</span></div>
  </aside></ContextMenu.Trigger>
    <ContextMenu.Portal><ContextMenu.Content className="context-menu-content phone-menu-targets z-50 min-w-48 rounded-lg border border-border bg-background p-1 shadow-lg" onCloseAutoFocus={event => { if (editor) event.preventDefault(); }}>
      <ContextMenu.Item onSelect={() => setEditor({})} className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-muted"><span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center text-lg leading-none text-muted-foreground">+</span>Create group chat</ContextMenu.Item>
      {context && <ContextMenu.Item onSelect={() => context.kind === 'group' ? onGroup(context.group) : onAgent(context.agent.id, context.agent.real)} className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-muted"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" className="size-4 shrink-0"><path d="M4 5h16v12H8l-4 3V5z" /></svg>Open chat</ContextMenu.Item>}
      {context?.kind === 'group' && <><ContextMenu.Item onSelect={() => setEditor({ group: context.group })} className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-muted"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-4 shrink-0"><path d="m15 5 4 4M5 15 16 4a2.8 2.8 0 0 1 4 4L9 19l-5 1z" strokeLinecap="round" strokeLinejoin="round" /></svg>Edit group chat</ContextMenu.Item><ContextMenu.Item onSelect={() => setDeleting(context.group)} className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-red-400 outline-none data-[highlighted]:bg-red-500/10"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg>Delete group chat</ContextMenu.Item></>}
      {context?.kind === 'dm' && <ContextMenu.Item onSelect={() => onViewAgent(context.agent.id, context.agent.real)} className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-muted"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="size-4 shrink-0"><circle cx="12" cy="8" r="3" /><path d="M5 20v-2a7 7 0 0 1 14 0v2" /></svg>View in Agents</ContextMenu.Item>}
    </ContextMenu.Content></ContextMenu.Portal>
  </ContextMenu.Root>
  {editor && <GroupEditor group={editor.group} open onOpenChange={open => { if (!open) { setEditor(null); requestAnimationFrame(() => { if (openingDelete.current) return; if (returnFocus.current?.isConnected && returnFocus.current.getClientRects().length) returnFocus.current.focus(); else panelRef.current?.focus(); }); } }} onDelete={editor.group ? () => { openingDelete.current = true; setDeleting(editor.group!); setEditor(null); } : undefined} onSaved={onGroup} />}
  {deleting && <DeleteGroupForm group={deleting} open onOpenChange={open => { if (!open) { setDeleting(null); openingDelete.current = false; requestAnimationFrame(() => { if (returnFocus.current?.isConnected && returnFocus.current.getClientRects().length) returnFocus.current.focus(); else panelRef.current?.focus(); }); } }} />}</>;
}
