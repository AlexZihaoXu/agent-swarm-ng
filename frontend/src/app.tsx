import { useLayoutEffect, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AgentPanel } from '@/components/agent-panel';
import { AgentAvatar, AgentName } from '@/components/chat-identity';
import { cn } from '@/lib/utils';
import { useChat } from '@/use-chat';
import { SlideUpFadeSwap } from '@/components/ui/slide-up-fade-swap';
import { ConversationMessages } from '@/components/conversation-messages';
import { Preferences } from '@/components/preferences';
import { AvatarFace, PresenceIndicator, TypingDots } from '@/components/typing-indicator';
import { AgentActivityPanel } from '@/components/agent-activity-panel';

function Avatar({ initials, small = false, typing = false, ready = false }: { initials: string; small?: boolean; typing?: boolean; ready?: boolean }) {
  return (
    <span aria-hidden="true" className={cn(
      'relative shrink-0 font-medium text-foreground/75',
      small ? 'size-7 text-[11px]' : 'size-8 text-xs',
    )}>
      <AvatarFace avatarSize={small ? 28 : 32} ready={ready} typing={typing} size="md">
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-foreground/10">{initials}</span>
      </AvatarFace>
      <PresenceIndicator ready={ready} typing={typing} size="md" />
    </span>
  );
}

