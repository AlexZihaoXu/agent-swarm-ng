import { useEffect } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { paths } from '@/api/schema';

export type GroupChat = paths['/api/groups/{id}']['get']['responses'][200]['content']['application/json'];
export type GroupPage = paths['/api/groups/{id}/messages']['get']['responses'][200]['content']['application/json'];
export type GroupMessage = GroupPage['messages'][number];
export const mergeGroupMessages = (a: GroupMessage[], b: GroupMessage[]) => [...new Map([...a, ...b].map(message => [message.id, message])).values()].sort((a, b) => a.sequence - b.sequence);

export function useGroupEvents() {
  const client = useQueryClient();
  useEffect(() => {
    const changed = (event: Event) => {
      const { groupId, message } = (event as CustomEvent<{ groupId: string; message?: GroupMessage }>).detail;
      void client.invalidateQueries({ queryKey: ['groups'] });
      void client.invalidateQueries({ queryKey: groupId ? ['group', groupId] : ['group'] });
      if (!groupId) void client.invalidateQueries({ queryKey: ['reactions'] });
      if (message && typeof message.id === 'string' && typeof message.text === 'string' && Number.isSafeInteger(message.sequence)) {
        if (client.getQueryState(['group-messages', groupId])?.fetchStatus === 'fetching') client.setQueryData<GroupMessage[]>(['group-pending', groupId], old => mergeGroupMessages(old ?? [], [message]).slice(-200));
        client.setQueryData<GroupPage>(['group-messages', groupId], old => old ? { ...old, messages: mergeGroupMessages(old.messages, [message]) } : undefined);
      }
    };
    const reactions = (event: Event) => { void client.invalidateQueries({ queryKey: ['reactions', (event as CustomEvent<string>).detail] }); };
    const reconnect = () => {
      void client.invalidateQueries({ queryKey: ['reactions'] });
      void client.invalidateQueries({ queryKey: ['groups'] });
      void client.invalidateQueries({ queryKey: ['group'] });
      void client.invalidateQueries({ queryKey: ['group-messages'] });
    };
    window.addEventListener('swarm-reactions-updated', reactions);
    window.addEventListener('swarm-groups-updated', changed);
    window.addEventListener('swarm-groups-reconnected', reconnect);
    return () => { window.removeEventListener('swarm-reactions-updated', reactions); window.removeEventListener('swarm-groups-updated', changed); window.removeEventListener('swarm-groups-reconnected', reconnect); };
  }, [client]);
}
export function useGroups(search = '') {
  return useInfiniteQuery({ queryKey: ['groups', search], initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await api.GET('/api/groups', { params: { query: { after: pageParam, search: search || undefined } }, signal });
      if (!data || error) throw new Error(error?.message ?? 'Could not load chats.');
      return data;
    }, getNextPageParam: page => page.nextCursor ?? undefined,
  });
}
export function useGroupMessages(groupId: string) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['group-messages', groupId], queryFn: async ({ signal }) => {
    const { data, error } = await api.GET('/api/groups/{id}/messages', { params: { path: { id: groupId }, query: { limit: 40 } }, signal });
    if (!data || error) throw new Error(error?.message ?? 'Could not load messages.');
    const pending = client.getQueryData<GroupMessage[]>(['group-pending', groupId]) ?? [];
    client.removeQueries({ queryKey: ['group-pending', groupId], exact: true });
    return { ...data, messages: mergeGroupMessages(data.messages, pending) };
  } });
  const older = async () => {
    const before = client.getQueryData<GroupPage>(['group-messages', groupId])?.nextCursor;
    if (before == null) return;
    const { data, error } = await api.GET('/api/groups/{id}/messages', { params: { path: { id: groupId }, query: { before, limit: 40 } } });
    if (!data || error) throw new Error(error?.message ?? 'Could not load earlier messages.');
    client.setQueryData<GroupPage>(['group-messages', groupId], current => ({ messages: mergeGroupMessages(data.messages, current?.messages ?? []), nextCursor: data.nextCursor }));
  };
  return { ...query, older };
}
