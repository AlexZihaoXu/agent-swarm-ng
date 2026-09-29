import { api } from '@/api/client';

/** The Computers list query, shared by the page and the idle prefetch so the first visit opens from cache. */
export const computersQuery = {
  queryKey: ['computers'],
  queryFn: async ({ signal }: { signal: AbortSignal }) => {
    const { data, error } = await api.GET('/api/computers', { signal });
    if (!data || error) throw new Error(error?.message ?? 'Could not load computers.');
    return data;
  },
};
