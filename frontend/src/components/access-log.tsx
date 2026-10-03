import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { operations } from '@/api/schema';
import { Button } from '@/components/ui/button';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TimeChart } from '@/components/dashboard';
import { settingsCard } from '@/lib/styles';
import { cn } from '@/lib/utils';

type Access = operations['getAccessLog']['responses'][200]['content']['application/json'];
type Range = '1h' | '24h' | '7d';
const RANGES: { value: Range; label: string }[] = [
  { value: '1h', label: '1 h' },
  { value: '24h', label: '24 h' },
  { value: '7d', label: 'Week' },
];
const number = (value: number) => value.toLocaleString();

function TopTable({ title, rows, keyLabel }: { title: string; rows: Access['countries']; keyLabel: string }) {
  return (
    <section aria-label={title} className={cn(settingsCard, 'min-w-0 space-y-2')}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length ? (
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[20rem] text-sm">
            <thead>
              <tr className="h-8 border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">{keyLabel}</th>
                <th className="px-2 py-1.5 text-right font-medium">Requests</th>
                <th className="px-2 py-1.5 text-right font-medium">Errors</th>
                <th className="px-2 py-1.5 text-right font-medium">Avg / max</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.key} className="h-8 border-b border-border/60 last:border-0">
                  <td className="max-w-64 truncate px-2 py-1 font-mono text-xs" title={row.key}>
                    {row.key}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{number(row.requests)}</td>
                  <td className={cn('px-2 py-1 text-right tabular-nums', row.errors && 'text-red-400')}>
                    {number(row.errors)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-right text-xs tabular-nums text-muted-foreground">
                    {row.avgMs} / {row.maxMs} ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing in this period.</p>
      )}
    </section>
  );
}

/**
 * Settings → Access log (docs/access-log.md): who reached the dashboard from where — addresses (with their labels),
 * countries, routes and statuses over a period — for a look when under attack. Separate from the audit log. Same
 * page composition and dense tables as the audit log.
 */
export function AccessLog({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [range, setRange] = useState<Range>('24h');
  const [ip, setIp] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['access-log', range, ip],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET('/api/access', {
        params: { query: { range, ...(ip ? { ip } : {}) } },
        signal,
      });
      if (!data || error) throw new Error('Could not load the access log.');
      return data as Access;
    },
    refetchInterval: 30_000,
    placeholderData: previous => previous,
  });
  const data = query.data;
  return (
    <section
      aria-label="Access log"
      className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col motion-safe:animate-[view-in_180ms_cubic-bezier(0.22,1,0.36,1)] md:px-6"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-0">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Access log</h2>
          <p className="text-xs text-muted-foreground">
            Every request: address, country, person if signed in, status, time
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-11 shrink-0 sm:min-h-0"
          onClick={() => onNavigate('/settings')}
        >
          Back to settings
        </Button>
      </header>
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3 md:px-0">
        <ChoiceChips label="Period" value={range} options={RANGES} onChange={setRange} />
        {ip && (
          <Button type="button" size="sm" variant="outline" className="min-h-11 sm:min-h-0" onClick={() => setIp(null)}>
            Showing {ip} · show all
          </Button>
        )}
      </div>
      <ScrollArea label="Access log" className="min-h-0 flex-1">
        <div
          className={cn(
            'space-y-4 px-4 py-4 pb-[calc(5rem+env(safe-area-inset-bottom))] transition-opacity md:px-0 md:pb-6',
            query.isPlaceholderData && 'opacity-50',
          )}
        >
          {query.isError && (
            <p role="alert" className="text-sm text-red-400">
              Could not load the access log.
            </p>
          )}
          {!data ? (
            !query.isError && (
              <p role="status" className="text-sm text-muted-foreground">
                Loading…
              </p>
            )
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {(
                  [
                    ['Requests', data.totals.requests],
                    ['Errors (4xx/5xx)', data.totals.errors],
                    ['Addresses', data.totals.addresses],
                    ['Countries', data.totals.countries],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className={settingsCard}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 font-mono text-lg tabular-nums">{number(value)}</p>
                  </div>
                ))}
              </div>
              <section aria-label="Requests over time" className={cn(settingsCard, 'space-y-2')}>
                <h3 className="text-sm font-semibold">Requests over time</h3>
                <TimeChart
                  stacked
                  buckets={data.buckets}
                  series={[
                    { key: 'ok', label: '2xx', values: data.series.ok, color: 'var(--chart-3)' },
                    { key: 'redirect', label: '3xx', values: data.series.redirect, color: 'var(--chart-1)' },
                    { key: 'client', label: '4xx', values: data.series.client, color: 'var(--chart-4)' },
                    { key: 'server', label: '5xx', values: data.series.server, color: 'var(--chart-5)' },
                  ]}
                  format={value => number(Math.round(value))}
                />
              </section>
              <section aria-label="Addresses" className={cn(settingsCard, 'min-w-0 space-y-2')}>
                <h3 className="text-sm font-semibold">Addresses</h3>
                <div className="w-full overflow-x-auto">
                  <table className="w-full min-w-[44rem] text-sm">
                    <thead>
                      <tr className="h-8 border-b border-border text-left text-xs text-muted-foreground">
                        <th className="px-2 py-1.5 font-medium">Address</th>
                        <th className="px-2 py-1.5 font-medium">Where</th>
                        <th className="px-2 py-1.5 font-medium">Signed in as</th>
                        <th className="px-2 py-1.5 text-right font-medium">Requests</th>
                        <th className="px-2 py-1.5 text-right font-medium">Errors</th>
                        <th className="px-2 py-1.5 text-right font-medium">Avg / max</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.addresses.map(entry => (
                        <tr key={entry.ip} className="h-8 border-b border-border/60 last:border-0">
                          <td className="px-2 py-1">
                            <button
                              type="button"
                              className="min-h-11 text-left underline-offset-4 hover:underline sm:min-h-0"
                              title="Show only this address"
                              onClick={() => setIp(entry.ip)}
                            >
                              {entry.label && (
                                <span className="mr-1.5 font-medium">
                                  {entry.label}
                                  {entry.trusted ? ' ✓' : ''}
                                </span>
                              )}
                              <span className="font-mono text-xs">{entry.ip}</span>
                            </button>
                          </td>
                          <td className="px-2 py-1 text-xs">{entry.country}</td>
                          <td className="max-w-40 truncate px-2 py-1 text-xs">{entry.users.join(', ') || '—'}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{number(entry.requests)}</td>
                          <td className={cn('px-2 py-1 text-right tabular-nums', entry.errors && 'text-red-400')}>
                            {number(entry.errors)}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 text-right text-xs tabular-nums text-muted-foreground">
                            {entry.avgMs} / {entry.maxMs} ms
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <div className="grid gap-4 lg:grid-cols-2">
                <TopTable title="Countries" keyLabel="Country" rows={data.countries} />
                <TopTable title="Statuses" keyLabel="Status" rows={data.statuses} />
              </div>
              <TopTable title="Routes" keyLabel="Method and route" rows={data.routes} />
            </>
          )}
        </div>
      </ScrollArea>
    </section>
  );
}
