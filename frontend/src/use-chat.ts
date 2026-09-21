import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import type { components, paths } from '@/api/schema';
import { previewAgents, type PreviewMessage } from '@/preview-data';

export type ActivityEntry = components['schemas']['AgentActivityEntry'];
const activityKinds = new Set(['system', 'user', 'assistant', 'thinking', 'tool_call', 'tool_result', 'reminder', 'channel', 'status', 'error']);

export type RealAgent = paths['/api/agents']['post']['responses'][200]['content']['application/json'];
export type ChatAgent = { id: string; name: string; initials: string; time: string; channelId: string; real?: RealAgent };
type SavedMessage = paths['/api/channels/{channelId}/messages']['get']['responses'][200]['content']['application/json']['messages'][number];
const asMessage = (message: SavedMessage): PreviewMessage => ({ id: message.id, author: message.role === 'user' ? 'user' : 'agent', text: message.text, time: clock(message.timestamp) });
const asAgent = (real: RealAgent): ChatAgent => ({ id: real.id, name: real.name, initials: real.name.slice(0, 2).toUpperCase(), time: clock(real.lastMessage?.timestamp ?? real.createdAt), channelId: real.channelId, real });
const clock = (timestamp = Date.now()) => new Date(timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s+/g, ' ');

export function useChat() {
  const [agents, setAgents] = useState<ChatAgent[]>(() => previewAgents.map(agent => ({ ...agent, channelId: agent.id })));
  const [conversations, setConversations] = useState<Record<string, PreviewMessage[]>>(() =>
    Object.fromEntries(previewAgents.map(agent => [agent.id, agent.messages.map((message, index) => ({ ...message, id: `${agent.id}-${index}` }))])),
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  const [activity, setActivity] = useState<Record<string, ActivityEntry[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const requests = useRef(new Map<string, AbortController>());
  const pendingMessages = useRef(new Map<string, PreviewMessage>());
  const agentRequest = useRef<AbortController | null>(null);
  const historyRequests = useRef(new Map<string, AbortController>());
  const loadedHistory = useRef(new Set<string>());
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsFailed, setAgentsFailed] = useState(false);
  const [agentsCursor, setAgentsCursor] = useState<number | null>(null);
  const [historyReady, setHistoryReady] = useState<Record<string, boolean>>({});
  const [historyLoading, setHistoryLoading] = useState<Record<string, boolean>>({});
  const [historyFailed, setHistoryFailed] = useState<Record<string, boolean>>({});
  const [historyCursor, setHistoryCursor] = useState<Record<string, number | null>>({});

  async function loadAgents(after?: number) {
    if (agentRequest.current && !agentRequest.current.signal.aborted) return;
    const controller = new AbortController(); agentRequest.current = controller;
    setAgentsLoading(true); setAgentsFailed(false);
    try {
      const { data, error } = await api.GET('/api/agents', { params: { query: { after } }, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (error || !data) throw new Error('Could not load agents');
      setConversations(current => {
        const next = { ...current };
        for (const real of data.agents) if (!(real.channelId in next)) next[real.channelId] = real.lastMessage ? [asMessage(real.lastMessage)] : [];
        return next;
      });
      setAgents(current => [...current, ...data.agents.filter(real => !current.some(item => item.id === real.id)).map(asAgent)]);
      setAgentsCursor(data.nextCursor);
    } catch { if (!controller.signal.aborted) setAgentsFailed(true); }
    finally { if (agentRequest.current === controller) { agentRequest.current = null; setAgentsLoading(false); } }
  }

  async function loadHistory(agent: ChatAgent, older = false) {
    const channel = agent.channelId;
    if (!agent.real || historyRequests.current.has(channel) || (!older && loadedHistory.current.has(channel)) || (older && !historyCursor[channel])) return;
    const controller = new AbortController(); historyRequests.current.set(channel, controller);
    setHistoryLoading(current => ({ ...current, [channel]: true }));
    setHistoryFailed(current => ({ ...current, [channel]: false }));
    try {
      const { data, error } = await api.GET('/api/channels/{channelId}/messages', { params: { path: { channelId: channel }, query: { before: older ? historyCursor[channel]! : undefined } }, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (error || !data) throw new Error('Could not load messages');
      setConversations(current => {
        const existing = current[channel] ?? [];
        const messages = data.messages.map(asMessage);
        return { ...current, [channel]: older ? [...messages.filter(item => !existing.some(row => row.id === item.id)), ...existing] : messages };
      });
      loadedHistory.current.add(channel);
      setHistoryReady(current => ({ ...current, [channel]: true }));
      setHistoryCursor(current => ({ ...current, [channel]: data.nextCursor }));
    } catch { if (!controller.signal.aborted) setHistoryFailed(current => ({ ...current, [channel]: true })); }
    finally { if (historyRequests.current.get(channel) === controller) { historyRequests.current.delete(channel); setHistoryLoading(current => ({ ...current, [channel]: false })); } }
  }

  useEffect(() => {
    void loadAgents();
    const abortAll = () => {
      agentRequest.current?.abort();
      for (const controller of [...requests.current.values(), ...historyRequests.current.values()]) controller.abort();
      requests.current.clear(); historyRequests.current.clear();
    };
    window.addEventListener('pagehide', abortAll);
    return () => { window.removeEventListener('pagehide', abortAll); abortAll(); };
  }, []);

  function addAgent(real: RealAgent) {
    const agent = asAgent(real);
    loadedHistory.current.add(real.channelId);
    setHistoryReady(current => ({ ...current, [real.channelId]: true }));
    setConversations(current => ({ ...current, [real.channelId]: current[real.channelId] ?? [] }));
    setAgents(current => current.some(item => item.id === agent.id) ? current : [...current, agent]);
    return agent;
  }

  function recordActivity(agentId: string, entry: ActivityEntry, append = false) {
    setActivity(current => {
      const entries = current[agentId] ?? [];
      const index = entries.findIndex(item => item.id === entry.id);
      if (index === -1) return { ...current, [agentId]: [...entries, entry] };
      return { ...current, [agentId]: entries.map((item, i) => i === index ? { ...entry, timestamp: item.timestamp, text: append ? item.text + entry.text : entry.text } : item) };
    });
  }

  function recordError(agent: ChatAgent, text: string) {
    recordActivity(agent.id, { id: crypto.randomUUID(), runId: 'client', channelId: agent.channelId, kind: 'error', label: 'Request error', text, timestamp: Date.now() });
  }

  async function receive(agent: ChatAgent, message: PreviewMessage, controller: AbortController) {
    const channelId = agent.channelId;
    let accepted = false;
    try {
      const { data, error } = await api.POST('/api/chat', {
        body: { agentId: agent.id, clientMessageId: message.id, message: message.text },
        parseAs: 'stream' as const, signal: controller.signal,
      });
      if (error || !data) {
        const text = error?.message ?? 'Could not start the channel response.';
        setErrors(current => ({ ...current, [channelId]: text })); recordError(agent, text); return;
      }
      const reader = data.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;
      try {
        while (!controller.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > 256000) throw new Error('Oversized channel event');
          let boundary: number;
          while ((boundary = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 1);
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (event.type === 'activity' && event.agentId === agent.id) {
              const entry = event.entry;
              if (entry && ['id', 'runId', 'channelId', 'label', 'text'].every(key => typeof entry[key] === 'string') && activityKinds.has(entry.kind) && Number.isFinite(entry.timestamp)) {
                recordActivity(agent.id, entry as ActivityEntry, event.append === true);
              }
            } else if (event.type === 'typing' && event.channelId === channelId && typeof event.active === 'boolean') {
              setTyping(current => ({ ...current, [channelId]: event.active }));
            } else if ((event.type === 'channel_message' || event.type === 'user_message') && event.channelId === channelId && typeof event.text === 'string' && typeof event.id === 'string') {
              if (event.type === 'user_message' && event.id === message.id) { accepted = true; pendingMessages.current.delete(channelId); }
              const published: PreviewMessage = { id: event.id, author: event.type === 'user_message' ? 'user' : 'agent', text: event.text, time: clock(event.timestamp) };
              setConversations(current => {
                const messages = current[channelId] ?? [];
                return { ...current, [channelId]: messages.some(item => item.id === published.id) ? messages.map(item => item.id === published.id ? published : item) : [...messages, published] };
              });
            } else if (event.type === 'error' && typeof event.message === 'string') {
              setTyping(current => ({ ...current, [channelId]: false }));
              setErrors(current => ({ ...current, [channelId]: event.message }));
              recordError(agent, event.message);
            } else if (event.type === 'done') {
              completed = true;
              setTyping(current => ({ ...current, [channelId]: false }));
            }
            // Unrouted model output is never interpreted as a channel message.
          }
        }
        if (!completed && !controller.signal.aborted) throw new Error('Channel disconnected');
      } finally { reader.releaseLock(); }
    } catch {
      if (!controller.signal.aborted) {
        const text = 'Connection interrupted. Check the backend and endpoint, then try again.';
        setErrors(current => ({ ...current, [channelId]: text })); recordError(agent, text);
        controller.abort();
      }
    } finally {
      if (!accepted) setDrafts(current => current[channelId] ? current : { ...current, [channelId]: message.text });
      if (requests.current.get(channelId) === controller) {
        requests.current.delete(channelId);
        setBusy(current => ({ ...current, [channelId]: false }));
        setTyping(current => ({ ...current, [channelId]: false }));
      }
    }
  }

  function send(agent: ChatAgent, text: string) {
    text = text.trim();
    if (!text || requests.current.has(agent.channelId) || historyRequests.current.has(agent.channelId) || (agent.real && !loadedHistory.current.has(agent.channelId))) return;
    const pending = pendingMessages.current.get(agent.channelId);
    const message: PreviewMessage = pending?.text === text ? pending : { id: crypto.randomUUID(), author: 'user', text, time: clock() };
    if (agent.real) pendingMessages.current.set(agent.channelId, message);
    else setConversations(current => ({ ...current, [agent.channelId]: [...current[agent.channelId], message] }));
    setDrafts(current => ({ ...current, [agent.channelId]: '' }));
    setErrors(current => ({ ...current, [agent.channelId]: '' }));
    setTyping(current => ({ ...current, [agent.channelId]: false }));
    if (agent.real) {
      const controller = new AbortController();
      requests.current.set(agent.channelId, controller);
      setBusy(current => ({ ...current, [agent.channelId]: true }));
      void receive(agent, message, controller);
    }
    return message.id;
  }

  function stop(channelId: string) {
    requests.current.get(channelId)?.abort();
    setTyping(current => ({ ...current, [channelId]: false }));
    setErrors(current => ({ ...current, [channelId]: 'Response stopped.' }));
    const agent = agents.find(item => item.channelId === channelId);
    if (agent) recordActivity(agent.id, { id: crypto.randomUUID(), runId: 'client', channelId, kind: 'status', label: 'Stopped', text: 'Response stopped by the user.', timestamp: Date.now() });
  }

  return { agents, conversations, drafts, busy, typing, activity, errors, addAgent, send, stop,
    agentsLoading, agentsFailed, agentsCursor, loadAgents, historyReady, historyLoading, historyFailed, historyCursor, loadHistory,
    setDraft: (channelId: string, text: string) => setDrafts(current => ({ ...current, [channelId]: text })) };
}
