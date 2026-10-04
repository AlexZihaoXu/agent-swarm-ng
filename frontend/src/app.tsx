import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { computersQuery } from '@/lib/computers-query';
import * as Tabs from '@radix-ui/react-tabs';
import { useLocation, useNavigate } from 'react-router';
import { useAppUpdate } from '@/lib/pwa';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatSkeleton, EdgeSkeleton } from '@/components/ui/skeleton';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { AgentsIcon, ChatIcon, ComputerIcon, DashboardIcon, PlusIcon, SettingsIcon } from '@/components/ui/icons';
import { JumpToLatest } from '@/components/jump-to-latest';
import { useMessageWindow } from '@/lib/use-message-window';
import { AgentPanel } from '@/components/agent-panel';
import { EditAgentForm } from '@/components/edit-agent-form';
import { AgentAvatar, AgentName, CompactionCue } from '@/components/chat-identity';
import { cn } from '@/lib/utils';
import { useChat, type ChatAgent } from '@/use-chat';
import type { ChatMessage } from '@/chat-types';
import { replyExcerpt } from '@/lib/reply-preview';
import { useDmConversations } from '@/use-dm-conversations';
import { useDmInbox } from '@/use-dm-inbox';
import { AgentExchangeIcon } from '@/components/agent-exchange-icon';
import { AgentDmTranscript } from '@/components/agent-dm-transcript';
import { DiscordPlaceIcon, DiscordTranscript, useDiscordPlaces } from '@/components/discord-transcript';
import { Select } from '@/components/ui/select';
import { ConversationMessages } from '@/components/conversation-messages';
import { isTypingInConversation } from '@/lib/conversation-typing';
import { conversationTimeline } from '@/lib/conversation-timeline';
import { AgentTypingStatus } from '@/components/agent-typing-status';
import { AvatarFace, PresenceIndicator } from '@/components/typing-indicator';
import { AgentActivityPanel } from '@/components/agent-activity-panel';
import { AgentAvatarArt } from '@/components/agent-avatar-art';
import { defaultAvatar, type AvatarAppearance } from '@/lib/agent-avatar';
import { ChatPanel } from '@/components/chat-panel';
import { GroupConversation } from '@/components/group-conversation';
import { ChatComposer } from '@/components/chat-composer';
import { ChatFilesDialog } from '@/components/chat-files-dialog';
import { chatFilesKey, dmFilesKey, messagePreview } from '@/lib/chat-files';
import { useAttachments } from '@/lib/use-attachments';
import { useGroupEvents } from '@/use-groups';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Portal, PortalButton, usePortalShortcut } from '@/components/portal';
import { OrganizationSwitcher } from '@/components/organization-switcher';
import { useOrganizations } from '@/lib/organizations';
import { PortalWindows } from '@/components/portal-windows';
import type { ComputerAgentState } from '@/components/computer-control';
import { AgentPicker } from '@/components/agent-picker';
import {
  agentDmPath,
  agentPath,
  chatAgentDiscordPath,
  chatAgentDmPath,
  chatAgentPath,
  chatGroupPath,
  computerPath,
  parseDashboardPath,
} from '@/lib/dashboard-location';

