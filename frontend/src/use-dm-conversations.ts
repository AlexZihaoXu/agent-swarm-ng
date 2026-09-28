import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import type { paths } from '@/api/schema';
type Peer = paths['/api/agents/{id}/dm-peers']['get']['responses'][200]['content']['application/json']['peers'][number];

export function useDmConversations(agentId: string) {
  const [state, setState] = useState<{ owner: string; peers: Peer[]; cursor: number | null }>({
    owner: '',
    peers: [],
    cursor: null,
  });
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  const owner = useRef(agentId);
  owner.current = agentId;
  async function load(after?: number) {
    if (!agentId) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setFailed(false);
    try {
      const { data, error } = await api.GET('/api/agents/{id}/dm-peers', {
        params: { path: { id: agentId }, query: { after } },
        signal: controller.signal,
      });
      if (controller.signal.aborted || owner.current !== agentId) return;
      if (!data || error) throw new Error('Could not load conversations');
      setState(current => ({
        owner: agentId,
        peers:
          after && current.owner === agentId
            ? [...new Map([...current.peers, ...data.peers].map(peer => [peer.id, peer])).values()]
            : data.peers,
        cursor: data.nextCursor,
      }));
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
    void load();
    const refresh = (event: Event) => {
      const conversation = (event as CustomEvent<string>).detail;
      if (!conversation || conversation.split(':').includes(agentId)) void load();
    };
    window.addEventListener('swarm-dm-updated', refresh);
    return () => {
      request.current?.abort();
      window.removeEventListener('swarm-dm-updated', refresh);
    };
  }, [agentId]);
  return {
    peers: state.owner === agentId ? state.peers : [],
    cursor: state.owner === agentId ? state.cursor : null,
    busy,
    failed,
    load,
  };
}
