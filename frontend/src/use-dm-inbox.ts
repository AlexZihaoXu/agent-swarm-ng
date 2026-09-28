import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import type { paths } from '@/api/schema';
export type DmNotice =
  paths['/api/agents/{id}/dm-inbox']['get']['responses'][200]['content']['application/json']['messages'][number];

/** Operator-only projection of persisted DMs; never added to private model history. */
export function useDmInbox(agentId: string) {
  const [messages, setMessages] = useState<DmNotice[]>([]),
    [cursor, setCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  const owner = useRef(agentId);
  owner.current = agentId;
  const [loadedOwner, setLoadedOwner] = useState('');
  const older = useRef(false);
  async function load(before?: number, refresh = false) {
    if (!agentId) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setFailed(false);
    try {
      const { data, error } = await api.GET('/api/agents/{id}/dm-inbox', {
        params: { path: { id: agentId }, query: { before } },
        signal: controller.signal,
      });
      if (controller.signal.aborted || owner.current !== agentId) return;
      if (!data || error) throw new Error('Inbox unavailable');
      setLoadedOwner(agentId);
      setMessages(current =>
        before || (refresh && older.current)
          ? [...new Map([...current, ...data.messages].map(message => [message.id, message])).values()].sort(
              (a, b) => a.sequence - b.sequence,
            )
          : data.messages,
      );
      if (before || !refresh || !older.current) setCursor(data.nextCursor);
      if (before) older.current = true;
    } catch {
      if (!controller.signal.aborted && owner.current === agentId) setFailed(true);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    setMessages([]);
    setCursor(null);
    older.current = false;
    void load();
    const refresh = (event: Event) => {
      const conversation = (event as CustomEvent<string>).detail;
      if (!conversation || conversation.split(':').includes(agentId)) void load(undefined, true);
    };
    window.addEventListener('swarm-dm-updated', refresh);
    return () => {
      request.current?.abort();
      window.removeEventListener('swarm-dm-updated', refresh);
    };
  }, [agentId]);
  return { messages: loadedOwner === agentId ? messages : [], busy, failed, cursor, load };
}
