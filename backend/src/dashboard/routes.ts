import type { FastifyInstance } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import type { PlatformStore } from '../platform-store';

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
      provider: Type.String(),
      /** True when billed by subscription: the cost is the API-equivalent price. */
      subscription: Type.Boolean(),
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

const num = (value: bigint | number | null | undefined) => (value == null ? null : Number(value));

/** Averages per bucket (null where a bucket has no sample). */
function averaged(count: number) {
  const sums = new Array<number>(count).fill(0);
  const counts = new Array<number>(count).fill(0);
  return {
    add(index: number, value: number) {
      sums[index]! += value;
      counts[index]! += 1;
    },
    series: () => sums.map((sum, i) => (counts[i] ? sum / counts[i]! : null)),
  };
}

const summed = (count: number) => new Array<number>(count).fill(0);

/** The Dashboard's numbers for one period (docs/dashboard.md). */
export async function dashboardData(
  platform: PlatformStore,
  range: DashboardRange,
  organization?: string,
  now = Date.now(),
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

  const [system, disks, computers, agents] = await Promise.all([
    client.systemSample.findMany({ where: { at: since }, orderBy: { at: 'asc' } }),
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
  const [computerSamples, usage, spans] = await Promise.all([
    client.computerSample.findMany({
      where: { at: since, computerId: { in: computers.map(computer => computer.id) } },
      orderBy: { at: 'asc' },
    }),
    client.usageEvent.findMany({ where: { at: since, agentId: { in: agentIds } } }),
    client.agentRunSpan.findMany({
      where: {
        agentId: { in: agentIds },
        startedAt: { lt: new Date(to) },
        OR: [{ endedAt: null }, { endedAt: { gt: new Date(from) } }],
      },
    }),
  ]);

  const cpu = averaged(count);
  const mem = averaged(count);
  for (const sample of system) {
    cpu.add(index(sample.at), sample.cpuPercent);
    mem.add(index(sample.at), Number(sample.memUsed));
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
    cpu: averaged(count),
    mem: averaged(count),
    limit: null as number | null,
  }));
  const byComputer = new Map(computerViews.map(view => [view.id, view]));
  for (const sample of computerSamples) {
    const view = byComputer.get(sample.computerId);
    if (!view) continue;
    view.cpu.add(index(sample.at), sample.cpuPercent);
    view.mem.add(index(sample.at), Number(sample.memUsed));
    view.limit = num(sample.memLimit) ?? view.limit;
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
  const providers = new Map<string, { cost: number[]; total: number }>();
  for (const event of usage) {
    const view = byAgent.get(event.agentId);
    if (!view) continue;
    const i = index(event.at);
    view.tokens.input[i]! += event.input;
    view.tokens.output[i]! += event.output;
    view.tokens.cacheRead[i]! += event.cacheRead;
    view.tokens.cacheWrite[i]! += event.cacheWrite;
    view.tokens.reasoning[i]! += event.reasoning;
    view.cost += event.cost;
    let provider = providers.get(event.provider);
    if (!provider) providers.set(event.provider, (provider = { cost: summed(count), total: 0 }));
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
    system: {
      cpuPercent: cpu.series(),
      memUsed: mem.series(),
      memTotal: num(system.at(-1)?.memTotal),
    },
    disks: [...diskViews.values()],
    computers: computerViews.map(view => ({
      id: view.id,
      name: view.name,
      cpuPercent: view.cpu.series(),
      memUsed: view.mem.series(),
      memLimit: view.limit,
    })),
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
      .map(([provider, value]) => ({
        provider,
        subscription: SUBSCRIPTION_PROVIDERS.has(provider),
        cost: value.cost,
        total: value.total,
      }))
      .sort((a, b) => b.total - a.total),
  };
}

export function registerDashboardRoutes(app: FastifyInstance, platform: PlatformStore) {
  app.get(
    '/api/dashboard',
    { schema: { operationId: 'getDashboard', querystring: Query, response: { 200: Dashboard } } },
    async (request, reply) => {
      const { range = '48h', organization } = request.query as Static<typeof Query>;
      reply.header('cache-control', 'no-store');
      return dashboardData(platform, range as DashboardRange, organization);
    },
  );
}
