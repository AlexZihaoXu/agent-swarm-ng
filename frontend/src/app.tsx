import { useQuery } from '@tanstack/react-query';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';

export function App() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/health');
      if (error || !data) throw new Error('Backend unavailable');
      return data;
    },
    retry: false,
    networkMode: 'always',
    refetchInterval: 15_000,
  });
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW();

  return (
    <main className="mx-auto max-w-4xl space-y-2 px-6 py-8">
      <h1 className="text-xl font-semibold">Agent Swarm v2</h1>
      <p role="status" className="text-sm text-muted-foreground">
        {health.isPending ? 'Connecting…' : health.isError ? 'Disconnected — backend unavailable' : 'Backend connected'}
      </p>
      {needRefresh && (
        <aside aria-label="Application update" className="space-y-3 rounded-lg border border-border p-4">
          <p>An update is ready. Reload when it won’t interrupt your work.</p>
          <div className="flex gap-3">
            <Button onClick={() => void updateServiceWorker(true)}>Reload</Button>
            <Button variant="outline" onClick={() => setNeedRefresh(false)}>Later</Button>
          </div>
        </aside>
      )}
    </main>
  );
}
