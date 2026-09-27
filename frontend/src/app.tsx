import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { useLocation, useNavigate } from 'react-router';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AgentPanel } from '@/components/agent-panel';
import { KnowledgeBrowser } from '@/components/knowledge-browser';
import { EditAgentForm } from '@/components/edit-agent-form';
import { AgentAvatar, AgentName } from '@/components/chat-identity';
import { cn } from '@/lib/utils';
import { useChat, type ChatAgent } from '@/use-chat';
import type { ChatMessage } from '@/chat-types';
import { replyExcerpt } from '@/lib/reply-preview';
import { SlideUpFadeSwap } from '@/components/ui/slide-up-fade-swap';
import { renderMessagePreview } from '@/components/message-markdown';
import { useDmConversations } from '@/use-dm-conversations';
import { useDmInbox } from '@/use-dm-inbox';
import { AgentExchangeIcon } from '@/components/agent-exchange-icon';
import { AgentDmTranscript } from '@/components/agent-dm-transcript';
import { Select } from '@/components/ui/select';
import { ConversationMessages } from '@/components/conversation-messages';
import { isTypingInConversation } from '@/lib/conversation-typing';
import { conversationTimeline } from '@/lib/conversation-timeline';
import { Settings } from '@/components/settings';
import { ComputersPanel } from '@/components/computers-panel';
import { AgentTypingStatus } from '@/components/agent-typing-status';
import { AvatarFace, PresenceIndicator } from '@/components/typing-indicator';
import { AgentActivityPanel } from '@/components/agent-activity-panel';
import { AgentAvatarArt } from '@/components/agent-avatar-art';
import { defaultAvatar, type AvatarAppearance } from '@/lib/agent-avatar';
import { ChatPanel } from '@/components/chat-panel';
import { GroupConversation } from '@/components/group-conversation';
import { ChatComposer } from '@/components/chat-composer';
import { useGroupEvents } from '@/use-groups';
import { agentDmPath, agentPath, chatAgentDmPath, chatAgentPath, chatGroupPath, computerPath, parseDashboardPath } from '@/lib/dashboard-location';

function Avatar({ initials, avatar, small = false, typing = false, ready = false, working = false }: { initials: string; avatar?: AvatarAppearance; small?: boolean; typing?: boolean; ready?: boolean; working?: boolean }) {
  return (
    <span aria-hidden="true" className={cn(
      'relative shrink-0 font-medium text-foreground/75',
      small ? 'size-7 text-[11px]' : 'size-8 text-xs',
    )}>
      <AvatarFace avatarSize={small ? 28 : 32} ready={ready} typing={typing} working={working} size="md">
        {avatar ? <AgentAvatarArt {...avatar} size={small ? 28 : 32} state={typing ? 'typing' : working ? 'working' : 'idle'} animated /> : <span className="absolute inset-0 flex items-center justify-center rounded-full bg-foreground/10">{initials}</span>}
      </AvatarFace>
      <PresenceIndicator ready={ready} typing={typing} working={working} size="md" />
    </span>
  );
}

const emptyAgent: ChatAgent = { id: '', name: '', initials: '', time: '', channelId: '' };

