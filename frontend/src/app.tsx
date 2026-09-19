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
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-16">
      <header>
        <p className="text-sm text-muted-foreground">Platform scaffold</p>
        <h1 className="mt-2 text-3xl font-semibold">Agent Swarm v2</h1>
        <p className="mt-3 text-muted-foreground">Containerized environments, managed from one dashboard.</p>
      </header>
      <section aria-label="Platform status" className="rounded-lg border border-border p-6">
        <h2 className="text-lg font-medium">Platform status</h2>
        <p role="status" className="my-4">
          {health.isPending ? 'Connecting…' : health.isError ? 'Disconnected — backend unavailable. Management requires a connection.' : 'Backend connected'}
        </p>
        <Button variant="outline" disabled={health.isFetching} onClick={() => void health.refetch()}>Check connection</Button>
      </section>
      <section>
        <h2 className="text-lg font-medium">Environments</h2>
        <p className="mt-2 text-muted-foreground">Container management and optional desktop streaming are not implemented yet.</p>
      </section>
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
