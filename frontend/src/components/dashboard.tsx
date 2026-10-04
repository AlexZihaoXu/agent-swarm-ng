import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { api } from '@/api/client';
import { consumeEvents } from '@/api/events';
import { LiveChart, type LiveClock } from '@/components/live-chart';
import type { operations } from '@/api/schema';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { PageHeader } from '@/components/page-header';
import { UsageDial } from '@/components/usage-dial';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { useOrganizations } from '@/lib/organizations';
import { settingsCard } from '@/lib/styles';
import { cn } from '@/lib/utils';

type Data = operations['getDashboard']['responses'][200]['content']['application/json'];
type Range = '12h' | '24h' | '48h' | '72h' | '7d';
type Series = (number | null)[];

const RANGES: { value: Range; label: string }[] = [
  { value: '12h', label: '12 h' },
  { value: '24h', label: '24 h' },
  { value: '48h', label: '48 h' },
  { value: '72h', label: '72 h' },
  { value: '7d', label: 'Week' },
];
const RANGE_KEY = 'agent-swarm.dashboard-range';
const COLORS = Array.from({ length: 8 }, (_, i) => `var(--chart-${i + 1})`);
// Throughput lines: memory has cyan, so network in is violet.
const NET_IN = 'var(--chart-2)',
  NET_OUT = 'var(--chart-8)',
  DISK_READ = 'var(--chart-3)',
  DISK_WRITE = 'var(--chart-5)';
const TOKEN_TYPES = [
  ['input', 'Input'],
  ['output', 'Output (other than reasoning)'],
  ['cacheRead', 'Cache read'],
  ['cacheWrite', 'Cache write'],
  ['reasoning', 'Reasoning'],
] as const;

const GiB = 1024 ** 3;
const bytes = (value: number) =>
  value >= 1024 * GiB
    ? `${(value / 1024 / GiB).toFixed(2)} TiB`
    : `${(value / GiB).toFixed(value >= 100 * GiB ? 0 : 1)} GiB`;
const percent = (value: number) => `${value.toFixed(value < 10 ? 1 : 0)}%`;
const dollars = (value: number) => `$${value < 1 ? value.toFixed(3) : value.toFixed(2)}`;
const tokens = (value: number) =>
  value >= 1e9
    ? `${(value / 1e9).toFixed(2)}B`
    : value >= 1e6
      ? `${(value / 1e6).toFixed(1)}M`
      : value >= 1e3
        ? `${(value / 1e3).toFixed(1)}k`
        : String(Math.round(value));
/** Bytes per second, readable: B/s, KB/s, MB/s, GB/s (decimal, like network and disk vendors). */
const throughput = (value: number) =>
  value >= 1e9
    ? `${(value / 1e9).toFixed(2)} GB/s`
    : value >= 1e6
      ? `${(value / 1e6).toFixed(1)} MB/s`
      : value >= 1e3
        ? `${(value / 1e3).toFixed(0)} KB/s`
        : `${Math.round(value)} B/s`;
const hours = (ms: number) => (ms >= 3_600_000 ? `${(ms / 3_600_000).toFixed(1)} h` : `${Math.round(ms / 60_000)} min`);

function readRange(): Range {
  try {
    const saved = localStorage.getItem(RANGE_KEY);
    return RANGES.some(range => range.value === saved) ? (saved as Range) : '48h';
  } catch {
    return '48h';
  }
}

const last = (series: Series) => [...series].reverse().find(value => value !== null) ?? null;
const cumulative = (series: Series) => {
  let total = 0;
  return series.map(value => (total += value ?? 0));
};

