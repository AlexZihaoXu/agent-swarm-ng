import { useState } from 'react';
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
import { SlideUpFadeSwap } from '@/components/ui/slide-up-fade-swap';
import { renderMessagePreview } from '@/components/message-markdown';
import { cn } from '@/lib/utils';

function GroupAvatar({ group }: { group: GroupChat }) {
  return <span aria-hidden="true" className="relative size-8 shrink-0">{group.members.slice(0, 3).map((member, index) => <span key={member.id} className="absolute" style={{ left: index === 1 ? 13 : index === 2 ? 6 : 0, top: index === 2 ? 13 : 0 }}><AgentAvatarArt {...(member.avatar ?? defaultAvatar(member.id))} size={20} /></span>)}{!group.members.length && <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">#</span>}</span>;
}
export function ChatPanel({ agents, conversations, busy, typingIn, selectedAgent, selectedGroup, onAgent, onGroup, mobile, agentsLoading, agentsFailed, agentsCursor, loadAgents }: {
  agents: ChatAgent[]; conversations: Record<string, ChatMessage[]>; busy: Record<string, boolean>; typingIn: (channel: string, destination: string) => boolean;
  selectedAgent: string; selectedGroup: string; onAgent: (id: string, real?: RealAgent) => void; onGroup: (group: GroupChat) => void; mobile: boolean;
  agentsLoading: boolean; agentsFailed: boolean; agentsCursor: number | null; loadAgents: (after?: number) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
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
  return <aside aria-label="Chats" className={cn('min-h-0 w-full shrink-0 flex-col border-border bg-sidebar sm:flex sm:w-72 sm:border-r', mobile ? 'hidden' : 'flex')}>
    <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3">
      <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-foreground/15 bg-[#262626] px-2.5 focus-within:ring-1 focus-within:ring-ring">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-3.5 shrink-0 text-muted-foreground"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" strokeLinecap="round" /></svg>
        <input type="search" aria-label="Search chats" placeholder="Search chats" maxLength={80} value={search} onChange={event => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground" />
      </div>
      <GroupEditor onSaved={onGroup}><Button variant="outline" size="sm" className="size-8 shrink-0 p-0 text-lg" aria-label="Create group chat" title="Create group chat">+</Button></GroupEditor>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
      {!items.length && !loading && !failed && <p role="status" className="px-2 py-4 text-xs text-muted-foreground">{search ? 'No chats found.' : 'Create an agent in Agents or start a group chat.'}</p>}
      <ul className="space-y-0.5">{items.map(item => {
        const selected = item.kind === 'group' ? item.id === selectedGroup : !selectedGroup && item.id === selectedAgent;
        const latest = item.kind === 'dm' ? conversations[item.agent.channelId]?.at(-1) : undefined;
        const preview = item.kind === 'group' ? `${item.group.lastMessage ? `${item.group.lastMessage.role === 'user' ? 'You' : item.group.lastMessage.authorName}: ${item.group.lastMessage.text}` : ''}` : latest?.text ?? item.agent.real?.lastMessage?.text ?? '';
        return <li key={`${item.kind}:${item.id}`}><button type="button" aria-label={`Open ${item.kind === 'group' ? 'group chat' : 'conversation with'} ${item.name}`} aria-current={selected ? 'true' : undefined} onClick={() => item.kind === 'group' ? onGroup(item.group) : onAgent(item.id, item.agent.real)} className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring', selected ? 'bg-foreground/10' : 'hover:bg-foreground/5')}>
          {item.kind === 'group' ? <GroupAvatar group={item.group} /> : <AgentAvatar initials={item.agent.initials} avatar={item.agent.avatar} ready working={busy[item.agent.channelId]} typing={typingIn(item.agent.channelId, item.agent.channelId)} />}
          <span className="min-w-0 flex-1"><span className="flex items-baseline justify-between gap-2"><span className="truncate text-sm font-medium">{item.name}</span><SlideUpFadeSwap className="shrink-0 text-[11px] text-muted-foreground" text={new Date(item.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} /></span><SlideUpFadeSwap renderText={renderMessagePreview} className="mt-0.5 block text-xs text-muted-foreground" prefix={item.kind === 'dm' && latest?.author === 'user' ? 'You: ' : ''} text={preview} /></span>
        </button></li>;
      })}</ul>
      {(loading || failed || more) && <Button variant="outline" size="sm" className="mt-3 w-full" disabled={loading} onClick={load}>{loading ? 'Loading chats…' : failed ? 'Retry loading chats' : 'Load more chats'}</Button>}
    </div>
    <div className="flex shrink-0 items-center gap-2.5 px-4 py-3"><span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-foreground/10 text-[11px]">YO</span><span className="text-sm font-medium">Your account</span></div>
  </aside>;
}
