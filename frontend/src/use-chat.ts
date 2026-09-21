import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import type { components, paths } from '@/api/schema';
import { previewAgents, type PreviewMessage } from '@/preview-data';

export type ActivityEntry = components['schemas']['AgentActivityEntry'];
const activityKinds = new Set(['system', 'user', 'assistant', 'thinking', 'tool_call', 'tool_result', 'reminder', 'channel', 'status', 'error']);

export type RealAgent = paths['/api/agents']['post']['responses'][200]['content']['application/json'];
export type ChatAgent = { id: string; name: string; initials: string; time: string; channelId: string; real?: RealAgent };
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

  useEffect(() => {
    const abortAll = () => { for (const controller of requests.current.values()) controller.abort(); requests.current.clear(); };
    window.addEventListener('pagehide', abortAll);
    return () => { window.removeEventListener('pagehide', abortAll); abortAll(); };
  }, []);

  function addAgent(real: RealAgent) {
    const agent: ChatAgent = { id: real.id, name: real.name, initials: real.name.slice(0, 2).toUpperCase(), time: clock(), channelId: real.channelId, real };
    setConversations(current => ({ ...current, [real.channelId]: [] }));
    setAgents(current => [...current, agent]);
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

  async function receive(agent: ChatAgent, history: PreviewMessage[], message: string, controller: AbortController) {
    const channelId = agent.channelId;
    try {
      const { data, error } = await api.POST('/api/chat', {
        body: { agent: agent.real!, history: history.map(item => ({ role: item.author === 'user' ? 'user' as const : 'assistant' as const, text: item.text })), message },
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
            } else if (event.type === 'channel_message' && event.channelId === channelId && typeof event.text === 'string' && typeof event.id === 'string') {
              const published: PreviewMessage = { id: event.id, author: 'agent', text: event.text, time: clock(event.timestamp) };
              setConversations(current => ({ ...current, [channelId]: [...current[channelId], published] }));
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
      if (requests.current.get(channelId) === controller) {
        requests.current.delete(channelId);
        setBusy(current => ({ ...current, [channelId]: false }));
        setTyping(current => ({ ...current, [channelId]: false }));
      }
    }
  }

  function send(agent: ChatAgent, text: string) {
    text = text.trim();
    if (!text || requests.current.has(agent.channelId)) return;
    const history = conversations[agent.channelId];
    const message: PreviewMessage = { id: crypto.randomUUID(), author: 'user', text, time: clock() };
    setConversations(current => ({ ...current, [agent.channelId]: [...current[agent.channelId], message] }));
    setDrafts(current => ({ ...current, [agent.channelId]: '' }));
    setErrors(current => ({ ...current, [agent.channelId]: '' }));
    setTyping(current => ({ ...current, [agent.channelId]: false }));
    if (agent.real) {
      const controller = new AbortController();
      requests.current.set(agent.channelId, controller);
      setBusy(current => ({ ...current, [agent.channelId]: true }));
      void receive(agent, history, text, controller);
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

  return { agents, conversations, drafts, busy, typing, activity, errors, addAgent, send, stop, setDraft: (channelId: string, text: string) => setDrafts(current => ({ ...current, [channelId]: text })) };
}