/** One time chart (Kibo chart/area/chart-area-interactive, or its line form): a row per bucket, a key per series. */
export function TimeChart({
  buckets,
  series,
  format,
  line = false,
  stacked = false,
  max,
  className,
}: {
  buckets: number[];
  series: { key: string; label: string; values: Series; color?: string }[];
  format: (value: number) => string;
  line?: boolean;
  stacked?: boolean;
  max?: number;
  className?: string;
}) {
  const id = useId().replace(/:/g, '');
  const keys = series.map((item, i) => ({ ...item, safe: `s${i}`, color: item.color ?? COLORS[i % COLORS.length]! }));
  const config = Object.fromEntries(
    keys.map(item => [item.safe, { label: item.label, color: item.color }]),
  ) satisfies ChartConfig;
  const data = useMemo(
    () =>
      buckets.map((t, i) => Object.fromEntries([['t', t], ...keys.map(item => [item.safe, item.values[i] ?? null])])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buckets, series],
  );
  const span = buckets.length > 1 ? buckets.at(-1)! - buckets[0]! : 0;
  const tick = (value: number) =>
    new Date(value).toLocaleString(
      undefined,
      span > 72 * 3_600_000
        ? { weekday: 'short', day: 'numeric' }
        : span < 10 * 60_000
          ? { minute: '2-digit', second: '2-digit' }
          : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
    );
  const label = (_: unknown, payload: { payload?: { t?: number } }[]) =>
    payload[0]?.payload?.t
      ? new Date(payload[0].payload.t).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          ...(span < 10 * 60_000 ? { second: '2-digit' } : {}),
          hourCycle: 'h23',
        })
      : '';
  const axes = (
    <>
      <CartesianGrid vertical={false} />
      <XAxis
        dataKey="t"
        type="number"
        domain={['dataMin', 'dataMax']}
        scale="time"
        tickFormatter={tick}
        axisLine={false}
        tickLine={false}
        tickMargin={8}
        minTickGap={40}
      />
      <YAxis tickFormatter={format} axisLine={false} tickLine={false} width={76} domain={[0, max ?? 'auto']} />
      <ChartTooltip
        cursor={false}
        content={
          <ChartTooltipContent
            indicator="dot"
            labelFormatter={label}
            formatter={(value, name) => (
              <span className="flex w-full justify-between gap-3">
                <span className="text-muted-foreground">{config[name as string]?.label ?? name}</span>
                <span className="font-mono tabular-nums">{typeof value === 'number' ? format(value) : '—'}</span>
              </span>
            )}
          />
        }
      />
      {keys.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
    </>
  );
  return (
    <ChartContainer config={config} className={cn('aspect-auto h-56 w-full', className)}>
      {line ? (
        <LineChart accessibilityLayer data={data} margin={{ left: 0, right: 8, top: 8 }}>
          {axes}
          {keys.map(item => (
            <Line
              key={item.safe}
              dataKey={item.safe}
              stroke={`var(--color-${item.safe})`}
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
              connectNulls={false}
            />
          ))}
        </LineChart>
      ) : (
        <AreaChart accessibilityLayer data={data} margin={{ left: 0, right: 8, top: 8 }}>
          <defs>
            {keys.map(item => (
              <linearGradient key={item.safe} id={`${id}-${item.safe}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="5%" stopColor={`var(--color-${item.safe})`} stopOpacity={0.6} />
                <stop offset="95%" stopColor={`var(--color-${item.safe})`} stopOpacity={0.05} />
              </linearGradient>
            ))}
          </defs>
          {axes}
          {keys.map(item => (
            <Area
              key={item.safe}
              dataKey={item.safe}
              type="monotone"
              fill={`url(#${id}-${item.safe})`}
              stroke={`var(--color-${item.safe})`}
              stackId={stacked ? 'a' : undefined}
              isAnimationActive={false}
              connectNulls={false}
            />
          ))}
        </AreaChart>
      )}
    </ChartContainer>
  );
}

/** The organization shown, for the scope note on organization charts. */
const ScopeName = createContext('');

function Panel({
  title,
  subtitle,
  scope,
  children,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  scope: 'system' | 'organization';
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const scopeName = useContext(ScopeName);
  return (
    <section aria-labelledby={id} className={cn(settingsCard, 'min-w-0 space-y-3', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={id} className="text-sm font-semibold">
          {title}
        </h3>
        <span className="text-xs text-muted-foreground">{scope === 'system' ? 'System-wide' : scopeName}</span>
      </div>
      {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="flex h-24 items-center justify-center text-sm text-muted-foreground">{children}</p>
);

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={cn(settingsCard, 'min-w-0')}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono text-lg tabular-nums">{value}</p>
      {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Dashboard (docs/dashboard.md): the host's disks, CPU and memory (system-wide), and the current organization's
 * computers, agents' active hours, spending and tokens, over a chosen period (default 48 hours).
 */
export function Dashboard() {
  const [range, setRange] = useState<Range>(readRange);
  const { current, nameOf, organizations } = useOrganizations();
  const organization = current === 'all' ? undefined : current;
  useEffect(() => {
    try {
      localStorage.setItem(RANGE_KEY, range);
    } catch {
      // A preference only.
    }
  }, [range]);
  const query = useQuery({
    queryKey: ['dashboard', range, organization ?? 'all'],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET('/api/dashboard', {
        params: { query: { range, ...(organization ? { organization } : {}) } },
        signal,
      });
      if (!data || error) throw new Error('Could not load the dashboard.');
      return data as Data;
    },
    refetchInterval: 60_000,
    placeholderData: previous => previous,
  });
  const data = query.data;
  // The same name the organization switcher shows (with one organization, "all" is that one).
  const scopeName = organization
    ? nameOf(organization)
    : organizations.length === 1
      ? organizations[0]!.name
      : 'All organizations';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Dashboard"
        description={`${scopeName} · disks, CPU and memory are system-wide`}
        width="max-w-6xl"
        action={
          <ChoiceChips label="Period" value={range} options={RANGES} onChange={setRange} className="max-md:hidden" />
        }
      />
      <ScrollArea label="Dashboard" className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-6xl space-y-4 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 motion-safe:animate-[view-in_180ms_cubic-bezier(0.22,1,0.36,1)] md:px-6 md:pb-8">
          {/* Phones: the period gets its own row instead of squeezing the title. */}
          <ChoiceChips label="Period" value={range} options={RANGES} onChange={setRange} className="md:hidden" />
          {query.isError && (
            <p role="alert" className="text-sm text-red-400">
              {data ? 'Could not refresh: showing the last numbers loaded.' : 'Could not load the dashboard.'}
            </p>
          )}
          {!data ? (
            !query.isError && (
              <p role="status" className="text-sm text-muted-foreground">
                Loading…
              </p>
            )
          ) : (
            // While another period or organization loads, the previous numbers stay, dimmed.
            <div
              aria-busy={query.isPlaceholderData}
              className={cn('space-y-4 transition-opacity', query.isPlaceholderData && 'opacity-50')}
            >
              <ScopeName.Provider value={scopeName}>
                <LiveMinute disks={data.disks} />
                <DashboardBody data={data} />
              </ScopeName.Provider>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

type Live = operations['getDashboardLive']['responses'][200]['content']['application/json'];
type LivePoint = Live['points'][number];

/** Each storage area's green, in order (styles.css). */
const STORAGE_COLORS = Array.from({ length: 5 }, (_, i) => `var(--usage-storage-${i + 1})`);
const storageColor = (i: number) => STORAGE_COLORS[i % STORAGE_COLORS.length]!;

/**
 * The live readings as they are taken (GET /api/dashboard/live/stream, NDJSON like the agent-run stream): a snapshot
 * of the last minute, then each reading. Followed only while the page is visible; a dropped stream reconnects and its
 * snapshot fills what was missed. The clock offset is the smallest recent delay between a reading and its arrival.
 */
function useLiveReadings() {
  const [live, setLive] = useState<Live | null>(null);
  const [failed, setFailed] = useState(false);
  const clock = useRef<LiveClock>({ offset: 0, delay: 750 });
  useEffect(() => {
    let controller: AbortController | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const lags: number[] = [];
    const heard = (t: number) => {
      lags.push(Date.now() - t);
      if (lags.length > 40) lags.shift();
      clock.current.offset = Math.min(...lags);
    };
    async function connect() {
      controller?.abort();
      clearTimeout(retry);
      const current = new AbortController();
      controller = current;
      try {
        const { data, response } = await api.GET('/api/dashboard/live/stream', {
          parseAs: 'stream',
          signal: current.signal,
        });
        if (!response.ok || !data) throw new Error('Live readings unavailable');
        await consumeEvents(data, current.signal, event => {
          if (event.type === 'snapshot') {
            const snapshot = event as Live & { type: string };
            lags.length = 0;
            if (snapshot.points.length) heard(snapshot.points.at(-1)!.t);
            clock.current.delay = snapshot.intervalMs * 3;
            setLive(snapshot);
            setFailed(false);
          } else if (event.type === 'point') {
            const point = event.point as LivePoint;
            heard(point.t);
            setLive(
              previous =>
                previous && {
                  ...previous,
                  points: [...previous.points.filter(item => item.t > point.t - 60_000), point],
                },
            );
          }
        });
      } catch {
        if (!current.signal.aborted) setFailed(true);
      }
      if (controller === current && !current.signal.aborted && !document.hidden)
        retry = setTimeout(() => void connect(), 2000);
    }
    const visibility = () => {
      if (document.hidden) {
        clearTimeout(retry);
        controller?.abort();
      } else void connect();
    };
    document.addEventListener('visibilitychange', visibility);
    if (!document.hidden) void connect();
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      clearTimeout(retry);
      controller?.abort();
    };
  }, []);
  return { live, failed, clock };
}

/** The mean of the last second's readings (four of them): steadier figures than each quarter second's. */
function recent(points: LivePoint[], pick: (point: LivePoint) => number | null | undefined) {
  const end = points.at(-1)?.t ?? 0;
  const values = points
    .filter(point => point.t > end - 1000)
    .map(pick)
    .filter((value): value is number => value != null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/**
 * Now: host CPU, memory and each storage area's space as rings (the computer cards' UsageDial, larger; blue, cyan and
 * greens, yellow when fairly high and red when nearly full), network now, then the last minute of readings (four a
 * second: CPU, memory, network, each physical disk's I/O) on charts that slide smoothly while the page is visible.
 */
function LiveMinute({ disks }: { disks: Data['disks'] }) {
  const { live, failed, clock } = useLiveReadings();
  const points = live?.points ?? [];
  const gap = (live?.intervalMs ?? 250) * 3;
  const times = useMemo(() => points.map(point => point.t), [points]);
  const series = (key: 'cpuPercent' | 'memUsed' | 'netRx' | 'netTx') => points.map(point => point[key] ?? null);
  // A disk missing from a reading (no counters yet, or a reset) is a gap, never a fake zero.
  const deviceSeries = (device: string, key: 'read' | 'write') =>
    points.map(point => point.disks[device]?.[key] ?? null);
  const cpu = recent(points, point => point.cpuPercent);
  const memUsed = recent(points, point => point.memUsed);
  const netRx = recent(points, point => point.netRx);
  const netTx = recent(points, point => point.netTx);
  const memTotal = points.at(-1)?.memTotal ?? undefined;
  return (
    <section aria-labelledby="dashboard-now" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="dashboard-now" className="text-sm font-semibold">
          Now
        </h3>
        <span role="status" className={cn('text-xs', failed ? 'text-amber-300' : 'text-muted-foreground')}>
          {failed ? 'Reconnecting… these are the last readings' : 'System-wide · live, four readings a second'}
        </span>
      </div>
      {/* Lost the stream: the last readings stay, dimmed, until it is back. */}
      <div className={cn(settingsCard, 'flex flex-wrap gap-x-8 gap-y-4 transition-opacity', failed && 'opacity-50')}>
        <UsageDial
          large
          label="CPU"
          value={live?.cores ? `${live.cores} cores` : '—'}
          fraction={cpu === null ? null : cpu / 100}
          color="var(--usage-cpu)"
        />
        <UsageDial
          large
          label="Memory"
          value={memUsed !== null ? bytes(memUsed) : '—'}
          caption={memTotal ? `of ${bytes(memTotal)}` : undefined}
          fraction={memUsed !== null && memTotal ? memUsed / memTotal : null}
          color="var(--usage-memory)"
        />
        {disks.map((disk, i) => {
          const used = last(disk.used);
          return (
            <UsageDial
              key={disk.disk}
              large
              label={disk.label}
              value={used !== null ? bytes(used) : '—'}
              caption={disk.total ? `of ${bytes(disk.total)}` : undefined}
              fraction={used !== null && disk.total ? used / disk.total : null}
              color={storageColor(i)}
            />
          );
        })}
        <div className="min-w-0 leading-tight">
          <div className="text-sm font-semibold">Network</div>
          {netRx !== null ? (
            <>
              <div className="text-xs tabular-nums text-muted-foreground">↓ {throughput(netRx)}</div>
              <div className="text-xs tabular-nums text-muted-foreground">↑ {throughput(netTx ?? 0)}</div>
            </>
          ) : (
            <div className="text-xs text-muted-foreground">Waiting for the host-net helper</div>
          )}
        </div>
      </div>
      {points.length < 2 ? (
        <div className={settingsCard}>
          <Empty>{failed ? 'Could not load live readings.' : 'Collecting the first readings…'}</Empty>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Panel title="CPU · last minute" scope="system">
            <LiveChart
              area
              label="CPU, last minute"
              times={times}
              series={[{ key: 'cpu', label: 'CPU', values: series('cpuPercent'), color: 'var(--usage-cpu)' }]}
              format={percent}
              max={100}
              gap={gap}
              clock={clock}
            />
          </Panel>
          <Panel title="Memory · last minute" scope="system">
            <LiveChart
              area
              label="Memory, last minute"
              times={times}
              series={[{ key: 'mem', label: 'Used', values: series('memUsed'), color: 'var(--usage-memory)' }]}
              format={bytes}
              max={memTotal}
              gap={gap}
              clock={clock}
            />
          </Panel>
          <Panel title="Network · last minute" scope="system">
            <LiveChart
              label="Network, last minute"
              times={times}
              series={[
                { key: 'in', label: 'In', values: series('netRx'), color: NET_IN },
                { key: 'out', label: 'Out', values: series('netTx'), color: NET_OUT },
              ]}
              format={throughput}
              gap={gap}
              clock={clock}
            />
          </Panel>
          {(live?.devices ?? []).map(({ device, label }) => (
            <Panel key={device} title={`Disk I/O · ${label}`} scope="system">
              <LiveChart
                label={`Disk I/O of ${label}, last minute`}
                times={times}
                series={[
                  { key: 'read', label: 'Read', values: deviceSeries(device, 'read'), color: DISK_READ },
                  { key: 'write', label: 'Write', values: deviceSeries(device, 'write'), color: DISK_WRITE },
                ]}
                format={throughput}
                gap={gap}
                clock={clock}
              />
            </Panel>
          ))}
        </div>
      )}
    </section>
  );
}

function DashboardBody({ data }: { data: Data }) {
  const priced = data.providers.filter(provider => provider.priced);
  const unpriced = data.providers.length - priced.length;
  const spend = priced.reduce((sum, provider) => sum + provider.total, 0);
  const paid = priced.filter(provider => !provider.subscription).reduce((sum, provider) => sum + provider.total, 0);
  // Reasoning tokens are part of output: counted once.
  const tokenTotal = data.agents.reduce(
    (sum, agent) =>
      sum +
      agent.tokenTotals.input +
      agent.tokenTotals.output +
      agent.tokenTotals.cacheRead +
      agent.tokenTotals.cacheWrite,
    0,
  );
  const active = data.agents.reduce((sum, agent) => sum + agent.activeMs, 0);
  const busyAgents = data.agents.filter(agent => agent.activeMs > 0).sort((a, b) => b.activeMs - a.activeMs);
  const tokenAgents = data.agents
    .filter(agent => Object.values(agent.tokenTotals).some(Boolean))
    .sort((a, b) => b.cost - a.cost);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat
          label="Spend in period"
          value={priced.length ? dollars(spend) : '—'}
          hint={
            [paid !== spend ? `${dollars(paid)} billed per token` : '', unpriced ? `+${unpriced} not priced` : '']
              .filter(Boolean)
              .join(' · ') || undefined
          }
        />
        <Stat label="Tokens in period" value={tokens(tokenTotal)} />
        <Stat
          label="Agents active"
          value={hours(active)}
          hint={`${busyAgents.length} agent${busyAgents.length === 1 ? '' : 's'}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Host CPU" scope="system">
          {data.system.cpuPercent.some(value => value !== null) ? (
            <TimeChart
              buckets={data.buckets}
              series={[{ key: 'cpu', label: 'CPU', values: data.system.cpuPercent, color: 'var(--usage-cpu)' }]}
              format={percent}
              max={100}
            />
          ) : (
            <Empty>No samples yet.</Empty>
          )}
        </Panel>
        <Panel
          title="Host memory"
          scope="system"
          subtitle={data.system.memTotal ? `Total ${bytes(data.system.memTotal)}` : undefined}
        >
          {data.system.memUsed.some(value => value !== null) ? (
            <TimeChart
              buckets={data.buckets}
              series={[{ key: 'mem', label: 'Used', values: data.system.memUsed, color: 'var(--usage-memory)' }]}
              format={bytes}
              max={data.system.memTotal ?? undefined}
            />
          ) : (
            <Empty>No samples yet.</Empty>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Host network"
          scope="system"
          subtitle="Physical interfaces, average per bucket"
          className="lg:col-span-2"
        >
          {data.system.netRx.some(value => value !== null) ? (
            <TimeChart
              line
              buckets={data.buckets}
              series={[
                { key: 'in', label: 'In', values: data.system.netRx, color: NET_IN },
                { key: 'out', label: 'Out', values: data.system.netTx, color: NET_OUT },
              ]}
              format={throughput}
            />
          ) : (
            <Empty>No network readings yet (the host-net helper must be running).</Empty>
          )}
        </Panel>
      </div>

      {data.diskIo.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.diskIo.map(disk => (
            <Panel
              key={disk.device}
              title={`Disk I/O · ${disk.label}`}
              scope="system"
              subtitle="Physical disk, average per bucket"
            >
              <TimeChart
                line
                buckets={data.buckets}
                series={[
                  { key: 'read', label: 'Read', values: disk.read, color: DISK_READ },
                  { key: 'write', label: 'Write', values: disk.write, color: DISK_WRITE },
                ]}
                format={throughput}
              />
            </Panel>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {data.disks.length ? (
          data.disks.map((disk, i) => (
            <Panel
              key={disk.disk}
              title={`Disk · ${disk.label}`}
              scope="system"
              subtitle={`${disk.uses.join(', ') || 'in use'}${disk.total ? ` · ${bytes(last(disk.used) ?? 0)} of ${bytes(disk.total)} used` : ''}`}
            >
              <TimeChart
                buckets={data.buckets}
                series={[{ key: 'used', label: 'Used', values: disk.used, color: storageColor(i) }]}
                format={bytes}
                max={disk.total ?? undefined}
              />
            </Panel>
          ))
        ) : (
          <Panel title="Disks" scope="system">
            <Empty>No disk readings yet (every few minutes).</Empty>
          </Panel>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Computer CPU" scope="organization">
          {data.computers.length ? (
            <TimeChart
              line
              buckets={data.buckets}
              series={data.computers.map(computer => ({
                key: computer.id,
                label: computer.name,
                values: computer.cpuPercent,
              }))}
              format={percent}
            />
          ) : (
            <Empty>No computers here.</Empty>
          )}
        </Panel>
        <Panel title="Computer memory" scope="organization" subtitle="Share of each computer's memory limit">
          {data.computers.length ? (
            <TimeChart
              line
              buckets={data.buckets}
              series={data.computers.map(computer => ({
                key: computer.id,
                label: computer.name,
                values: computer.memPercent,
              }))}
              format={percent}
              max={100}
            />
          ) : (
            <Empty>No computers here.</Empty>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Agent active hours"
          scope="organization"
          subtitle="Time each agent spent working (its runs): over time, and in total for the period"
        >
          {busyAgents.length ? (
            <>
              <TimeChart
                stacked
                buckets={data.buckets}
                series={busyAgents.map(agent => ({
                  key: agent.id,
                  label: agent.name,
                  values: agent.active.map(ms => (ms === null ? null : ms / 3_600_000)),
                }))}
                format={value => `${value.toFixed(value < 1 ? 2 : 1)} h`}
              />
              <ChartContainer
                config={{ hours: { label: 'Hours', color: 'var(--chart-3)' } }}
                className="aspect-auto w-full"
                style={{ height: Math.max(96, busyAgents.length * 36 + 24) }}
              >
                <BarChart
                  accessibilityLayer
                  data={busyAgents.map(agent => ({ name: agent.name, hours: agent.activeMs / 3_600_000 }))}
                  layout="vertical"
                  margin={{ left: 8, right: 16 }}
                >
                  <CartesianGrid horizontal={false} />
                  <XAxis
                    type="number"
                    tickFormatter={value => `${Number(value).toFixed(1)} h`}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis type="category" dataKey="name" width={96} axisLine={false} tickLine={false} />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent formatter={value => hours(Number(value) * 3_600_000)} />}
                  />
                  <Bar dataKey="hours" fill="var(--color-hours)" radius={4} isAnimationActive={false} />
                </BarChart>
              </ChartContainer>
            </>
          ) : (
            <Empty>No agent worked in this period.</Empty>
          )}
        </Panel>
        <Panel
          title="Spend per provider"
          scope="organization"
          subtitle={
            data.providers.some(provider => provider.subscription)
              ? 'Running total. Subscription providers (ChatGPT) show the API-equivalent price, not money billed.'
              : 'Running total over the period.'
          }
        >
          {data.providers.length ? (
            <>
              {!priced.length && <Empty>No priced provider in this period.</Empty>}
              {priced.length > 0 && (
                <TimeChart
                  line
                  buckets={data.buckets}
                  series={data.providers
                    .filter(provider => provider.priced)
                    .map(provider => ({
                      key: provider.provider,
                      label: `${provider.label}${provider.subscription ? ' (subscription)' : ''}`,
                      values: cumulative(provider.cost),
                    }))}
                  format={dollars}
                />
              )}
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {data.providers.map(provider => (
                  <li key={provider.provider}>
                    {provider.label}:{' '}
                    {provider.priced ? (
                      <span className="font-mono text-foreground">{dollars(provider.total)}</span>
                    ) : (
                      <span className="text-foreground">not priced (custom endpoint)</span>
                    )}
                    {provider.subscription && ' (API-equivalent)'}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Empty>No model calls in this period.</Empty>
          )}
        </Panel>
      </div>

      <section aria-labelledby="dashboard-tokens" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="dashboard-tokens" className="text-sm font-semibold">
            Tokens per agent
          </h3>
          <span className="text-xs text-muted-foreground">By type, stacked (reasoning is part of output)</span>
        </div>
        {tokenAgents.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {tokenAgents.map(agent => (
              <Panel
                key={agent.id}
                title={agent.name}
                scope="organization"
                subtitle={`Input ${tokens(agent.tokenTotals.input)} · Output ${tokens(agent.tokenTotals.output)} (reasoning ${tokens(agent.tokenTotals.reasoning)}) · Cache read ${tokens(agent.tokenTotals.cacheRead)} · Cache write ${tokens(agent.tokenTotals.cacheWrite)} · ${dollars(agent.cost)}`}
              >
                <TimeChart
                  stacked
                  buckets={data.buckets}
                  series={TOKEN_TYPES.map(([key, label]) => ({
                    key,
                    label,
                    // Output includes reasoning: stack the rest of output and reasoning separately.
                    values:
                      key === 'output'
                        ? agent.tokens.output.map((value, i) =>
                            value === null ? null : Math.max(0, value - (agent.tokens.reasoning[i] ?? 0)),
                          )
                        : agent.tokens[key],
                  }))}
                  format={tokens}
                />
              </Panel>
            ))}
          </div>
        ) : (
          <div className={settingsCard}>
            <Empty>No tokens used in this period.</Empty>
          </div>
        )}
      </section>
    </>
  );
}
