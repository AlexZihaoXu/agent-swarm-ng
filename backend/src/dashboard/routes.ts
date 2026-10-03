import type { FastifyInstance } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import type { PlatformStore } from '../platform-store';
import { EndpointStore } from '../endpoint-store';

const HOUR = 3_600_000;
/** Each period and its bucket: about 60–100 points per chart. */
export const RANGES = {
  '12h': { span: 12 * HOUR, bucket: 10 * 60_000 },
  '24h': { span: 24 * HOUR, bucket: 20 * 60_000 },
  '48h': { span: 48 * HOUR, bucket: 30 * 60_000 },
  '72h': { span: 72 * HOUR, bucket: HOUR },
  '7d': { span: 7 * 24 * HOUR, bucket: 3 * HOUR },
} as const;
export type DashboardRange = keyof typeof RANGES;
/** Providers paid by subscription: their cost is the API-equivalent price, not money spent. */
const SUBSCRIPTION_PROVIDERS = new Set(['openai-codex']);
/** Pi's provider name for a saved custom endpoint: no prices are known, so its spend is not shown as $0. */
const CUSTOM_PROVIDER = 'swarm-chat';
const DELETED = { id: 'deleted', name: 'Deleted agents' };

const Point = Type.Union([Type.Number(), Type.Null()]);
const Series = Type.Array(Point);
const TokenTypes = Type.Object({
  input: Series,
  output: Series,
  cacheRead: Series,
  cacheWrite: Series,
  reasoning: Series,
});
const TokenTotals = Type.Object({
  input: Type.Number(),
  output: Type.Number(),
  cacheRead: Type.Number(),
  cacheWrite: Type.Number(),
  reasoning: Type.Number(),
});
export const Dashboard = Type.Object({
  range: Type.String(),
  from: Type.String({ format: 'date-time' }),
  to: Type.String({ format: 'date-time' }),
  bucketMs: Type.Integer(),
  /** Bucket start times (ms), oldest first; every series below has one value per bucket (null: no data). */
  buckets: Type.Array(Type.Number()),
  system: Type.Object({ cpuPercent: Series, memUsed: Series, memTotal: Type.Union([Type.Number(), Type.Null()]) }),
  disks: Type.Array(
    Type.Object({
      disk: Type.String(),
      label: Type.String(),
      uses: Type.Array(Type.String()),
      used: Series,
      total: Type.Union([Type.Number(), Type.Null()]),
    }),
  ),
  computers: Type.Array(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      cpuPercent: Series,
      memUsed: Series,
      /** Each reading against the limit it had then. */
      memPercent: Series,
      memLimit: Type.Union([Type.Number(), Type.Null()]),
    }),
  ),
  agents: Type.Array(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      /** Milliseconds working in the period, and per bucket. */
      activeMs: Type.Number(),
      active: Series,
      tokens: TokenTypes,
      tokenTotals: TokenTotals,
      cost: Type.Number(),
    }),
  ),
  providers: Type.Array(
    Type.Object({
      /** A stable key: the provider, or `endpoint:<id>` for a saved custom endpoint. */
      provider: Type.String(),
      label: Type.String(),
      /** True when billed by subscription: the cost is the API-equivalent price. */
      subscription: Type.Boolean(),
      /** False when no prices are known (a custom endpoint): its cost is not shown. */
      priced: Type.Boolean(),
      cost: Series,
      total: Type.Number(),
    }),
  ),
});
type DashboardView = Static<typeof Dashboard>;

const Query = Type.Object({
  range: Type.Optional(Type.Union(Object.keys(RANGES).map(key => Type.Literal(key)))),
  /** An organization to show; omitted for all. System-wide charts ignore it. */
  organization: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
});

const summed = (count: number) => new Array<number>(count).fill(0);

