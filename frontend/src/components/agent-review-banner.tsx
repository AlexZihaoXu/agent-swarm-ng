import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import type { paths } from '@/api/schema';
import type { RealAgent } from '@/use-chat';

type Review = paths['/api/agents/{id}/review']['get']['responses'][200]['content']['application/json'];
type Problem = Review['problems'][number];

/** Where a problem is fixed: its section in these settings. */
const SECTION = { model: 'Model', links: 'Computers', discord: 'Channels' } as const;
const jump = (section: string) =>
  document.querySelector<HTMLElement>(`section[aria-label="${section}"]`)?.scrollIntoView({ behavior: 'smooth' });

/**
 * The top of an agent's settings when something needs the owner (docs/agent-export.md): an imported agent is paused
 * until the settings in red are fixed (each with a way to it, or Remove for a link that does not exist here), then
 * Resume. Re-checked whenever the agent's saved settings change.
 */
export function AgentReviewBanner({ agent, onResumed }: { agent: RealAgent; onResumed: (agent: RealAgent) => void }) {
  const client = useQueryClient();
  const key = ['agent-review', agent.id, JSON.stringify(agent.models), agent.paused];
  const review = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/agents/{id}/review', { params: { path: { id: agent.id } } });
      if (!data || error) throw new Error('Could not check this agent’s settings.');
      return data;
    },
    refetchOnWindowFocus: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const data = review.data;
  if (!data || (!data.paused && !data.problems.length)) return null;
  const remove = async (problem: Problem) => {
    if (!problem.kind || !problem.id) return;
    setBusy(true);
    setError('');
    const { data: next, error: failed } = await api.POST('/api/agents/{id}/review/remove', {
      params: { path: { id: agent.id } },
      body: { kind: problem.kind, id: problem.id },
    });
    setBusy(false);
    if (next) client.setQueryData(key, next);
    else setError(failed?.message ?? 'Could not remove it.');
  };
  const resume = async () => {
    setBusy(true);
    setError('');
    const { data: next, error: failed } = await api.POST('/api/agents/{id}/resume', {
      params: { path: { id: agent.id } },
      body: {},
    });
    setBusy(false);
    if (next) {
      client.setQueryData(key, next);
      onResumed({ ...agent, paused: false });
    } else setError(failed?.message ?? 'Could not resume it.');
  };
  return (
    <section
      aria-label="Needs attention"
      className="rounded-lg border border-red-500/50 bg-red-500/5 p-4 motion-safe:animate-[view-in_260ms_cubic-bezier(0.22,1,0.36,1)]"
    >
      <h3 className="text-base font-semibold">{data.paused ? `${agent.name} is paused` : 'Needs attention'}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {data.paused
          ? data.problems.length
            ? 'It was imported with settings that do not work here. Change the ones in red, then resume it. Nothing runs until then: no messages, timers, heartbeats or Discord.'
            : 'Everything works here now. Resume it to let it run again; its timers that fired meanwhile arrive then.'
          : 'These settings do not work here.'}
      </p>
      {data.problems.length > 0 && (
        <ul className="mt-3 space-y-2">
          {data.problems.map((problem, index) => (
            <li
              key={`${problem.section}:${problem.id ?? problem.row ?? index}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-500/40 bg-background/60 px-3 py-2"
            >
              <span className="min-w-0 flex-1 text-sm text-red-300">
                {problem.section === 'model' ? `Model #${(problem.row ?? 0) + 1}: ` : ''}
                {problem.message}
              </span>
              {problem.section === 'links' ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  className="min-h-11 sm:min-h-0"
                  onClick={() => void remove(problem)}
                >
                  Remove
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11 sm:min-h-0"
                  onClick={() => jump(SECTION[problem.section])}
                >
                  {problem.section === 'model' ? 'Switch provider' : 'Go to Discord'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {error}
        </p>
      )}
      {data.paused && (
        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            size="sm"
            className="min-h-11 sm:min-h-0"
            disabled={busy || data.problems.length > 0}
            title={data.problems.length ? 'Fix the settings in red first' : undefined}
            onClick={() => void resume()}
          >
            Resume {agent.name}
          </Button>
        </div>
      )}
    </section>
  );
}