// Tabs the operator opens less often load on demand, keeping the first download small.
// They are fetched quietly once the dashboard is idle, so the first visit does not wait on the network.
const loadSettings = () => import('@/components/settings');
const loadKnowledge = () => import('@/components/knowledge-browser');
const loadComputers = () => import('@/components/computers-panel');
const Settings = lazy(() => loadSettings().then(module => ({ default: module.Settings })));
const KnowledgeBrowser = lazy(() => loadKnowledge().then(module => ({ default: module.KnowledgeBrowser })));
const Dashboard = lazy(() => import('@/components/dashboard').then(module => ({ default: module.Dashboard })));
import { AlertBanner } from '@/components/alert-banner';
import { AgentTodos } from '@/components/agent-todos';
const AccessLog = lazy(() => import('@/components/access-log').then(module => ({ default: module.AccessLog })));
const AuditLog = lazy(() => import('@/components/audit-log').then(module => ({ default: module.AuditLog })));
const ComputersPanel = lazy(() => loadComputers().then(module => ({ default: module.ComputersPanel })));
const whenIdle = (task: () => void) => {
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(task, { timeout: 3000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(task, 1200);
  return () => clearTimeout(id);
};
const loading = (
  <p role="status" className="p-6 text-sm text-muted-foreground">
    Loading…
  </p>
);

function Avatar({
  initials,
  avatar,
  typing = false,
  ready = false,
  working = false,
  compaction = null,
}: {
  initials: string;
  avatar?: AvatarAppearance;
  typing?: boolean;
  ready?: boolean;
  working?: boolean;
  compaction?: 'running' | 'sleeping' | null;
}) {
  return (
    <span aria-hidden="true" className="relative size-8 shrink-0 text-xs font-medium text-foreground/75">
      <AvatarFace avatarSize={32} ready={ready} typing={typing} working={working} size="md">
        {avatar ? (
          <AgentAvatarArt
            {...avatar}
            size={32}
            state={compaction === 'sleeping' ? 'sleeping' : typing ? 'typing' : working ? 'working' : 'idle'}
            animated
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-foreground/10">
            {initials}
          </span>
        )}
      </AvatarFace>
      <PresenceIndicator ready={ready} typing={typing} working={working} size="md" />
      <CompactionCue state={compaction} />
    </span>
  );
}

const emptyAgent: ChatAgent = { id: '', name: '', initials: '', time: '', channelId: '' };

export function App() {
  const {
    agents: allAgents,
    conversations,
    drafts,
    busy,
    peerBusy,
    typing,
    typingTargets,
    activity,
    errors,
    addAgent,
    applyAgent,
    runOf,
    deleteAgent,
    editAvatar,
    send,
    stop,
    setDraft,
    eventsConnected,
    agentsLoading,
    agentsFailed,
    agentsCursor,
    loadAgents,
    historyReady,
    historyLoading,
    historyFailed,
    historyCursor,
    loadHistory,
    loadActivity,
    expandActivity,
    retryActivity,
    activityHistory,
    compactions,
  } = useChat();
  // Organizations: the dashboard shows the chosen one's agents (docs/organizations.md).
  const { inScope, setCurrent, current: organization, organizations } = useOrganizations();
  // Switching organization swaps the lists below the header: a short fade marks it (nothing remounts, so drafts and
  // scroll positions stay). Skipped on the first render and with reduced motion.
  const tabsRoot = useRef<HTMLDivElement>(null);
  const shownOrganization = useRef(organization);
  useEffect(() => {
    if (shownOrganization.current === organization) return;
    shownOrganization.current = organization;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    tabsRoot.current?.querySelectorAll<HTMLElement>(':scope > [role="tabpanel"]').forEach(panel =>
      panel.animate(
        [
          { opacity: 0.35, transform: 'translateY(4px)' },
          { opacity: 1, transform: 'none' },
        ],
        {
          duration: 180,
          easing: 'ease-out',
        },
      ),
    );
  }, [organization]);
  const agents = useMemo(() => allAgents.filter(item => inScope(item.real?.organizationId)), [allAgents, inScope]);
  const location = useLocation();
  const navigate = useNavigate();
  const route = parseDashboardPath(location.pathname);
  const activeTab = route.tab;
  const selectedGroup = route.groupId ?? '';
  const selectedId = route.agentId ?? agents[0]?.id ?? '';
  const mobileConversation = Boolean(route.agentId || route.groupId);
  const computerViewerOpen = route.kind === 'computer';
  // What floating chats need (the computer viewer's and Portal's).
  const agentState: ComputerAgentState & { chat: NonNullable<ComputerAgentState['chat']> } = {
    agents,
    busy,
    peerBusy,
    typing,
    connected: eventsConnected,
    chat: {
      conversations,
      drafts,
      historyReady,
      historyLoading,
      setDraft,
      send: (target, text, fileIds) => send(target, text, undefined, fileIds),
      stop,
      historyCursor,
      historyFailed,
      loadHistory: (target, older) => void loadHistory(target, older),
      openConversation: target => navigate(chatAgentPath(target.id)),
    },
  };
  const [portalOpen, setPortalOpen] = useState(false);
  usePortalShortcut(() => setPortalOpen(value => !value));
  const [isPhone, setIsPhone] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  // Unsaved agent-settings changes: warn before leaving the page by any in-app route, or by closing the tab.
  const [unsaved, setUnsaved] = useState<string[]>([]);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const leave = (action: () => void) => {
    if (unsaved.length) setPendingLeave(() => action);
    else action();
  };
  useEffect(() => {
    if (!unsaved.length) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved.length]);
  const [settingsSeen, setSettingsSeen] = useState(false);
  useEffect(() => {
    if (activeTab === 'settings') setSettingsSeen(true);
  }, [activeTab]);
  // Tab content enters from the side its tab sits on (see .tab-enter).
  const tabOrder = ['dashboard', 'agents', 'chat', 'computers', 'settings'];
  const previousTab = useRef(activeTab);
  const tabShift = useRef(0);
  if (previousTab.current !== activeTab) {
    tabShift.current = Math.sign(tabOrder.indexOf(activeTab) - tabOrder.indexOf(previousTab.current)) * 16;
    previousTab.current = activeTab;
  }
  const pendingTabPath = useRef('');
  const focusAgentsAfterDelete = useRef(false);
  useEffect(() => {
    if (!focusAgentsAfterDelete.current || route.tab !== 'agents' || route.kind === 'not-found') return;
    const frame = requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>('aside[aria-label="Agents"]');
      if (panel) {
        panel.focus();
        focusAgentsAfterDelete.current = false;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [route.kind, agents.length]);
  const changeTab = (value: string) => {
    const target =
      value === 'agents'
        ? selectedId
          ? agentPath(selectedId)
          : '/agents'
        : value === 'chat'
          ? !isPhone && selectedId
            ? chatAgentPath(selectedId)
            : '/chat'
          : value === 'computers'
            ? '/computers'
            : value === 'dashboard'
              ? '/dashboard'
              : '/settings';
    // Compare with the address itself: navigation renders as a transition, so during a quick second click the
    // rendered tab can still be the old one and would swallow the click.
    const current = parseDashboardPath(window.location.pathname).tab;
    if (value === current || window.location.pathname === target || pendingTabPath.current === target) return;
    pendingTabPath.current = target;
    leave(() => {
      navigate(target);
    });
  };
  useEffect(() => {
    pendingTabPath.current = '';
  }, [location.pathname]);
  useEffect(() => {
    if (route.kind === 'root') navigate('/agents', { replace: true });
    // Agents always shows one agent's settings (phones too: the picker is above them); Chat lists on phones.
    else if (!agentsLoading && agents[0] && (route.kind === 'agents-list' || (!isPhone && route.kind === 'chat-list')))
      navigate(route.kind === 'chat-list' ? chatAgentPath(agents[0].id) : agentPath(agents[0].id), { replace: true });
  }, [route.kind, isPhone, agentsLoading, agents, navigate]);
  useEffect(() => {
    if (
      !route.agentId ||
      allAgents.some(item => item.id === route.agentId) ||
      agentsLoading ||
      agentsFailed ||
      agentsCursor === null
    )
      return;
    void loadAgents(agentsCursor);
  }, [route.agentId, allAgents, agentsLoading, agentsFailed, agentsCursor]);
  // A link to an agent of another organization (a bookmark, a floating chat) switches to its organization, once per
  // route; switching organization leaves an agent of another one (back to the list).
  const followed = useRef('');
  useEffect(() => {
    const target = route.agentId ? allAgents.find(item => item.id === route.agentId) : undefined;
    if (!target?.real || followed.current === target.id) return;
    followed.current = target.id;
    if (!inScope(target.real.organizationId)) setCurrent(target.real.organizationId);
  }, [route.agentId, allAgents]);
  useEffect(() => {
    if (!route.agentId || agents.some(item => item.id === route.agentId)) return;
    if (allAgents.some(item => item.id === route.agentId))
      navigate(route.tab === 'chat' ? '/chat' : '/agents', { replace: true });
  }, [organization]);
  // Old Agents peer bookmarks now open their conversation in Chat.
  useEffect(() => {
    if (route.kind === 'agent-dm' && route.agentId && route.peerId)
      navigate(chatAgentDmPath(route.agentId, route.peerId), { replace: true });
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
  // Where the agent editor lists its sections on wide screens: the Agents panel, under the picker.
  const [sectionSlot, setSectionSlot] = useState<HTMLDivElement | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingSend = useRef<string | null>(null);
  const [replyTargets, setReplyTargets] = useState<Record<string, ChatMessage>>({});
  const pendingReplyAcks = useRef(new Map<string, { channelId: string; targetId: string }>());
  const agent = route.agentId
    ? (agents.find(item => item.id === route.agentId) ?? emptyAgent)
    : (agents[0] ?? emptyAgent);
  const narrowDetail = activeTab === 'chat' && mobileConversation && Boolean(selectedGroup || agent.id);
  const inbox = useDmInbox(agent.id);
  const dmConversations = useDmConversations(agent.id);
  const [conversation, setConversation] = useState<{
    owner: string;
    peer: string;
    selected?: { id: string; name: string; avatar?: AvatarAppearance | null; channelId?: string };
  }>({ owner: '', peer: 'you' });
  // A Discord channel the agent's bot saw is a read-only conversation too ("discord:<channelId>").
  const discordPlaces = useDiscordPlaces(agent.id, Boolean(agent.real) && activeTab === 'chat');
  const discordChannel = route.kind === 'chat-agent-discord' ? route.discordChannelId : undefined;
  const discordPlace = discordPlaces.find(place => place.id === discordChannel);
  const conversationPeer = discordChannel
    ? `discord:${discordChannel}`
    : route.kind === 'agent-dm' || route.kind === 'chat-agent-dm'
      ? (route.peerId ?? 'you')
      : 'you';
  const chooseConversation = (nextPeer: string) => {
    if (nextPeer.startsWith('discord:'))
      return navigate(chatAgentDiscordPath(agent.id, nextPeer.slice('discord:'.length)));
    setConversation({ owner: agent.id, peer: nextPeer, selected: peers.find(item => item.id === nextPeer) });
    navigate(
      activeTab === 'chat'
        ? nextPeer === 'you'
          ? chatAgentPath(agent.id)
          : chatAgentDmPath(agent.id, nextPeer)
        : nextPeer === 'you'
          ? agentPath(agent.id)
          : agentDmPath(agent.id, nextPeer),
    );
  };
  // Keep an already-open peer visible when the refreshed sidebar is paginated.
  const selectedPeer =
    conversation.owner === agent.id && conversation.peer === conversationPeer ? conversation.selected : undefined;
  const peers = [
    ...new Map(
      [
        ...(selectedPeer ? [selectedPeer] : []),
        ...inbox.messages.map(message => ({
          id: message.senderId,
          name: message.senderName,
          avatar: message.senderAvatar,
          channelId: undefined as string | undefined,
        })),
        ...dmConversations.peers,
      ]
        .filter(peer => peer.id !== agent.id)
        .map(peer => [peer.id, peer]),
    ).values(),
  ].map(peer => agents.find(item => item.id === peer.id) ?? peer);
  const peer = peers.find(item => item.id === conversationPeer) ?? agents.find(item => item.id === conversationPeer);
  const peerRecord = agents.find(item => item.id === conversationPeer);
  const peerChannel = peerRecord?.channelId ?? peer?.channelId ?? '';
  useEffect(() => {
    if (
      conversationPeer === 'you' ||
      discordChannel ||
      peer ||
      dmConversations.busy ||
      dmConversations.failed ||
      agentsLoading
    )
      return;
    if (dmConversations.cursor !== null) void dmConversations.load(dmConversations.cursor);
  }, [
    agent.id,
    conversationPeer,
    peer,
    dmConversations.busy,
    dmConversations.failed,
    dmConversations.cursor,
    agentsLoading,
  ]);
  const typingIn = (channelId: string, destination: string) =>
    isTypingInConversation(typing[channelId], typingTargets[channelId], destination, eventsConnected);
  const visibleChannel =
    conversationPeer === 'you' ? agent.channelId : `dm:${[agent.id, conversationPeer].sort().join(':')}`;
  const selfTyping = typingIn(agent.channelId, visibleChannel);
  const peerTyping = typingIn(peerChannel, visibleChannel);
  const appUpdate = useAppUpdate();
  const draft = drafts[agent.channelId] ?? '';
  const attachments = useAttachments(agent.real ? chatFilesKey(agent.channelId) : undefined);
  // Sent files leave the composer once the server confirms their message; a failed send keeps them to retry.
  const confirmed = conversations[agent.channelId];
  useEffect(() => {
    attachments.settle((confirmed ?? []).flatMap(message => (message.sequence === undefined ? [] : [message.id])));
  }, [confirmed]);
  const messages = conversations[agent.channelId] ?? [];
  const timeline = conversationTimeline(messages, inbox.messages);
  // Long histories render a bounded window that follows the reader; older pages load near the top.
  const history = useMessageWindow({
    items: messages,
    idOf: (message: ChatMessage) => message.id,
    viewport: scrollRef,
    canLoadOlder:
      historyCursor[agent.channelId] != null &&
      !historyLoading[agent.channelId] &&
      Boolean(historyReady[agent.channelId]),
    loadOlder: () => void loadHistory(agent, true),
    reset: `${agent.id}:${conversationPeer}`,
  });
  const previousConversation = useRef({
    id: agent.id,
    viewport: null as HTMLDivElement | null,
    count: timeline.length,
    first: timeline[0]?.id,
    last: timeline.at(-1)?.id,
    height: 0,
  });

  useEffect(() => {
    void loadHistory(agent);
  }, [agent.id]);
  const tabList = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  useLayoutEffect(() => {
    const list = tabList.current;
    if (!list) return;
    const measure = () => {
      const active = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
      if (active) setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [activeTab, computerViewerOpen]);
  // Typing while focus rests elsewhere in a chat (a message, the list, the page) goes straight to the composer,
  // as in chat apps. Shortcuts, fields, dialogs and the space/enter that activate a focused control are left alone.
  useEffect(() => {
    if (activeTab !== 'chat') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      if (event.key.length !== 1) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          'input, textarea, select, [contenteditable], [role="dialog"], [role="menu"], [data-terminal-emulator]',
        )
      )
        return;
      if (event.key === ' ' && target?.closest('button, a[href], [role="button"], [role="tab"], [role="menuitem"]'))
        return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const composer = [
        ...document.querySelectorAll<HTMLTextAreaElement>('form[aria-label="Message composer"] textarea'),
      ].find(element => element.offsetParent !== null && !element.disabled);
      // Focusing during keydown lets the browser deliver this very keystroke to the composer.
      composer?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeTab]);
  // Warm what the operator is likely to open next: the lazy tabs, the computers list and recent conversations.
  // History loads are idempotent and bounded (one section per channel), so warming a few is cheap.
  const client = useQueryClient();
  useEffect(
    () =>
      whenIdle(() => {
        void loadSettings();
        void loadComputers();
        void loadKnowledge();
        void client.prefetchQuery({ ...computersQuery, staleTime: 5000 });
      }),
    [],
  );
  const warmed = agentsLoading
    ? ''
    : agents
        .slice(0, 6)
        .map(item => item.id)
        .join();
  useEffect(() => {
    if (!warmed) return;
    return whenIdle(() => {
      for (const item of agents.slice(0, 6)) void loadHistory(item);
    });
  }, [warmed]);
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
      if (!conversations[pending.channelId]?.some(message => message.id === id && message.sequence !== undefined))
        continue;
      pendingReplyAcks.current.delete(id);
      setReplyTargets(current => {
        if (current[pending.channelId]?.id !== pending.targetId) return current;
        const next = { ...current };
        delete next[pending.channelId];
        return next;
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
    const prepended =
      !newViewport &&
      addedMessage &&
      previous.first &&
      previous.first !== timeline[0]?.id &&
      previous.last === timeline.at(-1)?.id;
    const sentId = pendingSend.current;
    // Older pages keep the reader's place through useMessageWindow's anchor, not a height delta here.
    if (prepended) {
      /* anchored by useMessageWindow */
    } else if (
      newViewport ||
      (addedMessage && (Boolean(sentId) || previous.height - scroller.scrollTop - scroller.clientHeight < 80))
    ) {
      scroller.scrollTo({
        top: scroller.scrollHeight,
        behavior: addedMessage && !newViewport && !reducedMotion ? 'smooth' : 'instant',
      });
    }
    previousConversation.current = {
      id: agent.id,
      viewport: scroller,
      count: timeline.length,
      first: timeline[0]?.id,
      last: timeline.at(-1)?.id,
      height: scroller.scrollHeight,
    };

    pendingSend.current = null;
    if (!sentId || reducedMotion) return;
    const bubble = scroller.querySelector<HTMLElement>(`[data-message-id="${sentId}"]`);
    const input = inputRef.current;
    if (!bubble || !input) return;
    const rise = Math.max(12, input.getBoundingClientRect().top - bubble.getBoundingClientRect().top);
    bubble.animate(
      [
        { opacity: 0, transform: `translateY(${rise}px) scale(0.45)` },
        { opacity: 1, transform: 'translateY(0) scale(1)' },
      ],
      { duration: 360, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  }, [agent.id, timeline.length, activeTab, mobileConversation, conversationPeer]);

  function sendMessage() {
    if (conversationPeer !== 'you') return;
    const target = replyTargets[agent.channelId];
    const messageId = send(
      agent,
      draft,
      target
        ? {
            id: target.id,
            role: target.author === 'user' ? 'user' : 'assistant',
            text: replyExcerpt(messagePreview(target.text, target.files)),
          }
        : undefined,
      attachments.ids,
    );
    if (!messageId) return;
    if (attachments.items.length) attachments.hold(messageId);
    if (target) pendingReplyAcks.current.set(messageId, { channelId: agent.channelId, targetId: target.id });
    pendingSend.current = messageId;
    inputRef.current?.focus();
  }

  if (
    route.kind === 'not-found' ||
    (route.agentId &&
      !agentsLoading &&
      !agentsFailed &&
      agentsCursor === null &&
      !agents.some(item => item.id === route.agentId))
  )
    return (
      <main className="p-8">
        Page not found.{' '}
        <a
          href="/agents"
          className="underline"
          onClick={event => {
            event.preventDefault();
            navigate('/agents');
          }}
        >
          Return to agents
        </a>
      </main>
    );

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
      <h1 className="sr-only">Agent Swarm NG</h1>
      <Tabs.Root
        ref={tabsRoot}
        value={activeTab}
        onValueChange={changeTab}
        className="flex min-h-0 flex-1 flex-col"
        style={{ '--tab-shift': `${tabShift.current}px` } as React.CSSProperties}
      >
        {/* Phones: a slim top bar (organization, Portal) and a full-width bottom bar with every tab; detail views and
            the desktop viewer hide both. Wider screens: one header row (organization, tabs, Portal). */}
        {!computerViewerOpen && !narrowDetail && (
          <div className="flex h-[calc(3rem+env(safe-area-inset-top))] shrink-0 items-center justify-between gap-2 border-b border-border bg-sidebar px-3 pt-[env(safe-area-inset-top)] md:hidden">
            <OrganizationSwitcher bar />
            <PortalButton onClick={() => setPortalOpen(true)} className="h-9 w-9 justify-center px-0" />
          </div>
        )}
        {/* Under the phone's top bar (which keeps the notch clear); when that bar is hidden, it clears the notch itself. */}
        <AlertBanner onNavigate={navigate} insetTop={computerViewerOpen || narrowDetail} />
        {!computerViewerOpen && (
          <header
            className={cn(
              'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-sidebar pb-[env(safe-area-inset-bottom)] md:relative md:z-auto md:order-first md:flex md:h-14 md:min-h-14 md:shrink-0 md:items-center md:justify-center md:border-b md:border-t-0 md:px-4 md:pb-0',
              narrowDetail && 'max-md:hidden',
            )}
          >
            <OrganizationSwitcher className="hidden md:absolute md:left-4 md:flex" />
            {/* Basic Tabs composition: Kibo tabs/standard/tabs-standard-1 (on phones a bottom navigation bar). */}
            <Tabs.List
              aria-label="Main navigation"
              ref={tabList}
              className="relative isolate grid h-14 w-full grid-cols-5 items-center px-1 md:flex md:h-9 md:w-auto md:gap-0.5 md:rounded-lg md:bg-muted md:p-1"
            >
              <span
                aria-hidden="true"
                data-testid="tab-indicator"
                className="pointer-events-none absolute inset-y-1.5 left-0 rounded-md bg-muted shadow-sm transition-[transform,width] duration-200 ease-out motion-reduce:transition-none md:inset-y-1 md:bg-background"
                // Measured from the active tab, so tabs can be as wide as their labels (even gaps between them).
                style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
              />
              {(
                [
                  ['Dashboard', DashboardIcon],
                  ['Agents', AgentsIcon],
                  ['Chat', ChatIcon],
                  ['Computers', ComputerIcon],
                  ['Settings', SettingsIcon],
                ] as const
              ).map(([label, TabIcon]) => (
                <Tabs.Trigger
                  key={label}
                  value={label.toLowerCase()}
                  // Radix skips a tab it still renders as selected; while the previous switch is rendering that can be
                  // the stale one, so the press goes to changeTab directly (it ignores repeats).
                  onMouseDown={event => {
                    if (event.button === 0 && !event.ctrlKey) changeTab(label.toLowerCase());
                  }}
                  className="relative z-10 min-h-11 min-w-0 rounded-md px-0.5 py-1 text-[11px] font-medium md:min-h-0 md:px-3.5 md:text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:text-foreground"
                >
                  {/* Kibo tabs-standard-2 (Tabs with Icons): stacked on the phone bar, inline on desktop. */}
                  <span className="flex flex-col items-center gap-0.5 md:flex-row md:gap-1.5">
                    <TabIcon className="size-5 md:size-4" />
                    <span className="max-w-full truncate">{label}</span>
                  </span>
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <PortalButton
              onClick={() => setPortalOpen(true)}
              className="hidden md:absolute md:right-4 md:flex md:h-9"
            />
          </header>
        )}

        <Tabs.Content
          key={activeTab === 'chat' ? 'chat' : 'agents'}
          value={activeTab === 'chat' ? 'chat' : 'agents'}
          className={cn(
            'tab-enter min-h-0 flex-1 outline-none data-[state=active]:flex',
            // Phones stack the Agents picker over the settings.
            activeTab === 'agents' && 'max-md:flex-col',
          )}
        >
          {activeTab === 'chat' ? (
            <ChatPanel
              route={route}
              onNavigate={navigate}
              agents={agents}
              conversations={conversations}
              busy={busy}
              compactions={compactions}
              typingIn={typingIn}
              selectedAgent={agent.id}
              selectedGroup={selectedGroup}
              mobile={mobileConversation}
              agentsLoading={agentsLoading}
              agentsFailed={agentsFailed}
              agentsCursor={agentsCursor}
              loadAgents={loadAgents}
              onPrefetchAgent={item => void loadHistory(item)}
              onAgent={(id, real) => {
                if (real && !agents.some(agent => agent.id === id)) addAgent(real, false);
                navigate(chatAgentPath(id));
              }}
              onViewAgent={(id, real) => {
                if (real && !agents.some(agent => agent.id === id)) addAgent(real, false);
                navigate(agentPath(id));
              }}
              onGroup={group => {
                navigate(chatGroupPath(group.id));
                setActivityOpen(false);
              }}
            />
          ) : (
            <AgentPanel
              agents={agents}
              route={route}
              // Creating replaces the editor: unsaved settings ask first, as with any other way out.
              onNavigate={path => (path === '/agents/new' ? leave(() => navigate(path)) : navigate(path))}
              onDeleted={() => {
                focusAgentsAfterDelete.current = true;
                navigate('/agents');
              }}
              onDelete={async (target, confirmation) => {
                await deleteAgent(target, confirmation);
                setReplyTargets(current => {
                  const next = { ...current };
                  delete next[target.channelId];
                  return next;
                });
                if (agent.id === target.id) setActivityOpen(false);
              }}
              onCreated={real => {
                addAgent(real);
                navigate(agentPath(real.id));
              }}
              // Phones: a bar over the settings; wider screens: a side panel.
              className="flex w-full shrink-0 flex-col border-b border-border bg-sidebar md:min-h-0 md:w-72 md:border-b-0 md:border-r"
            >
              {/* Which agent, then (wide screens) its settings' sections, which the editor fills in. */}
              <>
                <div
                  className="flex items-center gap-2 border-border p-3 md:border-b md:p-4"
                  data-agent-id={agent.id || undefined}
                >
                  <div className="min-w-0 flex-1">
                    <AgentPicker
                      agents={agents}
                      status={
                        agent.id ? (
                          <Avatar
                            initials={agent.initials}
                            avatar={agent.avatar}
                            ready={Boolean(agent.real)}
                            typing={typingIn(agent.channelId, agent.channelId)}
                            working={busy[agent.channelId]}
                            compaction={compactions[agent.id]}
                          />
                        ) : undefined
                      }
                      selected={agent.id ? agent : undefined}
                      onSelect={id => leave(() => navigate(agentPath(id)))}
                      more={
                        agentsLoading || agentsFailed || agentsCursor !== null
                          ? {
                              label: agentsLoading
                                ? 'Loading agents…'
                                : agentsFailed
                                  ? 'Retry loading agents'
                                  : 'Load more agents',
                              busy: agentsLoading,
                              load: () => void loadAgents(agentsCursor ?? undefined),
                            }
                          : undefined
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="size-12 shrink-0 p-0 text-lg"
                    aria-label="Create new agent"
                    title="Create new agent"
                    onClick={() => leave(() => navigate('/agents/new'))}
                  >
                    +
                  </Button>
                </div>
                {!agents.length && !agentsLoading && !agentsFailed && agentsCursor === null && (
                  // Phones show the page's own empty state right below.
                  <p role="status" className="px-6 py-4 text-xs text-muted-foreground max-md:hidden">
                    No agents yet. Use + to create one.
                  </p>
                )}
                {/* A failed first page is retried in plain sight, not only from inside the picker. */}
                {!agents.length && agentsFailed && (
                  <div className="px-3 pb-3 md:px-4 md:pb-0 md:pt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={agentsLoading}
                      onClick={() => void loadAgents()}
                    >
                      Retry loading agents
                    </Button>
                  </div>
                )}
                {!isPhone && (
                  <div
                    ref={setSectionSlot}
                    data-agent-id={agent.id || undefined}
                    className="min-h-0 flex-1 overflow-y-auto p-3"
                  />
                )}
              </>
            </AgentPanel>
          )}

          {activeTab === 'agents' ? (
            agent.id && route.kind !== 'agent-dm' && route.kind !== 'agent-new' ? (
              <EditAgentForm
                key={agent.id}
                agent={agent}
                route={route}
                sectionSlot={sectionSlot}
                onNavigate={navigate}
                onSave={editAvatar}
                onModelSaved={applyAgent}
                onUnsavedChange={setUnsaved}
              />
            ) : (
              <section aria-label="No agent selected" className="flex min-w-0 flex-1">
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia>
                      <AgentsIcon />
                    </EmptyMedia>
                    <EmptyTitle>No agent selected</EmptyTitle>
                    <EmptyDescription>Select or create an agent to configure.</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button type="button" className="gap-1.5" onClick={() => leave(() => navigate('/agents/new'))}>
                      <PlusIcon />
                      Create agent
                    </Button>
                  </EmptyContent>
                </Empty>
              </section>
            )
          ) : selectedGroup ? (
            <GroupConversation
              key={selectedGroup}
              groupId={selectedGroup}
              modal={route.kind === 'group-edit' ? 'edit' : route.kind === 'group-delete' ? 'delete' : null}
              returnTo={location.state?.returnTo === '/chat' ? '/chat' : chatGroupPath(selectedGroup)}
              onNavigate={navigate}
              mobile={mobileConversation}
              onBack={() => navigate('/chat')}
              draft={drafts[`group:${selectedGroup}`] ?? ''}
              onDraft={text => setDraft(`group:${selectedGroup}`, text)}
              typingIn={typingIn}
              busy={busy}
              runOf={runOf}
              onStop={stop}
            />
          ) : agents.length > 0 ? (
            <section
              aria-label={`Conversation with ${agent.name}`}
              className={cn(
                'phone-detail-enter min-h-0 min-w-0 flex-1 flex-col transition-[margin] duration-200 motion-reduce:transition-none md:flex',
                activityOpen && 'lg:mr-96',
                mobileConversation ? 'flex' : 'hidden',
              )}
            >
              <header className="flex min-h-11 shrink-0 flex-nowrap items-center gap-x-1 border-b border-border px-4 pb-1.5 pt-[calc(0.375rem+env(safe-area-inset-top))] md:flex-wrap md:gap-x-2 md:gap-y-1.5">
                {isPhone ? (
                  <button
                    type="button"
                    aria-label="Back to chats"
                    title="Back to chats"
                    onClick={() => navigate('/chat')}
                    className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-1 overflow-hidden text-left outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <AgentAvatar
                      initials={agent.initials}
                      avatar={agent.avatar}
                      ready={Boolean(agent.real)}
                      typing={selfTyping}
                      working={busy[agent.channelId]}
                      compaction={compactions[agent.id]}
                    />
                    <span
                      role="heading"
                      aria-level={2}
                      className="min-w-0 truncate text-sm font-semibold"
                      title={agent.name}
                    >
                      {agent.name}
                    </span>
                  </button>
                ) : (
                  <>
                    <AgentAvatar
                      initials={agent.initials}
                      avatar={agent.avatar}
                      ready={Boolean(agent.real)}
                      typing={selfTyping}
                      working={busy[agent.channelId]}
                      compaction={compactions[agent.id]}
                    />
                    <div className="flex min-w-0 flex-1 items-center gap-2 md:flex-[1_1_9rem]">
                      {discordChannel ? (
                        <>
                          <AgentName name={agent.name} />
                          <AgentExchangeIcon />
                          <DiscordPlaceIcon kind={discordPlace?.kind ?? 'text'} />
                          <span
                            className="min-w-0 truncate text-sm font-semibold"
                            title={discordPlace?.place ?? 'Discord'}
                          >
                            {discordPlace?.place ?? 'Discord'}
                          </span>
                        </>
                      ) : conversationPeer !== 'you' && peer ? (
                        <>
                          <AgentName name={agent.name} />
                          <AgentExchangeIcon />
                          <AgentAvatar
                            initials={peer.name.slice(0, 2).toUpperCase()}
                            avatar={peer.avatar ?? defaultAvatar(peer.id)}
                            ready={Boolean(peer)}
                            working={busy[peerChannel]}
                            typing={peerTyping}
                            compaction={compactions[peer.id]}
                          />
                          <span className="min-w-0 truncate text-sm font-semibold" title={peer.name}>
                            {peer.name}
                          </span>
                        </>
                      ) : (
                        <AgentName name={agent.name} />
                      )}
                    </div>
                  </>
                )}
                {isPhone && <AgentExchangeIcon />}
                <div className="ml-auto flex shrink-0 items-center gap-1 md:gap-2">
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="agent-dm-conversation"
                      className="hidden whitespace-nowrap text-xs text-muted-foreground md:inline"
                    >
                      Chat with
                    </label>
                    <div className="w-[clamp(5.5rem,34vw,8rem)] md:w-36">
                      <Select
                        id="agent-dm-conversation"
                        ariaLabel="Chat with"
                        value={conversationPeer}
                        onValueChange={value => {
                          if (value === 'load-more')
                            void dmConversations.load(
                              dmConversations.failed ? undefined : (dmConversations.cursor ?? undefined),
                            );
                          else chooseConversation(value);
                        }}
                        options={[
                          { value: 'you', label: 'You' },
                          ...peers.map(peer => ({
                            value: peer.id,
                            label: peer.name === 'You' ? 'You (agent)' : peer.name,
                            icon: <AgentAvatarArt {...(peer.avatar ?? defaultAvatar(peer.id))} size={20} />,
                          })),
                          ...discordPlaces.map(place => ({
                            value: `discord:${place.id}`,
                            label: place.label,
                            icon: <DiscordPlaceIcon kind={place.kind} />,
                          })),
                          ...(discordChannel && !discordPlace
                            ? [{ value: conversationPeer, label: 'Discord', icon: <DiscordPlaceIcon kind="text" /> }]
                            : []),
                          ...(dmConversations.cursor !== null || dmConversations.failed
                            ? [
                                {
                                  value: 'load-more',
                                  label: dmConversations.busy
                                    ? 'Loading conversations…'
                                    : dmConversations.failed
                                      ? 'Retry conversations'
                                      : 'More conversations…',
                                },
                              ]
                            : []),
                        ]}
                        triggerClassName="!h-11 !w-full !justify-between !px-3 !text-sm md:!h-7 md:!min-h-0 md:!px-2 md:!text-xs"
                        contentClassName="min-w-52 md:min-w-0"
                        triggerContent={
                          isPhone ? (
                            <>
                              <span className="min-w-0 flex-1 truncate">
                                {discordChannel ? (discordPlace?.short ?? 'Discord') : (peer?.name ?? 'You')}
                              </span>
                              <svg
                                aria-hidden="true"
                                viewBox="0 0 12 12"
                                className="size-3 shrink-0 text-muted-foreground"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="m2 4 4 4 4-4" />
                              </svg>
                            </>
                          ) : (
                            <>
                              <span className="flex min-w-0 items-center gap-1">
                                {discordChannel ? (
                                  <DiscordPlaceIcon kind={discordPlace?.kind ?? 'text'} />
                                ) : (
                                  peer && <AgentAvatarArt {...(peer.avatar ?? defaultAvatar(peer.id))} size={20} />
                                )}
                                <span className="min-w-0 truncate">
                                  {discordChannel ? (discordPlace?.short ?? 'Discord') : (peer?.name ?? 'You')}
                                </span>
                              </span>
                              <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                className="size-4 shrink-0 text-muted-foreground"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.7"
                              >
                                <path d="m6 9 6 6 6-6" />
                              </svg>
                            </>
                          )
                        }
                      />
                    </div>
                  </div>
                  {agent.real && (
                    <ChatFilesDialog
                      channelKey={
                        discordChannel
                          ? `discord:${discordChannel}`
                          : peer
                            ? dmFilesKey(agent.id, peer.id)
                            : chatFilesKey(agent.channelId)
                      }
                      title={
                        discordChannel
                          ? `${agent.name} on ${discordPlace?.place ?? 'Discord'}`
                          : peer
                            ? `${agent.name} and ${peer.name}`
                            : agent.name
                      }
                    />
                  )}
                  <AgentActivityPanel
                    agent={agent}
                    entries={activity[agent.id] ?? []}
                    open={activityOpen}
                    onOpenChange={setActivityOpen}
                    history={activityHistory}
                    loadActivity={loadActivity}
                    expandActivity={expandActivity}
                    retryActivity={retryActivity}
                    requestError={errors[agent.channelId]}
                    compaction={compactions[agent.id]}
                  />
                </div>
              </header>
              <AgentTodos key={agent.id} todos={agent.real?.todos ?? []} />

              <ScrollArea
                key={`${agent.id}:${conversationPeer}`}
                viewportRef={scrollRef}
                label="Chat history"
                onScroll={conversationPeer === 'you' ? history.onScroll : undefined}
                overlay={
                  conversationPeer === 'you' && (
                    <JumpToLatest viewport={scrollRef} newest={timeline.at(-1)?.id} onJump={history.toLatest} />
                  )
                }
                className="min-h-0 flex-1"
              >
                {conversationPeer === 'you' ? (
                  <>
                    {!historyReady[agent.channelId] && !historyFailed[agent.channelId] && <ChatSkeleton />}
                    {historyFailed[agent.channelId] ? (
                      <div className="px-5 pt-3 text-center">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={historyLoading[agent.channelId]}
                          onClick={() => void loadHistory(agent, Boolean(historyReady[agent.channelId]))}
                        >
                          Retry loading messages
                        </Button>
                      </div>
                    ) : (
                      historyReady[agent.channelId] && (
                        <>
                          {/* Older messages load as the reader nears the top; this stays for keyboard users. */}
                          {historyCursor[agent.channelId] != null && (
                            <button
                              type="button"
                              disabled={historyLoading[agent.channelId]}
                              onClick={history.loadOlder}
                              className="sr-only focus:not-sr-only focus:mx-auto focus:mt-3 focus:block focus:rounded-md focus:px-3 focus:py-1 focus:text-xs focus:ring-2 focus:ring-ring"
                            >
                              Load earlier messages
                            </button>
                          )}
                          {/* Always present while more exists above, so starting a load never shifts the view. */}
                          {(historyCursor[agent.channelId] != null ||
                            historyLoading[agent.channelId] ||
                            history.olderHidden) && <EdgeSkeleton label="Loading earlier messages…" />}
                        </>
                      )
                    )}
                    {(inbox.failed || inbox.cursor !== null) && (
                      <div className="px-5 pt-3 text-center">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={inbox.busy}
                          onClick={() => void inbox.load(inbox.failed ? undefined : (inbox.cursor ?? undefined))}
                        >
                          {inbox.failed ? 'Retry agent messages' : 'Earlier agent messages'}
                        </Button>
                      </div>
                    )}
                    {historyReady[agent.channelId] && (
                      <ConversationMessages
                        reactionChannel={agent.channelId}
                        messages={history.visible}
                        time={agent.time}
                        agentName={agent.name}
                        notices={inbox.messages.filter(
                          notice =>
                            (!history.olderHidden || notice.timestamp >= (history.visible[0]?.timestamp ?? 0)) &&
                            (!history.newerHidden ||
                              notice.timestamp <= (history.visible.at(-1)?.timestamp ?? Infinity)),
                        )}
                        onViewDm={notice => chooseConversation(notice.senderId)}
                        onReply={message => {
                          setReplyTargets(current => ({ ...current, [agent.channelId]: message }));
                          requestAnimationFrame(() => inputRef.current?.focus());
                        }}
                      />
                    )}
                    {history.newerHidden && <EdgeSkeleton label="Loading newer messages…" />}
                  </>
                ) : discordChannel && agent.real ? (
                  <DiscordTranscript
                    key={`${agent.id}:${discordChannel}`}
                    agentId={agent.id}
                    channelId={discordChannel}
                    agentName={agent.name}
                    agentAvatar={agent.avatar ?? defaultAvatar(agent.id)}
                    avatarOf={id => agents.find(item => item.id === id)?.avatar}
                    ownerName={organizations.find(org => org.id === agent.real?.organizationId)?.ownerName}
                    viewport={scrollRef}
                  />
                ) : peer ? (
                  <AgentDmTranscript
                    key={`${agent.id}:${peer.id}`}
                    agentId={agent.id}
                    peerId={peer.id}
                    bubbleView={{
                      agentName: agent.name,
                      peerName: peer.name,
                      agentAvatar: agent.avatar ?? defaultAvatar(agent.id),
                      peerAvatar: peer.avatar ?? defaultAvatar(peer.id),
                      viewport: scrollRef,
                    }}
                  />
                ) : (
                  <p className="p-5 text-sm text-muted-foreground">This agent is no longer available.</p>
                )}
              </ScrollArea>

              {conversationPeer === 'you' ? (
                <div className="mx-auto w-full max-w-4xl shrink-0 pl-[calc(1.5rem+env(safe-area-inset-left))] pr-[calc(1.5rem+env(safe-area-inset-right))] pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 sm:px-5 sm:pb-3">
                  <div className="w-full">
                    <div className="mb-1 flex h-5 min-w-0 items-center px-2">
                      <AgentTypingStatus
                        name={agent.name}
                        agentId={agent.id}
                        typing={selfTyping}
                        working={busy[agent.channelId]}
                        compaction={compactions[agent.id]}
                        connected={eventsConnected}
                        activity={activity[agent.id]}
                      />
                    </div>
                    <ChatComposer
                      key={agent.id}
                      name={agent.name}
                      draft={draft}
                      onChange={text => setDraft(agent.channelId, text)}
                      onSend={sendMessage}
                      busy={busy[agent.channelId]}
                      onStop={() => stop(agent.channelId)}
                      disabled={
                        historyLoading[agent.channelId] || (Boolean(agent.real) && !historyReady[agent.channelId])
                      }
                      inputRef={inputRef}
                      attachments={agent.real ? attachments : undefined}
                      reply={
                        replyTargets[agent.channelId]
                          ? {
                              author: replyTargets[agent.channelId].author === 'user' ? 'You' : agent.name,
                              text: replyExcerpt(
                                messagePreview(replyTargets[agent.channelId].text, replyTargets[agent.channelId].files),
                              ),
                            }
                          : undefined
                      }
                      onCancelReply={() => {
                        setReplyTargets(current => {
                          const next = { ...current };
                          delete next[agent.channelId];
                          return next;
                        });
                        inputRef.current?.focus();
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div
                  aria-label="Agent conversation status"
                  className="shrink-0 border-t border-border px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:py-3"
                >
                  {discordChannel ? (
                    <p className="text-center text-xs text-muted-foreground">
                      Discord · read-only here; {agent.name} posts through its bot
                    </p>
                  ) : selfTyping || peerTyping ? (
                    <div className="flex min-h-5 items-center gap-3">
                      <div className="flex min-w-0 flex-1">
                        <AgentTypingStatus name={agent.name} typing={selfTyping} />
                      </div>
                      <div className="flex min-w-0 flex-1 justify-end">
                        <AgentTypingStatus name={peer?.name ?? 'Agent'} typing={peerTyping} />
                      </div>
                    </div>
                  ) : (
                    <p className="text-center text-xs text-muted-foreground">
                      Agent-to-agent conversation · messages are sent by the agents
                    </p>
                  )}
                </div>
              )}
            </section>
          ) : (
            <section aria-label="No agent selected" className="hidden min-w-0 flex-1 md:flex">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia>
                    <ChatIcon />
                  </EmptyMedia>
                  <EmptyTitle>No conversation open</EmptyTitle>
                  <EmptyDescription>Select or create an agent to start chatting.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            </section>
          )}
        </Tabs.Content>

        <Tabs.Content value="dashboard" className="tab-enter min-h-0 flex-1 outline-none data-[state=active]:flex">
          {activeTab === 'dashboard' && (
            <Suspense fallback={loading}>
              <Dashboard />
            </Suspense>
          )}
        </Tabs.Content>

        <Tabs.Content value="computers" className="tab-enter min-h-0 flex-1 outline-none data-[state=active]:flex">
          {activeTab === 'computers' && (
            <Suspense fallback={loading}>
              <ComputersPanel
                agentState={agentState}
                viewingId={route.kind === 'computer' ? (route.computerId ?? null) : null}
                viewerView={route.computerView ?? 'desktop'}
                terminalId={route.terminalId ?? null}
                dialog={
                  route.kind === 'computer-new'
                    ? 'new'
                    : route.kind === 'computer-delete'
                      ? 'delete'
                      : route.kind === 'computer-settings'
                        ? 'settings'
                        : null
                }
                deleteId={route.kind === 'computer-delete' ? (route.computerId ?? null) : null}
                settingsId={route.kind === 'computer-settings' ? (route.computerId ?? null) : null}
                onOpen={id => navigate(computerPath(id))}
                onNavigate={navigate}
                onBack={() => navigate('/computers')}
              />
            </Suspense>
          )}
        </Tabs.Content>
        <Tabs.Content
          value="settings"
          forceMount
          className={cn(
            'tab-enter min-h-0 flex-1 outline-none data-[state=inactive]:hidden',
            route.kind === 'knowledge' || route.kind === 'audit' || route.kind === 'access'
              ? 'overflow-hidden data-[state=active]:flex data-[state=active]:flex-col'
              : 'overflow-y-auto pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0',
          )}
        >
          {/* Settings stays mounted after its first visit so endpoint edits survive switching tabs. */}
          <Suspense fallback={loading}>
            {(settingsSeen || activeTab === 'settings') && (
              <div
                className={
                  route.kind === 'knowledge' || route.kind === 'audit' || route.kind === 'access' ? 'hidden' : ''
                }
              >
                <Settings route={route} onNavigate={navigate} />
              </div>
            )}
            {route.kind === 'knowledge' && <KnowledgeBrowser id={route.knowledgeId} onNavigate={navigate} />}
            {route.kind === 'audit' && <AuditLog onNavigate={navigate} />}
            {route.kind === 'access' && <AccessLog onNavigate={navigate} />}
          </Suspense>
        </Tabs.Content>
      </Tabs.Root>

      <Portal
        open={portalOpen}
        onOpenChange={setPortalOpen}
        agents={agents}
        busy={busy}
        onNavigate={path => navigate(path)}
        onStop={stop}
      />
      <PortalWindows agentState={agentState} onNavigate={path => navigate(path)} />
      <ConfirmDialog
        open={pendingLeave !== null}
        onOpenChange={open => {
          if (!open) {
            setPendingLeave(null);
            pendingTabPath.current = '';
          }
        }}
        title="Discard unsaved changes?"
        confirmLabel="Discard and leave"
        busyLabel="Leaving…"
        onConfirm={async () => {
          pendingLeave?.();
        }}
        description={
          <>
            You have not saved your changes to <strong className="text-foreground">{unsaved.join(', ')}</strong>.
            Leaving this page discards them.
          </>
        }
      />
      {appUpdate.needRefresh && (
        <aside
          aria-label="Application update"
          className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border px-5 py-3 text-sm max-md:pb-[calc(5rem+env(safe-area-inset-bottom))]"
        >
          <p className="mr-auto">An update is ready.</p>
          <Button size="sm" onClick={() => void appUpdate.update()}>
            Reload
          </Button>
          <Button variant="outline" size="sm" onClick={appUpdate.dismiss}>
            Later
          </Button>
        </aside>
      )}
    </main>
  );
}