/** The Dashboard's numbers for one period (docs/dashboard.md). */
export async function dashboardData(
  platform: PlatformStore,
  range: DashboardRange,
  organization?: string,
  now = Date.now(),
  endpointNames: Map<string, string> = new Map(),
): Promise<DashboardView> {
  await platform.initialize();
  const client = platform.client;
  const { span, bucket } = RANGES[range];
  // Buckets end at the next bucket boundary after now, so the newest bucket is the current one.
  const to = Math.ceil(now / bucket) * bucket;
  const from = to - span;
  const count = span / bucket;
  const buckets = Array.from({ length: count }, (_, i) => from + i * bucket);
  const index = (at: Date) => Math.min(count - 1, Math.max(0, Math.floor((at.getTime() - from) / bucket)));
  const since = { gte: new Date(from) };

  // Host and computer samples are grouped into buckets in SQL: a week of minute samples never loads row by row.
  const bucketOf = `CAST((unixepoch("at") * 1000 - ?) / ? AS INTEGER)`;
  // The plain text comparison lets SQLite use the "at" index (Prisma stores ISO text); a day's margin covers any
  // stored format, and unixepoch() then filters exactly.
  const indexFrom = new Date(from - 86_400_000).toISOString().slice(0, 10);
  const [system, disks, computers, agents] = await Promise.all([
    client.$queryRawUnsafe<{ b: number; cpu: number; mem: number; total: number }[]>(
      `SELECT ${bucketOf} AS b, AVG("cpuPercent") AS cpu, AVG("memUsed") AS mem, MAX("memTotal") AS total
       FROM "SystemSample" WHERE "at" >= ? AND unixepoch("at") >= ? GROUP BY b ORDER BY b`,
      from,
      bucket,
      indexFrom,
      from / 1000,
    ),
    client.diskSample.findMany({ where: { at: since }, orderBy: { at: 'asc' } }),
    client.computer.findMany({
      where: organization ? { organizationId: organization } : {},
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    }),
    client.agent.findMany({
      where: organization ? { organizationId: organization } : {},
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const agentIds = agents.map(agent => agent.id);
  const computerIds = computers.map(computer => computer.id);
  const [computerSamples, usage, spans] = await Promise.all([
    computerIds.length
      ? client.$queryRawUnsafe<
          { computerId: string; b: number; cpu: number; mem: number; percent: number | null; limit: number | null }[]
        >(
          `SELECT "computerId", ${bucketOf} AS b, AVG("cpuPercent") AS cpu, AVG("memUsed") AS mem,
             AVG("memPercent") AS percent, MAX("memLimit") AS "limit"
           FROM "ComputerSample" WHERE "at" >= ? AND unixepoch("at") >= ? AND "computerId" IN (${computerIds.map(() => '?').join(',')})
           GROUP BY "computerId", b ORDER BY b`,
          from,
          bucket,
          indexFrom,
          from / 1000,
          ...computerIds,
        )
      : Promise.resolve([]),
    // Showing every organization, usage of agents deleted since still counts (as "Deleted agents").
    client.usageEvent.findMany({ where: { at: since, ...(organization ? { agentId: { in: agentIds } } : {}) } }),
    client.agentRunSpan.findMany({
      where: {
        agentId: { in: agentIds },
        startedAt: { lt: new Date(to) },
        OR: [{ endedAt: null }, { endedAt: { gt: new Date(from) } }],
      },
    }),
  ]);
  const inRange = (b: number) => b >= 0 && b < count;

  const cpuSeries: (number | null)[] = new Array(count).fill(null);
  const memSeries: (number | null)[] = new Array(count).fill(null);
  let memTotal: number | null = null;
  for (const row of system) {
    const b = Number(row.b);
    if (!inRange(b)) continue;
    cpuSeries[b] = Number(row.cpu);
    memSeries[b] = Number(row.mem);
    memTotal = Number(row.total);
  }

  // Each disk: its latest reading per bucket, and its latest size and uses.
  const diskViews = new Map<string, DashboardView['disks'][number]>();
  for (const sample of disks) {
    let view = diskViews.get(sample.disk);
    if (!view) {
      view = { disk: sample.disk, label: sample.label, uses: [], used: new Array(count).fill(null), total: null };
      diskViews.set(sample.disk, view);
    }
    view.used[index(sample.at)] = Number(sample.used);
    view.total = Number(sample.total);
    view.label = sample.label;
    try {
      view.uses = JSON.parse(sample.uses) as string[];
    } catch {
      view.uses = [];
    }
  }

  const computerViews = computers.map(computer => ({
    ...computer,
    cpuPercent: new Array<number | null>(count).fill(null),
    memUsed: new Array<number | null>(count).fill(null),
    memPercent: new Array<number | null>(count).fill(null),
    memLimit: null as number | null,
  }));
  const byComputer = new Map(computerViews.map(view => [view.id, view]));
  for (const row of computerSamples) {
    const view = byComputer.get(row.computerId);
    const b = Number(row.b);
    if (!view || !inRange(b)) continue;
    view.cpuPercent[b] = Number(row.cpu);
    view.memUsed[b] = Number(row.mem);
    view.memPercent[b] = row.percent == null ? null : Number(row.percent);
    view.memLimit = row.limit == null ? view.memLimit : Number(row.limit);
  }

  const agentViews = agents.map(agent => ({
    ...agent,
    activeMs: 0,
    active: summed(count),
    tokens: {
      input: summed(count),
      output: summed(count),
      cacheRead: summed(count),
      cacheWrite: summed(count),
      reasoning: summed(count),
    },
    cost: 0,
  }));
  const byAgent = new Map(agentViews.map(view => [view.id, view]));
  const deletedView = () => {
    let view = byAgent.get(DELETED.id);
    if (!view) {
      view = {
        ...DELETED,
        activeMs: 0,
        active: summed(count),
        tokens: {
          input: summed(count),
          output: summed(count),
          cacheRead: summed(count),
          cacheWrite: summed(count),
          reasoning: summed(count),
        },
        cost: 0,
      };
      byAgent.set(DELETED.id, view);
      agentViews.push(view);
    }
    return view;
  };
  // Active time: each run's overlap with each bucket.
  for (const span of spans) {
    const view = byAgent.get(span.agentId);
    if (!view) continue;
    const start = Math.max(from, span.startedAt.getTime());
    const end = Math.min(now, span.endedAt?.getTime() ?? now);
    for (let at = start; at < end;) {
      const i = Math.floor((at - from) / bucket);
      const next = Math.min(end, from + (i + 1) * bucket);
      view.active[i]! += next - at;
      view.activeMs += next - at;
      at = next;
    }
  }
  const providers = new Map<
    string,
    { label: string; subscription: boolean; priced: boolean; cost: number[]; total: number }
  >();
  for (const event of usage) {
    const view = byAgent.get(event.agentId) ?? deletedView();
    const i = index(event.at);
    view.tokens.input[i]! += event.input;
    view.tokens.output[i]! += event.output;
    view.tokens.cacheRead[i]! += event.cacheRead;
    view.tokens.cacheWrite[i]! += event.cacheWrite;
    view.tokens.reasoning[i]! += event.reasoning;
    view.cost += event.cost;
    const custom = event.provider === CUSTOM_PROVIDER;
    const key = custom ? `endpoint:${event.endpointId ?? 'unknown'}` : event.provider;
    let provider = providers.get(key);
    if (!provider)
      providers.set(
        key,
        (provider = {
          label: custom ? (endpointNames.get(event.endpointId ?? '') ?? 'Custom endpoint') : event.provider,
          subscription: SUBSCRIPTION_PROVIDERS.has(event.provider),
          priced: !custom,
          cost: summed(count),
          total: 0,
        }),
      );
    provider.cost[i]! += event.cost;
    provider.total += event.cost;
  }
  const total = (series: number[]) => series.reduce((sum, value) => sum + value, 0);

  return {
    range,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    bucketMs: bucket,
    buckets,
    system: { cpuPercent: cpuSeries, memUsed: memSeries, memTotal },
    disks: [...diskViews.values()],
    computers: computerViews,
    agents: agentViews.map(view => ({
      id: view.id,
      name: view.name,
      activeMs: view.activeMs,
      active: view.active,
      tokens: view.tokens,
      tokenTotals: {
        input: total(view.tokens.input),
        output: total(view.tokens.output),
        cacheRead: total(view.tokens.cacheRead),
        cacheWrite: total(view.tokens.cacheWrite),
        reasoning: total(view.tokens.reasoning),
      },
      cost: view.cost,
    })),
    providers: [...providers.entries()]
      .map(([provider, value]) => ({ provider, ...value }))
      .sort((a, b) => b.total - a.total),
  };
}

export function registerDashboardRoutes(
  app: FastifyInstance,
  platform: PlatformStore,
  endpoints: EndpointStore = new EndpointStore(),
) {
  app.get(
    '/api/dashboard',
    { schema: { operationId: 'getDashboard', querystring: Query, response: { 200: Dashboard } } },
    async (request, reply) => {
      const { range = '48h', organization } = request.query as Static<typeof Query>;
      reply.header('cache-control', 'no-store');
      const names = new Map((await endpoints.read().catch(() => [])).map(endpoint => [endpoint.id, endpoint.name]));
      return dashboardData(platform, range as DashboardRange, organization, Date.now(), names);
    },
  );
}
