import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AgentPanel } from '@/components/agent-panel';
import { AgentAvatar, AgentName } from '@/components/chat-identity';
import { cn } from '@/lib/utils';
import { useChat, type ChatAgent } from '@/use-chat';
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
import { AgentTypingStatus } from '@/components/agent-typing-status';
import { AvatarFace, PresenceIndicator } from '@/components/typing-indicator';
import { AgentActivityPanel } from '@/components/agent-activity-panel';
import { AgentAvatarArt } from '@/components/agent-avatar-art';
import { defaultAvatar, type AvatarAppearance } from '@/lib/agent-avatar';
import { ChatPanel } from '@/components/chat-panel';
import { GroupConversation } from '@/components/group-conversation';
import { ChatComposer } from '@/components/chat-composer';
import { useGroupEvents } from '@/use-groups';

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
  const [selectedId, setSelectedId] = useState<string>(agents[0]?.id ?? '');
  const [mobileConversation, setMobileConversation] = useState(false);
  const [activeTab, setActiveTab] = useState('agents');
  const [selectedGroup, setSelectedGroup] = useState('');
  useGroupEvents();
  const [search, setSearch] = useState('');
  const [activityOpen, setActivityOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingSend = useRef<string | null>(null);
  const visibleAgents = agents.filter(item => item.name.toLowerCase().includes(search.trim().toLowerCase()));
  const agent = agents.find(item => item.id === selectedId) ?? agents[0] ?? emptyAgent;
  const inbox = useDmInbox(agent.id);
  const dmConversations = useDmConversations(agent.id);
  const [conversation, setConversation] = useState<{ owner: string; peer: string; selected?: { id: string; name: string; avatar?: AvatarAppearance | null; channelId?: string } }>({ owner: '', peer: 'you' });
  const conversationPeer = activeTab !== 'chat' && conversation.owner === agent.id ? conversation.peer : 'you';
  const chooseConversation = (peer: string) => setConversation({ owner: agent.id, peer, selected: peers.find(item => item.id === peer) });
  // Keep an already-open conversation visible if a refresh returns only the first page.
  const selectedPeer = conversation.owner === agent.id && dmConversations.cursor !== null ? conversation.selected : undefined;
  const peers = [...new Map([...(selectedPeer ? [selectedPeer] : []), ...inbox.messages.map(message => ({ id: message.senderId, name: message.senderName, avatar: message.senderAvatar, channelId: undefined as string | undefined })), ...dmConversations.peers].filter(peer => peer.id !== agent.id).map(peer => [peer.id, peer])).values()].map(peer => agents.find(item => item.id === peer.id) ?? peer);
  const peer = peers.find(item => item.id === conversationPeer);
  const peerRecord = agents.find(item => item.id === conversationPeer);
  const peerChannel = peerRecord?.channelId ?? peer?.channelId ?? '';
  useEffect(() => {
    if (conversationPeer !== 'you' && !peer && !dmConversations.busy && !dmConversations.failed) chooseConversation('you');
  }, [agent.id, conversationPeer, peer, dmConversations.busy, dmConversations.failed]);
  const typingIn = (channelId: string, destination: string) => isTypingInConversation(typing[channelId], typingTargets[channelId], destination, eventsConnected);
  const visibleChannel = conversationPeer === 'you' ? agent.channelId : `dm:${[agent.id, conversationPeer].sort().join(':')}`;
  const selfTyping = typingIn(agent.channelId, visibleChannel);
  const peerTyping = typingIn(peerChannel, visibleChannel);
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW();
  const draft = drafts[agent.channelId] ?? '';
  const messages = conversations[agent.channelId] ?? [];
  const timeline = conversationTimeline(messages, inbox.messages);
  const previousConversation = useRef({ id: agent.id, count: timeline.length, first: timeline[0]?.id, last: timeline.at(-1)?.id, height: 0 });

  useEffect(() => { void loadHistory(agent); }, [agent.id]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 128)}px`;
  }, [draft, agent.id, activeTab, mobileConversation, activityOpen, conversationPeer]);

  useLayoutEffect(() => {
    if (conversationPeer !== 'you') return;
    const scroller = scrollRef.current;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const previous = previousConversation.current;
    const addedMessage = previous.id === agent.id && timeline.length > previous.count;
    const prepended = addedMessage && previous.first && previous.first !== timeline[0]?.id && previous.last === timeline.at(-1)?.id;
    if (scroller && prepended) scroller.scrollTop += scroller.scrollHeight - previous.height;
    else scroller?.scrollTo({ top: scroller.scrollHeight, behavior: addedMessage && !reducedMotion ? 'smooth' : 'instant' });
    previousConversation.current = { id: agent.id, count: timeline.length, first: timeline[0]?.id, last: timeline.at(-1)?.id, height: scroller?.scrollHeight ?? 0 };

    const sentId = pendingSend.current;
    pendingSend.current = null;
    if (!sentId || !scroller || reducedMotion) return;
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
    const messageId = send(agent, draft);
    if (!messageId) return;
    pendingSend.current = messageId;
    inputRef.current?.focus();
  }

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
      <h1 className="sr-only">Agent Swarm NG</h1>
      <Tabs.Root value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
        <header className="relative flex h-14 shrink-0 items-center justify-center border-b border-border bg-sidebar px-4">
          {/* Basic Tabs composition: Kibo tabs/standard/tabs-standard-1. */}
          <Tabs.List aria-label="Main navigation" className="relative isolate grid h-9 w-72 grid-cols-3 items-center rounded-lg bg-muted p-1">
            <span aria-hidden="true" data-testid="tab-indicator" className="pointer-events-none absolute inset-y-1 left-1 w-[calc((100%-8px)/3)] rounded-md bg-background shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none" style={{ transform: `translateX(${['agents', 'chat', 'settings'].indexOf(activeTab) * 100}%)` }} />
            {['Agents', 'Chat', 'Settings'].map(label => (
              <Tabs.Trigger key={label} value={label.toLowerCase()} className="relative z-10 rounded-md px-3 py-1 text-sm font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:text-foreground">
                {label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </header>

        <Tabs.Content value={activeTab === 'chat' ? 'chat' : 'agents'} className="min-h-0 flex-1 outline-none data-[state=active]:flex">
          {activeTab === 'chat' ? <ChatPanel agents={agents} conversations={conversations} busy={busy} typingIn={typingIn} selectedAgent={agent.id} selectedGroup={selectedGroup} mobile={mobileConversation} agentsLoading={agentsLoading} agentsFailed={agentsFailed} agentsCursor={agentsCursor} loadAgents={loadAgents} onAgent={(id, real) => { if (real && !agents.some(agent => agent.id === id)) addAgent(real, false); setSelectedId(id); setSelectedGroup(''); setMobileConversation(true); }} onViewAgent={(id, real) => { if (real && !agents.some(agent => agent.id === id)) addAgent(real, false); setSelectedId(id); setSelectedGroup(''); setMobileConversation(true); setActiveTab('agents'); }} onGroup={group => { setSelectedGroup(group.id); setMobileConversation(true); setActivityOpen(false); }} /> : <AgentPanel agents={agents} onEditAvatar={editAvatar} onDelete={async (target, confirmation) => {
            await deleteAgent(target, confirmation);
            if (agent.id === target.id) {
              setSelectedId(agents.find(item => item.id !== target.id)?.id ?? '');
              setActivityOpen(false); setMobileConversation(false);
            }
          }} onCreated={real => { addAgent(real); setSelectedId(real.id); setSearch(''); setMobileConversation(true); }} className={cn(
            'min-h-0 w-full shrink-0 flex-col border-border bg-sidebar sm:flex sm:w-72 sm:border-r',
            mobileConversation ? 'hidden' : 'flex',
          )}>
            {/* Search-with-icon composition: Kibo input-group/icons/input-group-icons-1. */}
            <div className="shrink-0 px-4 pb-2 pt-3">
              <div className="flex h-8 items-center gap-2 rounded-lg border border-foreground/15 bg-[#262626] px-2.5 focus-within:ring-1 focus-within:ring-ring">
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
                      aria-label={`Open conversation with ${item.name}`}
                      aria-current={item.id === agent.id ? 'true' : undefined}
                      onClick={() => { setSelectedId(item.id); setMobileConversation(true); }}
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

          {activeTab === 'chat' && selectedGroup ? <GroupConversation key={selectedGroup} groupId={selectedGroup} mobile={mobileConversation} onBack={() => setMobileConversation(false)} draft={drafts[`group:${selectedGroup}`] ?? ''} onDraft={text => setDraft(`group:${selectedGroup}`, text)} typingIn={typingIn} /> : agents.length > 0 ? <section aria-label={`Conversation with ${agent.name}`} className={cn(
            'min-h-0 min-w-0 flex-1 flex-col transition-[margin] duration-200 motion-reduce:transition-none sm:flex',
            activityOpen && 'lg:mr-96',
            mobileConversation ? 'flex' : 'hidden',
          )}>
            <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border px-4 py-1.5">
              <Button variant="outline" size="sm" className="px-2 sm:hidden" aria-label={activeTab === 'chat' ? 'Back to chats' : 'Back to agents'} onClick={() => setMobileConversation(false)}>
                <span aria-hidden="true">←</span>
              </Button>
              <AgentAvatar initials={agent.initials} avatar={agent.avatar} ready={Boolean(agent.real)} typing={selfTyping} working={busy[agent.channelId]} />
              <div className="flex min-w-0 flex-[1_1_9rem] items-center gap-2">
                <AgentName name={agent.name} />
                {conversationPeer !== 'you' && peer && <><AgentExchangeIcon /><AgentAvatar initials={peer.name.slice(0, 2).toUpperCase()} avatar={peer.avatar ?? defaultAvatar(peer.id)} ready={Boolean(peer)} working={busy[peerChannel]} typing={peerTyping} /><span className="min-w-0 truncate text-sm font-semibold" title={peer.name}>{peer.name}</span></>}
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2">
              {activeTab !== 'chat' && <div className="flex items-center gap-2"><label htmlFor="agent-dm-conversation" className="whitespace-nowrap text-xs text-muted-foreground">Chat with</label><div className="w-36"><Select id="agent-dm-conversation" value={conversationPeer} onValueChange={value => { if (value === 'load-more') void dmConversations.load(dmConversations.failed ? undefined : dmConversations.cursor ?? undefined); else chooseConversation(value); }} options={[{ value: 'you', label: 'You' }, ...peers.map(peer => ({ value: peer.id, label: peer.name === 'You' ? 'You (agent)' : peer.name, icon: <AgentAvatarArt {...(peer.avatar ?? defaultAvatar(peer.id))} size={20} /> })), ...(dmConversations.cursor !== null || dmConversations.failed ? [{ value: 'load-more', label: dmConversations.busy ? 'Loading conversations…' : dmConversations.failed ? 'Retry conversations' : 'More conversations…' }] : [])]} triggerClassName="!h-7 !rounded-md !px-2 !text-xs" /></div></div>}
              <AgentActivityPanel agent={agent} entries={activity[agent.id] ?? []} open={activityOpen} onOpenChange={setActivityOpen} />
              </div>
            </header>

            <ScrollArea key={`${agent.id}:${conversationPeer}`} viewportRef={scrollRef} label="Chat history" className="min-h-0 flex-1">
              {conversationPeer === 'you' ? <>
              {(historyLoading[agent.channelId] || historyFailed[agent.channelId] || historyCursor[agent.channelId] != null) && <div className="px-5 pt-3 text-center"><Button variant="outline" size="sm" disabled={historyLoading[agent.channelId] || busy[agent.channelId]} onClick={() => void loadHistory(agent, Boolean(historyReady[agent.channelId]))}>{historyLoading[agent.channelId] ? 'Loading messages…' : historyFailed[agent.channelId] ? 'Retry loading messages' : 'Load earlier messages'}</Button></div>}
              {(inbox.failed || inbox.cursor !== null) && <div className="px-5 pt-3 text-center"><Button variant="outline" size="sm" disabled={inbox.busy} onClick={() => void inbox.load(inbox.failed ? undefined : inbox.cursor ?? undefined)}>{inbox.failed ? 'Retry agent messages' : 'Earlier agent messages'}</Button></div>}
              {historyReady[agent.channelId] && <ConversationMessages reactionChannel={agent.channelId} messages={messages} time={agent.time} agentName={agent.name} notices={inbox.messages} onViewDm={notice => { chooseConversation(notice.senderId); setActiveTab('agents'); }} />}
              </> : peer ? <AgentDmTranscript key={`${agent.id}:${peer.id}`} agentId={agent.id} peerId={peer.id} bubbleView={{ agentName: agent.name, peerName: peer.name, agentAvatar: agent.avatar ?? defaultAvatar(agent.id), peerAvatar: peer.avatar ?? defaultAvatar(peer.id), viewport: scrollRef }} /> : <p className="p-5 text-sm text-muted-foreground">This agent is no longer available.</p>}
            </ScrollArea>

            {conversationPeer === 'you' ? <div className="shrink-0 px-4 pb-3 pt-2 sm:px-5">
              <div className="w-full">
                <div className="mb-1 flex h-5 min-w-0 items-center px-2">
                  <AgentTypingStatus name={agent.name} typing={selfTyping} working={busy[agent.channelId]} connected={eventsConnected} />
                </div>
                <ChatComposer key={agent.id} name={agent.name} draft={draft} onChange={text => setDraft(agent.channelId, text)} onSend={sendMessage} busy={busy[agent.channelId]} onStop={() => stop(agent.channelId)} disabled={historyLoading[agent.channelId] || (Boolean(agent.real) && !historyReady[agent.channelId])} inputRef={inputRef} />
              </div>
            </div> : <div aria-label="Agent conversation status" className="shrink-0 border-t border-border px-5 py-3">
              {selfTyping || peerTyping ? <div className="flex min-h-5 items-center gap-3"><div className="flex min-w-0 flex-1"><AgentTypingStatus name={agent.name} typing={selfTyping} /></div><div className="flex min-w-0 flex-1 justify-end"><AgentTypingStatus name={peer?.name ?? 'Agent'} typing={peerTyping} /></div></div> : <p className="text-center text-xs text-muted-foreground">Agent-to-agent conversation · messages are sent by the agents</p>}
            </div>}
          </section> : <section aria-label="No agent selected" className="hidden min-w-0 flex-1 items-center justify-center p-6 text-sm text-muted-foreground sm:flex">Select or create an agent to start chatting.</section>}
        </Tabs.Content>

        <Tabs.Content value="settings" forceMount className="min-h-0 flex-1 overflow-y-auto outline-none data-[state=inactive]:hidden">
          <Settings />
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
