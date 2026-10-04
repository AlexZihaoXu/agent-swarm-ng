import { recordScratchActivity } from '@/lib/scratch-writers';
import { recordTerminalActivity } from '@/lib/terminal-typists';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import { consumeEvents } from '@/api/events';
import type { components, paths } from '@/api/schema';
import type { ChatMessage } from '@/chat-types';
import { createNotificationSound } from '@/lib/notification-sound';
import { useRunEvents } from '@/use-run-events';
import { defaultAvatar, type AvatarAppearance } from '@/lib/agent-avatar';
import { randomUuid } from '@/lib/random-uuid';
import { chatFiles, isChatFile, replaceFile } from '@/lib/chat-files';
import { useActivityHistory } from '@/use-activity-history';
import { clockTime } from '@/lib/format-time';

export type ActivityEntry = components['schemas']['AgentActivityEntry'];
const activityKinds = new Set([
  'system',
  'user',
  'assistant',
  'thinking',
  'tool_call',
  'tool_result',
  'reminder',
  'channel',
  'status',
  'error',
]);
export type RealAgent = paths['/api/agents']['post']['responses'][200]['content']['application/json'];
export type ChatAgent = {
  id: string;
  name: string;
  initials: string;
  time: string;
  channelId: string;
  avatar?: AvatarAppearance;
  real?: RealAgent;
};
type SavedMessage =
  paths['/api/channels/{channelId}/messages']['get']['responses'][200]['content']['application/json']['messages'][number];
type Run = {
  runId: string;
  agentId: string;
  channelId: string;
  clientMessageId: string;
  typing?: boolean;
  typingTargets?: string[];
};
const asMessage = (message: SavedMessage): ChatMessage => ({
  id: message.id,
  sequence: message.sequence,
  author: message.role === 'user' ? 'user' : 'agent',
  text: message.text,
  timestamp: message.timestamp,
  time: clock(message.timestamp),
  replyTo: message.replyTo,
  ...(message.files?.length ? { files: message.files } : {}),
  ...(message.author ? { writer: message.author.name } : {}),
});
export const asAgent = (real: RealAgent): ChatAgent => ({
  avatar: real.avatar ?? defaultAvatar(real.id),
  id: real.id,
  name: real.name,
  initials: real.name.slice(0, 2).toUpperCase(),
  time: clock(real.lastMessage?.timestamp ?? real.createdAt),
  channelId: real.channelId,
  real,
});
const clock = (timestamp = Date.now()) => clockTime(timestamp);
function withoutKey<T>(record: Record<string, T>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}
function remember(set: Set<string>, key: string) {
  if (set.has(key)) return true;
  set.add(key);
  if (set.size > 10000) set.delete(set.values().next().value!);
  return false;
}
const ordered = (messages: ChatMessage[]) =>
  messages.sort((a, b) => (a.sequence ?? Infinity) - (b.sequence ?? Infinity));

