import type { FastifyInstance } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import type { PlatformStore } from '../platform-store';
import { EndpointStore } from '../endpoint-store';
import { LIVE_INTERVAL_MS, LiveMetrics } from '../metrics/live';

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
  system: Type.Object({
    cpuPercent: Series,
    memUsed: Series,
    memTotal: Type.Union([Type.Number(), Type.Null()]),
    /** Bytes per second across the physical network interfaces. */
    netRx: Series,
    netTx: Series,
  }),
  /** Each physical disk's throughput (bytes per second). */
  diskIo: Type.Array(Type.Object({ device: Type.String(), label: Type.String(), read: Series, write: Series })),
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
  labelOf?: (device: string) => Promise<string>,
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
    client.$queryRawUnsafe<
      {
        b: number;
        cpu: number;
        mem: number;
        total: number;
        netRx: number | null;
        netTx: number | null;
      }[]
    >(
      `SELECT ${bucketOf} AS b, AVG("cpuPercent") AS cpu, AVG("memUsed") AS mem, MAX("memTotal") AS total,
         AVG("netRx") AS "netRx", AVG("netTx") AS "netTx"
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
  const io = {
    netRx: new Array<number | null>(count).fill(null),
    netTx: new Array<number | null>(count).fill(null),
  };
  let memTotal: number | null = null;
  for (const row of system) {
    const b = Number(row.b);
    if (!inRange(b)) continue;
    cpuSeries[b] = Number(row.cpu);
    memSeries[b] = Number(row.mem);
    for (const key of ['netRx', 'netTx'] as const) io[key][b] = row[key] == null ? null : Number(row[key]);
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
  const ioRows = await client.$queryRawUnsafe<{ device: string; b: number; read: number; write: number }[]>(
    `SELECT "device", ${bucketOf} AS b, AVG("read") AS "read", AVG("write") AS "write"
     FROM "DiskIoSample" WHERE "at" >= ? AND unixepoch("at") >= ? GROUP BY "device", b ORDER BY "device", b`,
    from,
    bucket,
    indexFrom,
    from / 1000,
  );
  const diskIo = new Map<
    string,
    { device: string; label: string; read: (number | null)[]; write: (number | null)[] }
  >();
  for (const row of ioRows) {
    const b = Number(row.b);
    if (!inRange(b)) continue;
    let view = diskIo.get(row.device);
    if (!view) {
      view = {
        device: row.device,
        label: (await labelOf?.(row.device)) ?? row.device,
        read: new Array(count).fill(null),
        write: new Array(count).fill(null),
      };
      diskIo.set(row.device, view);
    }
    view.read[b] = Number(row.read);
    view.write[b] = Number(row.write);
  }

  return {
    range,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    bucketMs: bucket,
    buckets,
    system: { cpuPercent: cpuSeries, memUsed: memSeries, memTotal, ...io },
    diskIo: [...diskIo.values()],
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

const LivePoint = Type.Object({
  t: Type.Number(),
  cpuPercent: Point,
  memUsed: Point,
  memTotal: Point,
  netRx: Point,
  netTx: Point,
  disks: Type.Record(Type.String(), Type.Object({ read: Type.Number(), write: Type.Number() })),
});

export function registerDashboardRoutes(
  app: FastifyInstance,
  platform: PlatformStore,
  endpoints: EndpointStore = new EndpointStore(),
  live: LiveMetrics = new LiveMetrics(),
) {
  // The live minute samples only while the server is up (never in tests that do not listen).
  const followers = new Set<NodeJS.WritableStream & { end(): void }>();
  app.addHook('onListen', async () => live.start());
  app.addHook('onClose', async () => {
    live.stop();
    for (const follower of followers) follower.end();
  });
  const snapshot = async () => {
    const names = [...new Set(live.points.flatMap(point => Object.keys(point.disks)))].sort();
    const devices = await Promise.all(names.map(async device => ({ device, label: await live.labelOf(device) })));
    return { intervalMs: LIVE_INTERVAL_MS, cores: live.cores, devices, points: live.points };
  };
  app.get(
    '/api/dashboard/live',
    {
      schema: {
        operationId: 'getDashboardLive',
        response: {
          200: Type.Object({
            intervalMs: Type.Integer(),
            cores: Type.Union([Type.Integer(), Type.Null()]),
            /** Each physical disk in the readings, with its label. */
            devices: Type.Array(Type.Object({ device: Type.String(), label: Type.String() })),
            points: Type.Array(LivePoint),
          }),
        },
      },
    },
    async (_request, reply) => {
      reply.header('cache-control', 'no-store');
      return snapshot();
    },
  );
  // The same as it happens, like the agent-run stream: the snapshot, then each reading as one NDJSON line. A new disk
  // sends a fresh snapshot (with its label). Signing out ends it; a slow reader is dropped.
  app.get(
    '/api/dashboard/live/stream',
    {
      schema: {
        operationId: 'followDashboardLive',
        response: {
          200: Type.String({
            description:
              'NDJSON: {type:"snapshot", ...getDashboardLive} then {type:"point", point} per reading, and heartbeats.',
          }),
        },
      },
    },
    async (request, reply) => {
      if (reply.raw.destroyed) return reply;
      const first = await snapshot();
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
      });
      const out = reply.raw;
      // Gone while the snapshot was read (a disk's label): its close already fired, so nothing to follow.
      if (out.destroyed) return reply;
      const write = (event: object) => {
        if (out.destroyed || out.writableEnded) return;
        if (out.writableLength > 1_048_576) return void out.destroy();
        out.write(`${JSON.stringify(event)}\n`);
      };
      const known = new Set(first.devices.map(item => item.device));
      const unsubscribe = live.subscribe(point => {
        if (Object.keys(point.disks).some(device => !known.has(device)))
          return void snapshot().then(next => {
            for (const item of next.devices) known.add(item.device);
            write({ type: 'snapshot', ...next });
          });
        write({ type: 'point', point });
      });
      const unwatch = app.watchSession?.(request, () => out.destroy()) ?? (() => {});
      const heartbeat = setInterval(() => write({ type: 'heartbeat' }), 15_000);
      followers.add(out);
      out.once('close', () => {
        clearInterval(heartbeat);
        unwatch();
        unsubscribe();
        followers.delete(out);
      });
      write({ type: 'snapshot', ...first });
      return reply;
    },
  );
  app.get(
    '/api/dashboard',
    { schema: { operationId: 'getDashboard', querystring: Query, response: { 200: Dashboard } } },
    async (request, reply) => {
      const { range = '48h', organization } = request.query as Static<typeof Query>;
      reply.header('cache-control', 'no-store');
      const names = new Map((await endpoints.read().catch(() => [])).map(endpoint => [endpoint.id, endpoint.name]));
      return dashboardData(platform, range as DashboardRange, organization, Date.now(), names, device =>
        live.labelOf(device),
      );
    },
  );
}
