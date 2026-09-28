import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { asAgent, type ChatAgent } from '@/use-chat';

/** Server-side agent search shared by the Agents and Chat sidebars, so both find agents beyond the first loaded page. */
export function useAgentSearch(search: string, loaded: ChatAgent[]) {
  const term = search.trim();
  const query = useInfiniteQuery({
    queryKey: ['chat-agent-search', term], enabled: Boolean(term), initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await api.GET('/api/agents', { params: { query: { search: term, after: pageParam } }, signal });
      if (error || !data) throw new Error('Could not search agents.');
      return data;
    },
    getNextPageParam: page => page.nextCursor ?? undefined,
  });
  const matches = query.data?.pages.flatMap(page => page.agents).map(real => loaded.find(agent => agent.id === real.id) ?? asAgent(real)) ?? [];
  return { term, query, agents: term ? matches.filter(agent => agent.name.toLowerCase().includes(term.toLowerCase())) : loaded };
}