export function App() {
  const { agents, conversations, drafts, busy, typing, typingTargets, activity, addAgent, deleteAgent, editAvatar, send, stop, setDraft, eventsConnected,
    agentsLoading, agentsFailed, agentsCursor, loadAgents, historyReady, historyLoading, historyFailed, historyCursor, loadHistory,
  } = useChat();
  const location = useLocation();
  const navigate = useNavigate();
  const route = parseDashboardPath(location.pathname);
  const activeTab = route.tab;
  const selectedGroup = route.groupId ?? '';
  const selectedId = route.agentId ?? agents[0]?.id ?? '';
  const mobileConversation = Boolean(route.agentId || route.groupId);
  const computerViewerOpen = route.kind === 'computer';
  const [isPhone, setIsPhone] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const pendingTabPath = useRef('');
  const focusAgentsAfterDelete = useRef(false);
  useEffect(() => {
    if (!focusAgentsAfterDelete.current || route.tab !== 'agents' || route.kind === 'not-found') return;
    const frame = requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>('aside[aria-label="Agents"]');
      if (panel) { panel.focus(); focusAgentsAfterDelete.current = false; }
    });
    return () => cancelAnimationFrame(frame);
  }, [route.kind, agents.length]);
  const changeTab = (value: string) => {
    const target = value === 'agents' ? !isPhone && selectedId ? agentPath(selectedId) : '/agents'
      : value === 'chat' ? !isPhone && selectedId ? chatAgentPath(selectedId) : '/chat'
        : value === 'computers' ? '/computers' : '/settings';
    if (value === activeTab || window.location.pathname === target || pendingTabPath.current === target) return;
    pendingTabPath.current = target;
    navigate(target);
  };
  useEffect(() => { pendingTabPath.current = ''; }, [location.pathname]);
  useEffect(() => {
    if (route.kind === 'root') navigate('/agents', { replace: true });
    else if (!isPhone && !agentsLoading && agents[0] && (route.kind === 'agents-list' || route.kind === 'chat-list'))
      navigate(route.kind === 'chat-list' ? chatAgentPath(agents[0].id) : agentPath(agents[0].id), { replace: true });
  }, [route.kind, isPhone, agentsLoading, agents, navigate]);
  useEffect(() => {
    if (!route.agentId || agents.some(item => item.id === route.agentId) || agentsLoading || agentsFailed || agentsCursor === null) return;
    void loadAgents(agentsCursor);
  }, [route.agentId, agents, agentsLoading, agentsFailed, agentsCursor]);
  // Old Agents peer bookmarks now open their conversation in Chat.
  useEffect(() => {
    if (route.kind === 'agent-dm' && route.agentId && route.peerId) navigate(chatAgentDmPath(route.agentId, route.peerId), { replace: true });
  }, [route.kind, route.agentId, route.peerId, navigate]);
  useGroupEvents();
  const deletedGroup = useRef('');
  useEffect(() => {
    const deleted = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      deletedGroup.current = id;
      if (parseDashboardPath(window.location.pathname).groupId === id) navigate('/chat', { replace: true });
    };
    window.addEventListener('swarm-group-deleted', deleted);
    return () => window.removeEventListener('swarm-group-deleted', deleted);
  }, [navigate]);
  useEffect(() => {
    if (selectedGroup && deletedGroup.current === selectedGroup) navigate('/chat', { replace: true });
  }, [selectedGroup, navigate]);
  const [search, setSearch] = useState('');
  const [activityOpen, setActivityOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingSend = useRef<string | null>(null);
  const [replyTargets, setReplyTargets] = useState<Record<string, ChatMessage>>({});
  const pendingReplyAcks = useRef(new Map<string, { channelId: string; targetId: string }>());
  const visibleAgents = agents.filter(item => item.name.toLowerCase().includes(search.trim().toLowerCase()));
  const agent = route.agentId ? agents.find(item => item.id === route.agentId) ?? emptyAgent : agents[0] ?? emptyAgent;
  const narrowDetail = (activeTab === 'agents' || activeTab === 'chat') && mobileConversation && Boolean(selectedGroup || agent.id);
  const inbox = useDmInbox(agent.id);
  const dmConversations = useDmConversations(agent.id);
  const [conversation, setConversation] = useState<{ owner: string; peer: string; selected?: { id: string; name: string; avatar?: AvatarAppearance | null; channelId?: string } }>({ owner: '', peer: 'you' });
  const conversationPeer = route.kind === 'agent-dm' || route.kind === 'chat-agent-dm' ? route.peerId ?? 'you' : 'you';
  const chooseConversation = (nextPeer: string) => {
    setConversation({ owner: agent.id, peer: nextPeer, selected: peers.find(item => item.id === nextPeer) });
    navigate(activeTab === 'chat'
      ? nextPeer === 'you' ? chatAgentPath(agent.id) : chatAgentDmPath(agent.id, nextPeer)
      : nextPeer === 'you' ? agentPath(agent.id) : agentDmPath(agent.id, nextPeer));
  };
  // Keep an already-open peer visible when the refreshed sidebar is paginated.
  const selectedPeer = conversation.owner === agent.id && conversation.peer === conversationPeer ? conversation.selected : undefined;
  const peers = [...new Map([...(selectedPeer ? [selectedPeer] : []), ...inbox.messages.map(message => ({ id: message.senderId, name: message.senderName, avatar: message.senderAvatar, channelId: undefined as string | undefined })), ...dmConversations.peers].filter(peer => peer.id !== agent.id).map(peer => [peer.id, peer])).values()].map(peer => agents.find(item => item.id === peer.id) ?? peer);
  const peer = peers.find(item => item.id === conversationPeer) ?? agents.find(item => item.id === conversationPeer);
  const peerRecord = agents.find(item => item.id === conversationPeer);
  const peerChannel = peerRecord?.channelId ?? peer?.channelId ?? '';
  useEffect(() => {
    if (conversationPeer === 'you' || peer || dmConversations.busy || dmConversations.failed || agentsLoading) return;
    if (dmConversations.cursor !== null) void dmConversations.load(dmConversations.cursor);
  }, [agent.id, conversationPeer, peer, dmConversations.busy, dmConversations.failed, dmConversations.cursor, agentsLoading]);
  const typingIn = (channelId: string, destination: string) => isTypingInConversation(typing[channelId], typingTargets[channelId], destination, eventsConnected);
  const visibleChannel = conversationPeer === 'you' ? agent.channelId : `dm:${[agent.id, conversationPeer].sort().join(':')}`;
  const selfTyping = typingIn(agent.channelId, visibleChannel);
  const peerTyping = typingIn(peerChannel, visibleChannel);
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW();
  const draft = drafts[agent.channelId] ?? '';
  const messages = conversations[agent.channelId] ?? [];
  const timeline = conversationTimeline(messages, inbox.messages);
  const previousConversation = useRef({ id: agent.id, viewport: null as HTMLDivElement | null, count: timeline.length, first: timeline[0]?.id, last: timeline.at(-1)?.id, height: 0 });

  useEffect(() => { void loadHistory(agent); }, [agent.id]);
  // The URL owns list/detail state across refresh and viewport changes.
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const onChange = (event: MediaQueryListEvent) => setIsPhone(event.matches);
    setIsPhone(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  useEffect(() => {
    for (const [id, pending] of pendingReplyAcks.current) {
      if (!conversations[pending.channelId]?.some(message => message.id === id && message.sequence !== undefined)) continue;
      pendingReplyAcks.current.delete(id);
      setReplyTargets(current => {
        if (current[pending.channelId]?.id !== pending.targetId) return current;
        const next = { ...current }; delete next[pending.channelId]; return next;
      });
    }
  }, [conversations]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 128)}px`;
  }, [draft, agent.id, activeTab, mobileConversation, activityOpen, conversationPeer]);

  useLayoutEffect(() => {
    if (conversationPeer !== 'you') return;
    const scroller = scrollRef.current;
    // A hidden phone pane has no usable scroll position. Wait until it opens.
    if (!scroller?.clientHeight) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const previous = previousConversation.current;
    const newViewport = previous.viewport !== scroller;
    const addedMessage = previous.id === agent.id && timeline.length > previous.count;
    const prepended = !newViewport && addedMessage && previous.first && previous.first !== timeline[0]?.id && previous.last === timeline.at(-1)?.id;
    const sentId = pendingSend.current;
    if (prepended) scroller.scrollTop += scroller.scrollHeight - previous.height;
    else if (newViewport || addedMessage && (Boolean(sentId) || previous.height - scroller.scrollTop - scroller.clientHeight < 80)) {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: addedMessage && !newViewport && !reducedMotion ? 'smooth' : 'instant' });
    }
    previousConversation.current = { id: agent.id, viewport: scroller, count: timeline.length, first: timeline[0]?.id, last: timeline.at(-1)?.id, height: scroller.scrollHeight };

    pendingSend.current = null;
    if (!sentId || reducedMotion) return;
    const bubble = scroller.querySelector<HTMLElement>(`[data-message-id="${sentId}"]`);
    const input = inputRef.current;
    if (!bubble || !input) return;
    const rise = Math.max(12, input.getBoundingClientRect().top - bubble.getBoundingClientRect().top);
    bubble.animate([
      { opacity: 0, transform: `translateY(${rise}px) scale(0.45)` },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ], { duration: 360, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
  }, [agent.id, timeline.length, activeTab, mobileConversation, conversationPeer]);

  function sendMessage() {
    if (conversationPeer !== 'you') return;
    const target = replyTargets[agent.channelId];
    const messageId = send(agent, draft, target ? { id: target.id, role: target.author === 'user' ? 'user' : 'assistant', text: replyExcerpt(target.text) } : undefined);
    if (!messageId) return;
    if (target) pendingReplyAcks.current.set(messageId, { channelId: agent.channelId, targetId: target.id });
    pendingSend.current = messageId;
    inputRef.current?.focus();
  }

  if (route.kind === 'not-found' || route.agentId && !agentsLoading && !agentsFailed && agentsCursor === null && !agents.some(item => item.id === route.agentId))
    return <main className="p-8">Page not found. <a href="/agents">Return to agents</a></main>;

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
      <h1 className="sr-only">Agent Swarm NG</h1>
      <Tabs.Root value={activeTab} onValueChange={changeTab} className="flex min-h-0 flex-1 flex-col">
        {!computerViewerOpen && <header className={cn('pointer-events-none fixed inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 flex justify-center md:pointer-events-auto md:relative md:inset-auto md:order-first md:h-14 md:min-h-14 md:shrink-0 md:items-center md:border-b md:border-border md:bg-sidebar md:px-4', narrowDetail && 'max-md:hidden')}>
          {/* Basic Tabs composition: Kibo tabs/standard/tabs-standard-1, floating without a footer on phones. */}
          <Tabs.List aria-label="Main navigation" className="pointer-events-auto relative isolate grid h-[50px] w-[min(23rem,calc(100vw-2rem))] grid-cols-4 items-center rounded-lg border border-border bg-muted p-[3px] shadow-lg md:h-9 md:w-96 md:border-0 md:p-1 md:shadow-none">
            <span aria-hidden="true" data-testid="tab-indicator" className="pointer-events-none absolute inset-y-[3px] left-[3px] w-[calc((100%-6px)/4)] rounded-md bg-background shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none md:inset-y-1 md:left-1 md:w-[calc((100%-8px)/4)]" style={{ transform: `translateX(${['agents', 'chat', 'computers', 'settings'].indexOf(activeTab) * 100}%)` }} />
            {['Agents', 'Chat', 'Computers', 'Settings'].map(label => (
              <Tabs.Trigger key={label} value={label.toLowerCase()} className="relative z-10 min-h-11 min-w-0 rounded-md px-1 py-1 text-[11px] font-medium md:min-h-0 md:px-3 md:text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:text-foreground">
                {label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </header>}

        <Tabs.Content value={activeTab === 'chat' ? 'chat' : 'agents'} className="min-h-0 flex-1 outline-none data-[state=active]:flex">
          {activeTab === 'chat' ? <ChatPanel route={route} onNavigate={navigate} agents={agents} conversations={conversations} busy={busy} typingIn={typingIn} selectedAgent={agent.id} selectedGroup={selectedGroup} mobile={mobileConversation} agentsLoading={agentsLoading} agentsFailed={agentsFailed} agentsCursor={agentsCursor} loadAgents={loadAgents} onAgent={(id, real) => { if (real && !agents.some(agent => agent.id === id)) addAgent(real, false); navigate(chatAgentPath(id)); }} onViewAgent={(id, real) => { if (real && !agents.some(agent => agent.id === id)) addAgent(real, false); navigate(agentPath(id)); }} onGroup={group => { navigate(chatGroupPath(group.id)); setActivityOpen(false); }}  /> : <AgentPanel agents={agents} route={route} onNavigate={navigate} onDeleted={() => { focusAgentsAfterDelete.current = true; navigate('/agents'); }} onDelete={async (target, confirmation) => {
            await deleteAgent(target, confirmation);
            setReplyTargets(current => { const next = { ...current }; delete next[target.channelId]; return next; });
            if (agent.id === target.id) setActivityOpen(false);
          }} onCreated={real => { addAgent(real); navigate(agentPath(real.id)); setSearch(''); }} className={cn(
            'phone-list-enter min-h-0 w-full shrink-0 flex-col border-border bg-sidebar pb-[calc(5rem+env(safe-area-inset-bottom))] md:flex md:w-72 md:border-r md:pb-0',
            mobileConversation ? 'hidden' : 'flex',
          )}>
            {/* Search-with-icon composition: Kibo input-group/icons/input-group-icons-1. */}
            <div className="shrink-0 px-4 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))] md:pt-3">
              <div className="flex h-11 items-center gap-2 rounded-lg border border-foreground/15 bg-[#262626] px-2.5 focus-within:ring-1 focus-within:ring-ring sm:h-8">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-3.5 shrink-0 text-muted-foreground"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" strokeLinecap="round" /></svg>
                <input type="search" aria-label="Search agents" placeholder="Search agents" value={search} onChange={event => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground" />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
              {visibleAgents.length === 0 && !agentsLoading && !agentsFailed && <p role="status" className="px-2 py-4 text-xs text-muted-foreground">{search.trim() ? 'No agents found.' : 'No agents yet. Right-click here to create one.'}</p>}
              <ul className="space-y-0.5">
                {visibleAgents.map(item => {
                  const lastMessage = conversations[item.channelId]?.at(-1);
                  return (
                  <li key={item.id}>
                    <button
                      type="button"
                      data-agent-id={item.id}
                      aria-label={`Open settings for ${item.name}`}
                      aria-current={item.id === agent.id ? 'true' : undefined}
                      onClick={() => navigate(agentPath(item.id))}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                        item.id === agent.id ? 'bg-foreground/10' : 'hover:bg-foreground/5',
                      )}
                    >
                      <Avatar initials={item.initials} avatar={item.avatar} ready={Boolean(item.real)} typing={typingIn(item.channelId, item.channelId)} working={busy[item.channelId]} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium">{item.name}</span>
                          <SlideUpFadeSwap className="shrink-0 text-[11px] text-muted-foreground" text={lastMessage?.time ?? item.time} />
                        </span>
                        <SlideUpFadeSwap renderText={renderMessagePreview} className="mt-0.5 block text-xs text-muted-foreground" prefix={lastMessage?.author === 'user' ? 'You: ' : ''} text={lastMessage?.text ?? ''} />
                      </span>
                    </button>
                  </li>
                  );
                })}
              </ul>
              {(agentsLoading || agentsFailed || agentsCursor !== null) && <Button variant="outline" size="sm" className="mt-3 w-full" disabled={agentsLoading} onClick={() => void loadAgents(agentsCursor ?? undefined)}>{agentsLoading ? 'Loading agents…' : agentsFailed ? 'Retry loading agents' : 'Load more agents'}</Button>}
            </div>
            <div className="flex shrink-0 items-center gap-2.5 px-4 py-3">
              <Avatar initials="YO" small />
              <span className="text-sm font-medium">Your account</span>
            </div>
          </AgentPanel>}

          {activeTab === 'agents' ? (agent.id && route.kind !== 'agent-dm' && route.kind !== 'agent-new' && route.kind !== 'agent-delete'
            ? <EditAgentForm key={agent.id} agent={agent} route={route} mobile={mobileConversation} onNavigate={navigate} onSave={editAvatar} onBack={() => { focusAgentsAfterDelete.current = true; navigate('/agents'); }} />
            : <section aria-label="No agent selected" className="hidden min-w-0 flex-1 items-center justify-center p-6 text-sm text-muted-foreground md:flex">Select or create an agent to configure.</section>)
            : selectedGroup ? <GroupConversation key={selectedGroup} groupId={selectedGroup} modal={route.kind === 'group-edit' ? 'edit' : route.kind === 'group-delete' ? 'delete' : null} returnTo={location.state?.returnTo === '/chat' ? '/chat' : chatGroupPath(selectedGroup)} onNavigate={navigate} mobile={mobileConversation} onBack={() => navigate('/chat')} draft={drafts[`group:${selectedGroup}`] ?? ''} onDraft={text => setDraft(`group:${selectedGroup}`, text)} typingIn={typingIn} /> : agents.length > 0 ? <section aria-label={`Conversation with ${agent.name}`} className={cn(
            'phone-detail-enter min-h-0 min-w-0 flex-1 flex-col transition-[margin] duration-200 motion-reduce:transition-none md:flex',
            activityOpen && 'lg:mr-96',
            mobileConversation ? 'flex' : 'hidden',
          )}>
            <header className="flex min-h-11 shrink-0 flex-nowrap items-center gap-x-1 border-b border-border px-4 pb-1.5 pt-[calc(0.375rem+env(safe-area-inset-top))] md:flex-wrap md:gap-x-2 md:gap-y-1.5">
              {isPhone ? <button type="button" aria-label="Back to chats" title="Back to chats" onClick={() => navigate('/chat')} className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-1 overflow-hidden text-left outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"><AgentAvatar initials={agent.initials} avatar={agent.avatar} ready={Boolean(agent.real)} typing={selfTyping} working={busy[agent.channelId]} /><span role="heading" aria-level={2} className="min-w-0 truncate text-sm font-semibold" title={agent.name}>{agent.name}</span></button> : <>
                <AgentAvatar initials={agent.initials} avatar={agent.avatar} ready={Boolean(agent.real)} typing={selfTyping} working={busy[agent.channelId]} />
                <div className="flex min-w-0 flex-1 items-center gap-2 md:flex-[1_1_9rem]">
                  {conversationPeer !== 'you' && peer ? <><AgentName name={agent.name} /><AgentExchangeIcon /><AgentAvatar initials={peer.name.slice(0, 2).toUpperCase()} avatar={peer.avatar ?? defaultAvatar(peer.id)} ready={Boolean(peer)} working={busy[peerChannel]} typing={peerTyping} /><span className="min-w-0 truncate text-sm font-semibold" title={peer.name}>{peer.name}</span></> : <AgentName name={agent.name} />}
                </div>
              </>}
              {isPhone && <AgentExchangeIcon />}
              <div className="ml-auto flex shrink-0 items-center gap-1 md:gap-2">
                <div className="flex items-center gap-2">
                  <label htmlFor="agent-dm-conversation" className="hidden whitespace-nowrap text-xs text-muted-foreground md:inline">Chat with</label>
                  <div className="w-[clamp(5.5rem,34vw,8rem)] md:w-36"><Select id="agent-dm-conversation" ariaLabel="Chat with" value={conversationPeer} onValueChange={value => { if (value === 'load-more') void dmConversations.load(dmConversations.failed ? undefined : dmConversations.cursor ?? undefined); else chooseConversation(value); }} options={[{ value: 'you', label: 'You' }, ...peers.map(peer => ({ value: peer.id, label: peer.name === 'You' ? 'You (agent)' : peer.name, icon: <AgentAvatarArt {...(peer.avatar ?? defaultAvatar(peer.id))} size={20} /> })), ...(dmConversations.cursor !== null || dmConversations.failed ? [{ value: 'load-more', label: dmConversations.busy ? 'Loading conversations…' : dmConversations.failed ? 'Retry conversations' : 'More conversations…' }] : [])]} triggerClassName="!h-11 !w-full !justify-between !px-3 !text-sm md:!h-7 md:!min-h-0 md:!px-2 md:!text-xs" contentClassName="min-w-52 md:min-w-0" triggerContent={isPhone ? <><span className="min-w-0 flex-1 truncate">{peer?.name ?? 'You'}</span><svg aria-hidden="true" viewBox="0 0 12 12" className="size-3 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m2 4 4 4 4-4" /></svg></> : <><span className="flex min-w-0 items-center gap-1">{peer && <AgentAvatarArt {...(peer.avatar ?? defaultAvatar(peer.id))} size={20} />}<span className="min-w-0 truncate">{peer?.name ?? 'You'}</span></span><svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m6 9 6 6 6-6" /></svg></>} /></div>
                </div>
                <AgentActivityPanel agent={agent} entries={activity[agent.id] ?? []} open={activityOpen} onOpenChange={setActivityOpen} />
              </div>
            </header>

            <ScrollArea key={`${agent.id}:${conversationPeer}`} viewportRef={scrollRef} label="Chat history" className="min-h-0 flex-1" viewportClassName="[&>div]:!block [&>div]:w-full">
              {conversationPeer === 'you' ? <>
              {(historyLoading[agent.channelId] || historyFailed[agent.channelId] || historyCursor[agent.channelId] != null) && <div className="px-5 pt-3 text-center"><Button variant="outline" size="sm" disabled={historyLoading[agent.channelId] || busy[agent.channelId]} onClick={() => void loadHistory(agent, Boolean(historyReady[agent.channelId]))}>{historyLoading[agent.channelId] ? 'Loading messages…' : historyFailed[agent.channelId] ? 'Retry loading messages' : 'Load earlier messages'}</Button></div>}
              {(inbox.failed || inbox.cursor !== null) && <div className="px-5 pt-3 text-center"><Button variant="outline" size="sm" disabled={inbox.busy} onClick={() => void inbox.load(inbox.failed ? undefined : inbox.cursor ?? undefined)}>{inbox.failed ? 'Retry agent messages' : 'Earlier agent messages'}</Button></div>}
              {historyReady[agent.channelId] && <ConversationMessages reactionChannel={agent.channelId} messages={messages} time={agent.time} agentName={agent.name} notices={inbox.messages} onViewDm={notice => chooseConversation(notice.senderId)} onReply={message => { setReplyTargets(current => ({ ...current, [agent.channelId]: message })); requestAnimationFrame(() => inputRef.current?.focus()); }} />}
              </> : peer ? <AgentDmTranscript key={`${agent.id}:${peer.id}`} agentId={agent.id} peerId={peer.id} bubbleView={{ agentName: agent.name, peerName: peer.name, agentAvatar: agent.avatar ?? defaultAvatar(agent.id), peerAvatar: peer.avatar ?? defaultAvatar(peer.id), viewport: scrollRef }} /> : <p className="p-5 text-sm text-muted-foreground">This agent is no longer available.</p>}
            </ScrollArea>

            {conversationPeer === 'you' ? <div className="shrink-0 pl-[calc(1.5rem+env(safe-area-inset-left))] pr-[calc(1.5rem+env(safe-area-inset-right))] pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 sm:px-5 sm:pb-3">
              <div className="w-full">
                <div className="mb-1 flex h-5 min-w-0 items-center px-2">
                  <AgentTypingStatus name={agent.name} typing={selfTyping} working={busy[agent.channelId]} connected={eventsConnected} />
                </div>
                <ChatComposer key={agent.id} name={agent.name} draft={draft} onChange={text => setDraft(agent.channelId, text)} onSend={sendMessage} busy={busy[agent.channelId]} onStop={() => stop(agent.channelId)} disabled={historyLoading[agent.channelId] || (Boolean(agent.real) && !historyReady[agent.channelId])} inputRef={inputRef} reply={replyTargets[agent.channelId] ? { author: replyTargets[agent.channelId].author === 'user' ? 'You' : agent.name, text: replyExcerpt(replyTargets[agent.channelId].text) } : undefined} onCancelReply={() => { setReplyTargets(current => { const next = { ...current }; delete next[agent.channelId]; return next; }); inputRef.current?.focus(); }} />
              </div>
            </div> : <div aria-label="Agent conversation status" className="shrink-0 border-t border-border px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:py-3">
              {selfTyping || peerTyping ? <div className="flex min-h-5 items-center gap-3"><div className="flex min-w-0 flex-1"><AgentTypingStatus name={agent.name} typing={selfTyping} /></div><div className="flex min-w-0 flex-1 justify-end"><AgentTypingStatus name={peer?.name ?? 'Agent'} typing={peerTyping} /></div></div> : <p className="text-center text-xs text-muted-foreground">Agent-to-agent conversation · messages are sent by the agents</p>}
            </div>}
          </section> : <section aria-label="No agent selected" className="hidden min-w-0 flex-1 items-center justify-center p-6 text-sm text-muted-foreground md:flex">Select or create an agent to start chatting.</section>}
        </Tabs.Content>

        <Tabs.Content value="computers" className="min-h-0 flex-1 outline-none data-[state=active]:flex">
          <ComputersPanel viewingId={route.kind === 'computer' ? route.computerId ?? null : null} dialog={route.kind === 'computer-new' ? 'new' : route.kind === 'computer-delete' ? 'delete' : route.kind === 'computer-settings' ? 'settings' : null} deleteId={route.kind === 'computer-delete' ? route.computerId ?? null : null} settingsId={route.kind === 'computer-settings' ? route.computerId ?? null : null} onOpen={id => navigate(computerPath(id))} onNavigate={navigate} onBack={() => navigate('/computers')} />
        </Tabs.Content>
        <Tabs.Content value="settings" forceMount className={cn('phone-tab-enter min-h-0 flex-1 outline-none data-[state=inactive]:hidden', route.kind === 'knowledge' ? 'overflow-hidden data-[state=active]:flex data-[state=active]:flex-col' : 'overflow-y-auto pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0')}>
          <div className={route.kind === 'knowledge' ? 'hidden' : ''}><Settings route={route} onNavigate={navigate} /></div>
          {route.kind === 'knowledge' && <KnowledgeBrowser id={route.knowledgeId} onNavigate={navigate} />}
        </Tabs.Content>
      </Tabs.Root>

      {needRefresh && (
        <aside aria-label="Application update" className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border px-5 py-3 text-sm">
          <p className="mr-auto">An update is ready.</p>
          <Button size="sm" onClick={() => void updateServiceWorker(true)}>Reload</Button>
          <Button variant="outline" size="sm" onClick={() => setNeedRefresh(false)}>Later</Button>
        </aside>
      )}
    </main>
  );
}