export function useChat() {
  const [agents, setAgents] = useState<ChatAgent[]>([]);
  const [conversations, setConversations] = useState<Record<string, ChatMessage[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  const [typingTargets, setTypingTargets] = useState<Record<string, string[]>>({});
  const {
    activity,
    recordActivity,
    removeActivity,
    refreshActivity,
    loadActivity,
    expandActivity,
    retryActivity,
    activityHistory,
  } = useActivityHistory();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const notification = useRef<ReturnType<typeof createNotificationSound> | null>(null);
  const removedAgents = useRef(new Set<string>());
  const seenEvents = useRef(new Set<string>());
  const completedRuns = useRef(new Set<string>());
  const knownMessages = useRef(new Set<string>());
  const activeRuns = useRef(new Map<string, Run>());
  const peerRuns = useRef(new Map<string, Run>());
  const [peerBusy, setPeerBusy] = useState<Record<string, boolean>>({});
  /** Agents compacting their memory in the background, or asleep until it is done. */
  const [compactions, setCompactions] = useState<Record<string, 'running' | 'sleeping'>>({});
  const refreshPeerBusy = () =>
    setPeerBusy(Object.fromEntries([...peerRuns.current.values()].map(run => [run.agentId, true])));
  const requests = useRef(new Map<string, AbortController>());
  const pendingMessages = useRef(new Map<string, ChatMessage>());
  const agentRequest = useRef<AbortController | null>(null);
  const historyRequests = useRef(new Map<string, AbortController>());
  const loadedHistory = useRef(new Set<string>());
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsFailed, setAgentsFailed] = useState(false);
  const [agentsCursor, setAgentsCursor] = useState<number | null>(null);
  const [historyReady, setHistoryReady] = useState<Record<string, boolean>>({});
  const [historyLoading, setHistoryLoading] = useState<Record<string, boolean>>({});
  const [historyFailed, setHistoryFailed] = useState<Record<string, boolean>>({});
  const [historyCursor, setHistoryCursor] = useState<Record<string, number | null>>({});

  function acknowledge(channel: string, id: string) {
    const pending = pendingMessages.current.get(channel);
    if (pending?.id !== id) return;
    pendingMessages.current.delete(channel);
    setDrafts(current => (current[channel] === pending.text ? { ...current, [channel]: '' } : current));
  }

  async function loadAgents(after?: number, refresh = false) {
    if (agentRequest.current && !agentRequest.current.signal.aborted) return;
    const controller = new AbortController();
    agentRequest.current = controller;
    setAgentsLoading(true);
    setAgentsFailed(false);
    try {
      const { data, error } = await api.GET('/api/agents', { params: { query: { after } }, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (error || !data) throw new Error('Could not load agents');
      const incoming = data.agents.filter(real => !removedAgents.current.has(real.id));
      for (const real of incoming)
        if (real.lastMessage) remember(knownMessages.current, `${real.channelId}:${real.lastMessage.id}`);
      setConversations(current => {
        const next = { ...current };
        for (const real of incoming) {
          const last = real.lastMessage ? asMessage(real.lastMessage) : undefined;
          if (!(real.channelId in next)) next[real.channelId] = last ? [last] : [];
          else if (
            !loadedHistory.current.has(real.channelId) &&
            last &&
            (last.sequence ?? 0) > (next[real.channelId].at(-1)?.sequence ?? 0)
          )
            next[real.channelId] = [last];
        }
        return next;
      });
      setAgents(current => [
        ...current.map(agent => {
          const updated = incoming.find(item => item.id === agent.id);
          return updated ? asAgent(updated) : agent;
        }),
        ...incoming.filter(real => !current.some(item => item.id === real.id)).map(asAgent),
      ]);
      if (!refresh || agents.length === 0) setAgentsCursor(data.nextCursor);
    } catch {
      if (!controller.signal.aborted) setAgentsFailed(true);
    } finally {
      if (agentRequest.current === controller) {
        agentRequest.current = null;
        setAgentsLoading(false);
      }
    }
  }

  async function loadHistory(agent: ChatAgent, older = false, refresh = false) {
    const channel = agent.channelId;
    if (!agent.real || removedAgents.current.has(agent.id)) return;
    if (refresh) {
      historyRequests.current.get(channel)?.abort();
      historyRequests.current.delete(channel);
    }
    if (
      historyRequests.current.has(channel) ||
      (!refresh && !older && loadedHistory.current.has(channel)) ||
      (older && !historyCursor[channel])
    )
      return;
    const before = new Set((conversations[channel] ?? []).map(message => message.id));
    const controller = new AbortController();
    historyRequests.current.set(channel, controller);
    setHistoryLoading(current => ({ ...current, [channel]: true }));
    setHistoryFailed(current => ({ ...current, [channel]: false }));
    try {
      const { data, error } = await api.GET('/api/channels/{channelId}/messages', {
        params: { path: { channelId: channel }, query: { before: older ? historyCursor[channel]! : undefined } },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (error || !data) throw new Error('Could not load messages');
      for (const message of data.messages) {
        remember(knownMessages.current, `${channel}:${message.id}`);
        if (message.role === 'user') acknowledge(channel, message.id);
      }
      setConversations(current => {
        const existing = current[channel] ?? [];
        const messages = data.messages.map(asMessage);
        const ids = new Set(messages.map(message => message.id));
        const newest = data.messages.at(-1)?.sequence ?? 0;
        const live = existing.filter(
          item => !before.has(item.id) && !ids.has(item.id) && (item.sequence === undefined || item.sequence > newest),
        );
        return {
          ...current,
          [channel]: older
            ? [...messages.filter(item => !existing.some(row => row.id === item.id)), ...existing]
            : ordered([...messages, ...live]),
        };
      });
      loadedHistory.current.add(channel);
      setHistoryReady(current => ({ ...current, [channel]: true }));
      setHistoryCursor(current => ({ ...current, [channel]: data.nextCursor }));
    } catch {
      if (!controller.signal.aborted) setHistoryFailed(current => ({ ...current, [channel]: true }));
    } finally {
      if (historyRequests.current.get(channel) === controller) {
        historyRequests.current.delete(channel);
        setHistoryLoading(current => ({ ...current, [channel]: false }));
      }
    }
  }

  useEffect(() => {
    const sound = createNotificationSound();
    notification.current = sound;
    const unlockSound = () => {
      void sound.unlock();
    };
    window.addEventListener('pointerdown', unlockSound, true);
    window.addEventListener('keydown', unlockSound, true);
    void loadAgents();
    const abortObservers = () => {
      agentRequest.current?.abort();
      for (const controller of [...requests.current.values(), ...historyRequests.current.values()]) controller.abort();
      requests.current.clear();
      historyRequests.current.clear();
    };
    window.addEventListener('pagehide', abortObservers);
    return () => {
      window.removeEventListener('pagehide', abortObservers);
      abortObservers();
      window.removeEventListener('pointerdown', unlockSound, true);
      window.removeEventListener('keydown', unlockSound, true);
      sound.dispose();
      notification.current = null;
    };
  }, []);

  function addAgent(real: RealAgent, fresh = true) {
    const agent = asAgent(real);
    if (fresh) {
      loadedHistory.current.add(real.channelId);
      setHistoryReady(current => ({ ...current, [real.channelId]: true }));
    }
    setConversations(current => ({ ...current, [real.channelId]: current[real.channelId] ?? [] }));
    setAgents(current => (current.some(item => item.id === agent.id) ? current : [...current, agent]));
    return agent;
  }
  /** Apply a saved change (name, model, ...) returned by the API without reloading the roster. */
  function applyAgent(real: RealAgent) {
    setAgents(current => current.map(item => (item.id === real.id ? asAgent(real) : item)));
  }
  async function deleteAgent(agent: ChatAgent, confirmation: string) {
    if (confirmation !== agent.name) throw new Error('Type the exact agent name to confirm deletion.');
    const { error, response } = await api.DELETE('/api/agents/{id}', {
      params: { path: { id: agent.id } },
      body: { confirmation },
    });
    if (!response.ok && response.status !== 404)
      throw new Error(error?.message ?? 'Could not delete the agent. Try again.');
    const channel = agent.channelId;
    removedAgents.current.add(agent.id);
    activeRuns.current.delete(channel);
    requests.current.get(channel)?.abort();
    requests.current.delete(channel);
    historyRequests.current.get(channel)?.abort();
    historyRequests.current.delete(channel);
    pendingMessages.current.delete(channel);
    loadedHistory.current.delete(channel);
    setAgents(current => current.filter(item => item.id !== agent.id));
    window.dispatchEvent(new Event('swarm-dm-updated'));
    setConversations(current => withoutKey(current, channel));
    setDrafts(current => withoutKey(current, channel));
    setBusy(current => withoutKey(current, channel));
    setTyping(current => withoutKey(current, channel));
    setTypingTargets(current => withoutKey(current, channel));
    setErrors(current => withoutKey(current, channel));
    removeActivity(agent.id);
    setHistoryReady(current => withoutKey(current, channel));
    setHistoryLoading(current => withoutKey(current, channel));
    setHistoryFailed(current => withoutKey(current, channel));
    setHistoryCursor(current => withoutKey(current, channel));
  }
  function recordError(agent: ChatAgent, text: string) {
    setErrors(current => ({ ...current, [agent.channelId]: text }));
  }

  function applyEvent(event: Record<string, any>) {
    if (event.type === 'heartbeat') return;
    // An agent's todo list changed (todo_write): shown live (docs/agent-todos.md).
    if (event.type === 'todos_updated' && typeof event.agentId === 'string' && Array.isArray(event.todos)) {
      const todos = event.todos as RealAgent['todos'];
      setAgents(current =>
        current.map(item =>
          item.id === event.agentId && item.real ? { ...item, real: { ...item.real, todos } } : item,
        ),
      );
      return;
    }
    if (event.type === 'compaction' && typeof event.agentId === 'string') {
      const agentId = event.agentId;
      const state = event.state === 'running' || event.state === 'sleeping' ? event.state : null;
      setCompactions(current => {
        const next = { ...current };
        if (state) next[agentId] = state;
        else delete next[agentId];
        return next;
      });
      return;
    }
    if (event.type === 'snapshot' && event.compactions && typeof event.compactions === 'object')
      setCompactions(
        Object.fromEntries(
          Object.entries(event.compactions as Record<string, unknown>).filter(
            (entry): entry is [string, 'running' | 'sleeping'] => entry[1] === 'running' || entry[1] === 'sleeping',
          ),
        ),
      );
    if (event.type === 'snapshot' && Array.isArray(event.runs)) {
      const runs = event.runs.filter(
        (run: Run) =>
          run &&
          !removedAgents.current.has(run.agentId) &&
          !completedRuns.current.has(run.runId) &&
          ['agentId', 'channelId', 'runId', 'clientMessageId'].every(
            key => typeof (run as Record<string, unknown>)[key] === 'string',
          ),
      ) as Run[];
      const peers = runs.filter(run => run.channelId.startsWith('dm:'));
      peerRuns.current = new Map(peers.map(run => [run.runId, run]));
      refreshPeerBusy();
      activeRuns.current = new Map(
        runs.filter(run => !run.channelId.startsWith('dm:')).map(run => [run.channelId, run]),
      );
      window.dispatchEvent(new Event('swarm-dm-updated'));
      window.dispatchEvent(new Event('swarm-groups-reconnected'));
      for (const run of runs) acknowledge(run.channelId, run.clientMessageId);
      const pending = [...requests.current.keys()].filter(channel => pendingMessages.current.has(channel));
      setBusy(
        Object.fromEntries([...pending.map(channel => [channel, true]), ...runs.map(run => [run.channelId, true])]),
      );
      setTyping(Object.fromEntries(runs.map(run => [run.channelId, run.typing === true])));
      setTypingTargets(
        Object.fromEntries(
          runs.map(run => [
            run.channelId,
            Array.isArray(run.typingTargets) ? run.typingTargets.filter(id => typeof id === 'string') : [],
          ]),
        ),
      );
      void loadAgents(undefined, true);
      refreshActivity();
      for (const agent of agents)
        if (
          loadedHistory.current.has(agent.channelId) ||
          historyRequests.current.has(agent.channelId) ||
          historyLoading[agent.channelId] ||
          historyFailed[agent.channelId]
        )
          void loadHistory(agent, false, true);
      return;
    }
    if (typeof event.eventId === 'string' && remember(seenEvents.current, event.eventId)) return;
    if (
      event.type === 'terminal_activity' &&
      ['agentId', 'computerId', 'session', 'name'].every(key => typeof event[key] === 'string') &&
      typeof event.active === 'boolean'
    ) {
      recordTerminalActivity(event as Parameters<typeof recordTerminalActivity>[0]);
      return;
    }
    if (
      event.type === 'scratch_activity' &&
      typeof event.agentId === 'string' &&
      typeof event.path === 'string' &&
      typeof event.active === 'boolean'
    ) {
      recordScratchActivity(event as Parameters<typeof recordScratchActivity>[0]);
      return;
    }
    if (event.type === 'file_deleted' && isChatFile(event.file)) {
      const file = event.file;
      if (file.channelKey.startsWith('chat:')) {
        const channel = file.channelKey.slice(5);
        setConversations(current => {
          const messages = current[channel];
          const next = messages && replaceFile(messages, file);
          return next && next !== messages ? { ...current, [channel]: next } : current;
        });
      }
      window.dispatchEvent(new CustomEvent('swarm-file-deleted', { detail: file }));
      return;
    }
    if (event.type === 'reactions_updated' && typeof event.channelId === 'string') {
      window.dispatchEvent(new CustomEvent('swarm-reactions-updated', { detail: event.channelId }));
      return;
    }
    if (event.type === 'group_deleted' && typeof event.groupId === 'string') {
      window.dispatchEvent(new CustomEvent('swarm-group-deleted', { detail: event.groupId }));
      return;
    }
    if (event.type === 'group_updated' && typeof event.groupId === 'string') {
      window.dispatchEvent(
        new CustomEvent('swarm-groups-updated', { detail: { groupId: event.groupId, message: event.message } }),
      );
      if (
        event.publication &&
        event.message?.role === 'assistant' &&
        typeof event.message.id === 'string' &&
        !remember(knownMessages.current, `group:${event.groupId}:${event.message.id}`)
      )
        notification.current?.play();
      return;
    }
    const channel = event.channelId ?? event.entry?.channelId;
    if (typeof channel !== 'string' || removedAgents.current.has(event.agentId)) return;
    if (event.type === 'dm_updated') {
      window.dispatchEvent(new CustomEvent('swarm-dm-updated', { detail: event.conversationId }));
      return;
    }
    if (channel.startsWith('dm:')) {
      if (
        (event.type === 'run_queued' || event.type === 'run_started') &&
        ['runId', 'agentId', 'clientMessageId'].every(key => typeof event[key] === 'string') &&
        !completedRuns.current.has(event.runId)
      )
        peerRuns.current.set(event.runId, event as Run);
      if (event.type === 'done') {
        remember(completedRuns.current, event.runId);
        peerRuns.current.delete(event.runId);
      }
      if (
        event.type === 'activity' &&
        event.entry?.channelId === channel &&
        ['id', 'runId', 'channelId', 'label', 'text'].every(key => typeof event.entry[key] === 'string') &&
        activityKinds.has(event.entry.kind) &&
        Number.isFinite(event.entry.timestamp)
      )
        recordActivity(event.agentId, event.entry as ActivityEntry, event.append === true);
      if (['run_queued', 'run_started', 'done'].includes(event.type)) refreshPeerBusy();
      return;
    }
    const agent = agents.find(item => item.channelId === channel);
    if (agent && typeof event.agentId === 'string' && event.agentId !== agent.id) return;
    const active = activeRuns.current.get(channel);
    if (event.type === 'typing' && completedRuns.current.has(event.runId)) return;
    if (event.type === 'done' && typeof event.runId === 'string') remember(completedRuns.current, event.runId);
    if (event.runId && active && active.runId !== event.runId && ['typing', 'error', 'done'].includes(event.type))
      return;
    if (
      (event.type === 'run_started' || event.type === 'run_queued') &&
      ['runId', 'agentId', 'clientMessageId'].every(key => typeof event[key] === 'string')
    ) {
      if (completedRuns.current.has(event.runId) || active?.runId === event.runId) return;
      activeRuns.current.set(channel, event as Run);
      setBusy(current => ({ ...current, [channel]: true }));
      setTyping(current => ({ ...current, [channel]: event.typing === true }));
      setTypingTargets(current => ({
        ...current,
        [channel]: Array.isArray(event.typingTargets)
          ? event.typingTargets.filter((id: unknown) => typeof id === 'string')
          : [],
      }));
    } else if (event.type === 'activity' && agent && agent.id === event.agentId) {
      const entry = event.entry;
      if (
        entry &&
        entry.channelId === channel &&
        ['id', 'runId', 'channelId', 'label', 'text'].every(key => typeof entry[key] === 'string') &&
        activityKinds.has(entry.kind) &&
        Number.isFinite(entry.timestamp)
      )
        recordActivity(agent.id, entry as ActivityEntry, event.append === true);
    } else if (event.type === 'typing' && typeof event.active === 'boolean') {
      setTyping(current => ({ ...current, [channel]: event.active }));
      setTypingTargets(current => ({
        ...current,
        [channel]: Array.isArray(event.targets) ? event.targets.filter((id: unknown) => typeof id === 'string') : [],
      }));
    } else if (
      (event.type === 'channel_message' || event.type === 'user_message') &&
      typeof event.text === 'string' &&
      typeof event.id === 'string'
    ) {
      if (event.type === 'user_message') {
        acknowledge(channel, event.id);
        if (!active && !completedRuns.current.has(event.runId))
          activeRuns.current.set(channel, {
            agentId: event.agentId,
            channelId: channel,
            runId: event.runId ?? event.id,
            clientMessageId: event.id,
          });
      }
      const duplicate = remember(knownMessages.current, `${channel}:${event.id}`);
      if (event.type === 'channel_message' && !duplicate) void notification.current?.play();
      const reference = event.replyTo;
      const replyTo: ChatMessage['replyTo'] =
        reference &&
        typeof reference.id === 'string' &&
        typeof reference.text === 'string' &&
        ['user', 'assistant'].includes(reference.role)
          ? { id: reference.id, role: reference.role, text: reference.text }
          : null;
      const published: ChatMessage = {
        id: event.id,
        sequence: event.sequence,
        author: event.type === 'user_message' ? 'user' : 'agent',
        text: event.text,
        timestamp: event.timestamp ?? Date.now(),
        time: clock(event.timestamp),
        replyTo,
        ...(chatFiles(event.files)?.length ? { files: chatFiles(event.files) } : {}),
      };
      setConversations(current => {
        const messages = current[channel] ?? [];
        return {
          ...current,
          [channel]: messages.some(item => item.id === published.id)
            ? messages.map(item => (item.id === published.id ? published : item))
            : ordered([...messages, published]),
        };
      });
    } else if (event.type === 'error' && typeof event.message === 'string') {
      setTyping(current => ({ ...current, [channel]: false }));
      if (agent) recordError(agent, event.message);
    } else if (event.type === 'done') {
      activeRuns.current.delete(channel);
      setBusy(current => ({ ...current, [channel]: false }));
      setTyping(current => ({ ...current, [channel]: false }));
      // A follow-up POST may still be saving when this run finishes. Do not abort it.
    }
  }
  const eventsConnected = useRunEvents(applyEvent);

  async function receive(agent: ChatAgent, message: ChatMessage, controller: AbortController) {
    const channel = agent.channelId;
    let accepted = false,
      completed = false;
    try {
      const { data, error, response } = await api.POST('/api/chat', {
        headers: { Prefer: 'respond-async' },
        body: {
          agentId: agent.id,
          clientMessageId: message.id,
          message: message.text,
          replyToMessageId: message.replyTo?.id,
          ...(message.fileIds?.length ? { fileIds: message.fileIds } : {}),
        },
        parseAs: 'stream',
        signal: controller.signal,
      });
      if (error || !data) {
        recordError(agent, error?.message ?? 'Could not start the channel response.');
        return;
      }
      if (response.status === 202) {
        const result = await new Response(data).json();
        if (
          result.run?.agentId !== agent.id ||
          result.run?.channelId !== channel ||
          typeof result.run?.clientMessageId !== 'string' ||
          typeof result.run?.runId !== 'string' ||
          result.message?.id !== message.id ||
          result.message?.channelId !== channel
        )
          throw new Error('Invalid save acknowledgment');
        accepted = true;
        applyEvent({ type: 'run_started', ...result.run });
        applyEvent({ type: 'user_message', ...result.message, agentId: agent.id, runId: result.run.runId });
        return;
      }
      await consumeEvents(data, controller.signal, event => {
        if ((event.channelId && event.channelId !== channel) || (event.agentId && event.agentId !== agent.id)) return;
        if (event.type === 'user_message' && event.id === message.id) accepted = true;
        if (event.type === 'done') completed = true;
        applyEvent({ ...event, agentId: event.agentId ?? agent.id, channelId: event.channelId ?? channel });
      });
      if (!completed && !controller.signal.aborted) throw new Error('Observer disconnected');
    } catch {
      if (!controller.signal.aborted)
        recordError(
          agent,
          'Connection interrupted. Accepted work continues on the backend; reconnecting will restore published history.',
        );
    } finally {
      const stillPending = pendingMessages.current.get(channel)?.id === message.id;
      if (!accepted && stillPending && !removedAgents.current.has(agent.id))
        setDrafts(current => (current[channel] ? current : { ...current, [channel]: message.text }));
      if (requests.current.get(channel) === controller) {
        requests.current.delete(channel);
        if (!accepted && stillPending && !activeRuns.current.has(channel)) {
          setBusy(current => ({ ...current, [channel]: false }));
          setTyping(current => ({ ...current, [channel]: false }));
        }
      }
    }
  }
  function send(agent: ChatAgent, text: string, replyTo?: ChatMessage['replyTo'], fileIds: string[] = []) {
    text = text.trim();
    if (
      !agent.real ||
      (!text && !fileIds.length) ||
      requests.current.has(agent.channelId) ||
      historyRequests.current.has(agent.channelId) ||
      !loadedHistory.current.has(agent.channelId)
    )
      return;
    const pending = pendingMessages.current.get(agent.channelId);
    const message: ChatMessage =
      pending?.text === text &&
      (pending.replyTo?.id ?? null) === (replyTo?.id ?? null) &&
      (pending.fileIds ?? []).join() === fileIds.join()
        ? pending
        : { id: randomUuid(), author: 'user', text, time: clock(), replyTo, fileIds };
    pendingMessages.current.set(agent.channelId, message);
    setDrafts(current => ({ ...current, [agent.channelId]: '' }));
    setErrors(current => ({ ...current, [agent.channelId]: '' }));
    setTyping(current => ({ ...current, [agent.channelId]: false }));
    const controller = new AbortController();
    requests.current.set(agent.channelId, controller);
    setBusy(current => ({ ...current, [agent.channelId]: true }));
    void receive(agent, message, controller);
    return message.id;
  }
  async function editAvatar(agent: ChatAgent, avatar: AvatarAppearance, allowedDmAgentIds: string[]) {
    const { data, error } = await api.PATCH('/api/agents/{id}/settings', {
      params: { path: { id: agent.id } },
      body: { avatar, allowedDmAgentIds },
    });
    if (!data?.avatar || error) throw new Error(error?.message ?? 'Could not save agent settings.');
    const savedAvatar = data.avatar;
    setAgents(current =>
      current.map(item =>
        item.id === agent.id
          ? { ...item, avatar: savedAvatar, real: item.real ? { ...item.real, avatar: savedAvatar } : undefined }
          : item,
      ),
    );
  }
  async function stop(channelId: string) {
    const agent = agents.find(item => item.channelId === channelId);
    const peer = [...peerRuns.current.values()].find(run => run.agentId === agent?.id);
    const clientMessageId =
      activeRuns.current.get(channelId)?.clientMessageId ??
      (requests.current.has(channelId) ? pendingMessages.current.get(channelId)?.id : undefined) ??
      peer?.clientMessageId;
    if (!agent || !clientMessageId) return;
    try {
      const { response } = await api.POST('/api/agents/{id}/stop', {
        params: { path: { id: agent.id } },
        body: { clientMessageId },
      });
      if (!response.ok) throw new Error('Stop failed');
      if (peer?.clientMessageId === clientMessageId) {
        peerRuns.current.delete(peer.runId);
        refreshPeerBusy();
        return;
      }
      const current = activeRuns.current.get(channelId);
      if (current && current.clientMessageId !== clientMessageId) return;
      if (current) remember(completedRuns.current, current.runId);
      activeRuns.current.delete(channelId);
      requests.current.get(channelId)?.abort();
      requests.current.delete(channelId);
      setBusy(value => ({ ...value, [channelId]: false }));
      setTyping(value => ({ ...value, [channelId]: false }));
    } catch {
      recordError(agent, 'Could not stop the backend run. Check the connection and try again.');
    }
  }
  const visibleBusy = { ...busy };
  for (const agent of agents) if (peerBusy[agent.id]) visibleBusy[agent.channelId] = true;
  return {
    agents,
    compactions,
    conversations,
    drafts,
    busy: visibleBusy,
    peerBusy,
    typing,
    typingTargets,
    activity,
    errors,
    addAgent,
    applyAgent,
    runOf: (channelId: string) => activeRuns.current.get(channelId),
    deleteAgent,
    editAvatar,
    send,
    stop,
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
    setDraft: (channelId: string, text: string) => setDrafts(current => ({ ...current, [channelId]: text })),
  };
}