export function App() {
  const { agents, conversations, drafts, busy, typing, activity, addAgent, send, stop, setDraft } = useChat();
  const [selectedId, setSelectedId] = useState<string>(agents[0].id);
  const [mobileConversation, setMobileConversation] = useState(false);
  const [activeTab, setActiveTab] = useState('agents');
  const [search, setSearch] = useState('');
  const [activityOpen, setActivityOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingSend = useRef<string | null>(null);
  const visibleAgents = agents.filter(item => item.name.toLowerCase().includes(search.trim().toLowerCase()));
  const agent = agents.find(item => item.id === selectedId) ?? agents[0];
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW();
  const draft = drafts[agent.channelId] ?? '';
  const messages = conversations[agent.channelId];
  const previousConversation = useRef({ id: agent.id, count: messages.length });

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 128)}px`;
  }, [draft, agent.id, activeTab, mobileConversation, activityOpen]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const addedMessage = previousConversation.current.id === agent.id && messages.length > previousConversation.current.count;
    previousConversation.current = { id: agent.id, count: messages.length };
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: addedMessage && !reducedMotion ? 'smooth' : 'instant' });

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
  }, [agent.id, messages.length, activeTab, mobileConversation]);

  function sendMessage() {
    const messageId = send(agent, draft);
    if (!messageId) return;
    pendingSend.current = messageId;
    inputRef.current?.focus();
  }

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
      <h1 className="sr-only">Agent Swarm</h1>
      <Tabs.Root value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
        <header className="relative flex h-14 shrink-0 items-center justify-center border-b border-border bg-sidebar px-4">
          {/* Basic Tabs composition: Kibo tabs/standard/tabs-standard-1. */}
          <Tabs.List aria-label="Main navigation" className="relative isolate grid h-9 w-56 grid-cols-2 items-center rounded-lg bg-muted p-1">
            <span aria-hidden="true" data-testid="tab-indicator" className="pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-md bg-background shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none" style={{ transform: activeTab === 'preferences' ? 'translateX(100%)' : 'translateX(0)' }} />
            {['Agents', 'Preferences'].map(label => (
              <Tabs.Trigger key={label} value={label.toLowerCase()} className="relative z-10 rounded-md px-3 py-1 text-sm font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:text-foreground">
                {label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </header>

        <Tabs.Content value="agents" className="min-h-0 flex-1 outline-none data-[state=active]:flex">
          <AgentPanel onCreated={real => { addAgent(real); setSelectedId(real.id); setSearch(''); setMobileConversation(true); }} className={cn(
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
              {visibleAgents.length === 0 && <p role="status" className="px-2 py-4 text-xs text-muted-foreground">No agents found.</p>}
              <ul className="space-y-0.5">
                {visibleAgents.map(item => {
                  const lastMessage = conversations[item.channelId].at(-1);
                  return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-label={`Open conversation with ${item.name}`}
                      aria-current={item.id === selectedId ? 'true' : undefined}
                      onClick={() => { setSelectedId(item.id); setMobileConversation(true); }}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                        item.id === selectedId ? 'bg-foreground/10' : 'hover:bg-foreground/5',
                      )}
                    >
                      <Avatar initials={item.initials} ready={Boolean(item.real)} typing={typing[item.channelId]} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium">{item.name}</span>
                          <SlideUpFadeSwap className="shrink-0 text-[11px] text-muted-foreground" text={lastMessage?.time ?? item.time} />
                        </span>
                        <SlideUpFadeSwap className="mt-0.5 block text-xs text-muted-foreground" prefix={lastMessage?.author === 'user' ? 'You: ' : ''} text={lastMessage?.text ?? ''} />
                      </span>
                    </button>
                  </li>
                  );
                })}
              </ul>
            </div>
            <div className="flex shrink-0 items-center gap-2.5 px-4 py-3">
              <Avatar initials="YO" small />
              <span className="text-sm font-medium">Your account</span>
            </div>
          </AgentPanel>

          <section aria-label={`Conversation with ${agent.name}`} className={cn(
            'min-h-0 min-w-0 flex-1 flex-col transition-[margin] duration-200 motion-reduce:transition-none sm:flex',
            activityOpen && 'lg:mr-96',
            mobileConversation ? 'flex' : 'hidden',
          )}>
            <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
              <Button variant="outline" size="sm" className="px-2 sm:hidden" aria-label="Back to agents" onClick={() => setMobileConversation(false)}>
                <span aria-hidden="true">←</span>
              </Button>
              <AgentAvatar initials={agent.initials} ready={Boolean(agent.real)} typing={typing[agent.channelId]} />
              <AgentName name={agent.name} />
              <AgentActivityPanel agent={agent} entries={activity[agent.id] ?? []} open={activityOpen} onOpenChange={setActivityOpen} />
            </header>

            <ScrollArea key={agent.id} viewportRef={scrollRef} label="Chat history" className="min-h-0 flex-1">
              <ConversationMessages messages={messages} time={agent.time} agentName={agent.name} />
            </ScrollArea>

            <div className="shrink-0 px-4 pb-3 pt-2 sm:px-5">
              <div className="w-full">
                <div className="mb-1 flex h-5 min-w-0 items-center px-2">
                  {busy[agent.channelId] && (
                    <p role="status" className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                      {typing[agent.channelId] ? <><TypingDots /><span className="truncate"><strong className="font-medium text-foreground">{agent.name}</strong> is typing…</span></> : 'Agent is working…'}
                    </p>
                  )}
                </div>
                <form aria-label="Message composer" onSubmit={event => { event.preventDefault(); sendMessage(); }} className="flex items-end gap-2 rounded-3xl border border-foreground/20 bg-transparent p-2 focus-within:ring-1 focus-within:ring-ring">
                  <button type="button" disabled aria-label="Add attachment" title="Attachments aren’t available in this preview" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
                  </button>
                  <textarea
                    key={agent.id} ref={inputRef} rows={1} value={draft}
                    onChange={event => setDraft(agent.channelId, event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                        event.preventDefault();
                        sendMessage();
                      }
                    }}
                    aria-label={`Message ${agent.name}`} placeholder={`Message ${agent.name}…`}
                    className="max-h-32 min-h-7 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-1 text-sm leading-5 outline-none placeholder:text-muted-foreground"
                  />
                  {busy[agent.channelId] ? (
                    <Button type="button" size="sm" aria-label="Stop response" className="size-7 shrink-0 rounded-full p-0" onClick={() => stop(agent.channelId)}><span aria-hidden="true" className="size-2.5 rounded-sm bg-current" /></Button>
                  ) : (
                    <Button type="submit" size="sm" disabled={!draft.trim()} aria-label="Send message" className="size-7 shrink-0 rounded-full p-0">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4"><path d="M12 19V5m-6 6 6-6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </Button>
                  )}
                </form>
              </div>
            </div>
          </section>
        </Tabs.Content>

        <Tabs.Content value="preferences" forceMount className="min-h-0 flex-1 overflow-y-auto outline-none data-[state=inactive]:hidden">
          <Preferences />
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
