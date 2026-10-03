import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import type { PlatformStore } from '../platform-store';
import { clientAddress } from '../auth/routes';
import { contains, parseRange, type KnownAddresses } from '../security/addresses';

export const ACCESS_KEEP_DAYS = 30;
const FLUSH_MS = 10_000;
const MAX_PENDING = 20_000;
/** Rows per multi-row upsert: each chunk is its own short write. */
const CHUNK = 250;

const PLACES: [string, string][] = [
  ['127.0.0.0/8', 'Local'],
  ['::1', 'Local'],
  ['100.64.0.0/10', 'Tailnet'],
  ['fd7a:115c:a1e0::/48', 'Tailnet'],
  ['10.0.0.0/8', 'LAN'],
  ['172.16.0.0/12', 'LAN'],
  ['192.168.0.0/16', 'LAN'],
  ['fc00::/7', 'LAN'],
  ['fe80::/10', 'LAN'],
];
const PLACE_RANGES = PLACES.map(([range, place]) => ({ range: parseRange(range)!.range, place }));

/** Where a request came from: Cloudflare's country for a visitor through it, else the kind of private network. */
export function placeOf(ip: string, cfCountry: string | undefined) {
  const local = PLACE_RANGES.find(entry => contains(entry.range, ip));
  if (local) return local.place;
  return cfCountry && /^[A-Z]{2}$/.test(cfCountry) && cfCountry !== 'XX' ? cfCountry : '??';
}

type Key = { minute: number; ip: string; country: string; user: string; method: string; route: string; status: number };
type Pending = Key & { count: number; totalMs: number; maxMs: number };
type Log = { error(object: unknown, message: string): void; warn(object: unknown, message: string): void };

/** Distinct unmatched paths kept as themselves per (minute, address); the rest fold into one row. */
export const UNMATCHED_PATHS = 20;
export const OTHER_UNMATCHED = '(other unmatched)';
const COLUMNS = ['minute', 'ip', 'country', 'user', 'method', 'route', 'status', 'count', 'totalMs', 'maxMs'] as const;
const pendingId = (key: Key) => [key.minute, key.ip, key.user, key.method, key.route, key.status].join('\n');

/**
 * The access log (docs/access-log.md): every request's address, country, signed-in person (only when signed in),
 * route, status and duration, folded per minute in memory and written every ten seconds in short chunked upserts.
 */
export class AccessLog {
  private pending = new Map<string, Pending>();
  /** Requests dropped (key cap or a failed write that could not be kept) since the last report. */
  private dropped = 0;
  /** Unmatched paths seen per address in the current minute (bounded like the pending keys). */
  private unmatched = { minute: -1, size: 0, byIp: new Map<string, Set<string>>() };
  private timer: ReturnType<typeof setInterval> | undefined;
  private log: Log | undefined;
  private readonly maxPending: number;
  private readonly chunk: number;

  constructor(
    private readonly platform: PlatformStore,
    limits: { maxPending?: number; chunk?: number } = {},
  ) {
    this.maxPending = limits.maxPending ?? MAX_PENDING;
    this.chunk = limits.chunk ?? CHUNK;
  }

  /**
   * A path that matched no route: kept as itself (at most 80 characters, no query) for the first
   * UNMATCHED_PATHS distinct paths from one address in a minute, else folded so a scanner cannot add rows freely.
   */
  unmatchedRoute(minute: number, ip: string, path: string) {
    const route = path.split('?')[0]!.slice(0, 80);
    if (this.unmatched.minute !== minute) this.unmatched = { minute, size: 0, byIp: new Map() };
    const seen = this.unmatched.byIp.get(ip);
    if (seen?.has(route)) return route;
    if ((seen?.size ?? 0) >= UNMATCHED_PATHS || this.unmatched.size >= this.maxPending) return OTHER_UNMATCHED;
    if (seen) seen.add(route);
    else this.unmatched.byIp.set(ip, new Set([route]));
    this.unmatched.size += 1;
    return route;
  }

  add(key: Key, ms: number) {
    this.merge({ ...key, count: 1, totalMs: ms, maxMs: ms });
  }

  private merge(row: Pending) {
    const id = pendingId(row);
    const entry = this.pending.get(id);
    if (entry) {
      entry.count += row.count;
      entry.totalMs += row.totalMs;
      entry.maxMs = Math.max(entry.maxMs, row.maxMs);
      return;
    }
    // A flood of distinct keys between flushes: drop the excess rather than grow without bound.
    if (this.pending.size >= this.maxPending) {
      this.dropped += row.count;
      return;
    }
    this.pending.set(id, { ...row });
  }

  /**
   * Writes what is pending in chunks, each one multi-row upsert (its own short write). A chunk that fails is kept
   * with what was not yet written, merged back into memory as far as the key cap allows (the rest counts as dropped).
   */
  async flush() {
    this.reportDropped();
    if (!this.pending.size) return 0;
    const rows = [...this.pending.values()];
    this.pending = new Map();
    let written = 0;
    try {
      await this.platform.initialize();
      const client = this.platform.client;
      for (; written < rows.length; written += this.chunk) {
        const chunk = rows.slice(written, written + this.chunk);
        await client.$executeRawUnsafe(
          `INSERT INTO "AccessMinute" (${COLUMNS.map(column => `"${column}"`).join(',')})
           VALUES ${chunk.map(() => `(${COLUMNS.map(() => '?').join(',')})`).join(',')}
           ON CONFLICT ("minute","ip","user","method","route","status") DO UPDATE SET
             "count" = "count" + excluded."count", "totalMs" = "totalMs" + excluded."totalMs",
             "maxMs" = MAX("maxMs", excluded."maxMs"), "country" = excluded."country"`,
          ...chunk.flatMap(row => COLUMNS.map(column => row[column])),
        );
      }
    } catch (error) {
      for (const row of rows.slice(written)) this.merge(row);
      this.reportDropped();
      throw error;
    }
    return rows.length;
  }

  private reportDropped() {
    const dropped = this.takeDropped();
    if (dropped) this.log?.warn({ dropped }, `Access log dropped ${dropped} requests (too many distinct keys)`);
  }

  /** Rows older than the retention, in small batches. */
  async prune(now = Date.now()) {
    await this.platform.initialize();
    const before = Math.floor(now / 60_000) - ACCESS_KEEP_DAYS * 24 * 60;
    let removed = 0;
    for (;;) {
      const batch = await this.platform.client.accessMinute.findMany({
        where: { minute: { lt: before } },
        take: 2000,
        select: { sequence: true },
      });
      if (!batch.length) return removed;
      removed += (
        await this.platform.client.accessMinute.deleteMany({
          where: { sequence: { in: batch.map(row => row.sequence) } },
        })
      ).count;
    }
  }

  takeDropped() {
    const dropped = this.dropped;
    this.dropped = 0;
    return dropped;
  }

  start(log: Log) {
    this.log = log;
    this.timer ??= setInterval(
      () => void this.flush().catch(error => log.error(error, 'Access log flush failed')),
      FLUSH_MS,
    );
    this.timer.unref?.();
  }

  async stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.flush().catch(error => this.log?.error(error, 'Access log flush failed'));
  }
}

const RANGES = { '1h': 60, '24h': 24 * 60, '7d': 7 * 24 * 60 } as const;
const BUCKET = { '1h': 1, '24h': 30, '7d': 180 } as const;
const Query = Type.Object({
  range: Type.Optional(Type.Union([Type.Literal('1h'), Type.Literal('24h'), Type.Literal('7d')])),
  ip: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
});
const Top = Type.Array(
  Type.Object({
    key: Type.String(),
    requests: Type.Integer(),
    errors: Type.Integer(),
    avgMs: Type.Number(),
    maxMs: Type.Integer(),
  }),
);
const Access = Type.Object({
  range: Type.String(),
  bucketMinutes: Type.Integer(),
  buckets: Type.Array(Type.Number()),
  /** Requests per bucket by status class. */
  series: Type.Object({
    ok: Type.Array(Type.Integer()),
    redirect: Type.Array(Type.Integer()),
    client: Type.Array(Type.Integer()),
    server: Type.Array(Type.Integer()),
  }),
  totals: Type.Object({
    requests: Type.Integer(),
    errors: Type.Integer(),
    addresses: Type.Integer(),
    countries: Type.Integer(),
  }),
  countries: Top,
  addresses: Type.Array(
    Type.Object({
      ip: Type.String(),
      label: Type.Union([Type.String(), Type.Null()]),
      trusted: Type.Boolean(),
      country: Type.String(),
      /** Signed-in people seen from it (none when only signed-out requests came from it). */
      users: Type.Array(Type.String()),
      requests: Type.Integer(),
      errors: Type.Integer(),
      avgMs: Type.Number(),
      maxMs: Type.Integer(),
    }),
  ),
  routes: Top,
  statuses: Top,
});

type Sum = {
  key: string;
  requests: number | bigint;
  errors: number | bigint;
  totalMs: number | bigint;
  maxMs: number | bigint;
};
const summary = (row: Sum) => ({
  key: String(row.key),
  requests: Number(row.requests),
  errors: Number(row.errors),
  avgMs: Number(row.requests) ? Math.round(Number(row.totalMs) / Number(row.requests)) : 0,
  maxMs: Number(row.maxMs),
});
const SUMS = `SUM("count") AS requests, SUM(CASE WHEN "status" >= 400 THEN "count" ELSE 0 END) AS errors,
  SUM("totalMs") AS totalMs, MAX("maxMs") AS maxMs`;

/**
 * Records every request (onResponse, plus WebSocket upgrades once accepted, which never reach onResponse) and serves
 * Settings → Access log's analysis, aggregated in SQL.
 */
export function registerAccessLog(
  app: FastifyInstance,
  platform: PlatformStore,
  access: AccessLog,
  addresses: KnownAddresses,
) {
  const record = (request: FastifyRequest, status: number, ms: number) => {
    const minute = Math.floor(Date.now() / 60_000);
    const ip = clientAddress(request);
    access.add(
      {
        minute,
        ip,
        country: placeOf(ip, String(request.headers['cf-ipcountry'] ?? '').toUpperCase()),
        user: request.signedIn?.name ?? '',
        method: request.method,
        route: request.routeOptions.url ?? access.unmatchedRoute(minute, ip, request.url),
        status,
      },
      Math.round(ms),
    );
  };
  app.addHook('onResponse', async (request: FastifyRequest, reply) =>
    record(request, reply.statusCode, reply.elapsedTime),
  );
  // An accepted upgrade hijacks the reply, so onResponse never runs: record it (101, time to accept) when the
  // WebSocket server reports the connection. Refused upgrades are ordinary responses and go through onResponse.
  const upgrades = new WeakMap<object, { request: FastifyRequest; reply: FastifyReply }>();
  app.addHook('onRequest', async (request, reply) => {
    if ((request.headers.upgrade ?? '').toLowerCase() === 'websocket') upgrades.set(request.raw, { request, reply });
  });
  app.websocketServer?.on('connection', (_socket: unknown, raw: object) => {
    const upgrade = upgrades.get(raw);
    if (!upgrade) return;
    upgrades.delete(raw);
    record(upgrade.request, 101, upgrade.reply.elapsedTime);
  });
  app.addHook('onListen', async () => access.start(app.log));
  app.addHook('onClose', async () => access.stop());

  app.get(
    '/api/access',
    { schema: { operationId: 'getAccessLog', querystring: Query, response: { 200: Access } } },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      // Requests up to now count too: write what is pending first.
      await access.flush().catch(() => undefined);
      const { range = '24h', ip } = request.query as Static<typeof Query>;
      const bucket = BUCKET[range];
      const to = Math.ceil(Date.now() / 60_000 / bucket) * bucket;
      const from = to - RANGES[range];
      const count = RANGES[range] / bucket;
      await platform.initialize();
      // Uses the (minute) index, or (ip, minute) for one address.
      const where = `FROM "AccessMinute" WHERE "minute" >= ?${ip ? ' AND "ip" = ?' : ''}`;
      const params = ip ? [from, ip] : [from];
      const query = <T>(sql: string, ...extra: unknown[]) =>
        platform.client.$queryRawUnsafe<T[]>(sql, ...params, ...extra);
      const top = async (key: string, limit = 15) =>
        (
          await query<Sum>(
            `SELECT ${key} AS "key", ${SUMS} ${where} GROUP BY 1 ORDER BY requests DESC, "key" LIMIT ${limit}`,
          )
        ).map(summary);
      const [buckets, [distinct], countries, routes, statuses, ips] = await Promise.all([
        platform.client.$queryRawUnsafe<
          {
            b: number | bigint;
            ok: number | bigint;
            redirect: number | bigint;
            client: number | bigint;
            server: number | bigint;
          }[]
        >(
          `SELECT CAST(("minute" - ?) / ? AS INTEGER) AS b,
             SUM(CASE WHEN "status" < 300 THEN "count" ELSE 0 END) AS ok,
             SUM(CASE WHEN "status" >= 300 AND "status" < 400 THEN "count" ELSE 0 END) AS redirect,
             SUM(CASE WHEN "status" >= 400 AND "status" < 500 THEN "count" ELSE 0 END) AS client,
             SUM(CASE WHEN "status" >= 500 THEN "count" ELSE 0 END) AS server
           ${where} GROUP BY 1`,
          from,
          bucket,
          ...params,
        ),
        query<{ addresses: number | bigint; countries: number | bigint }>(
          `SELECT COUNT(DISTINCT "ip") AS addresses, COUNT(DISTINCT "country") AS countries ${where}`,
        ),
        top('"country"'),
        top(`"method" || ' ' || "route"`),
        top('CAST("status" AS TEXT)', 20),
        query<Sum & { country: string }>(
          `SELECT "ip" AS "key", MAX("country") AS country, ${SUMS} ${where}
           GROUP BY "ip" ORDER BY requests DESC, "ip" LIMIT 25`,
        ),
      ]);
      const series = {
        ok: new Array<number>(count).fill(0),
        redirect: new Array<number>(count).fill(0),
        client: new Array<number>(count).fill(0),
        server: new Array<number>(count).fill(0),
      };
      for (const row of buckets) {
        const b = Math.min(count - 1, Math.max(0, Number(row.b)));
        for (const kind of ['ok', 'redirect', 'client', 'server'] as const) series[kind][b] += Number(row[kind]);
      }
      // Signed-in people only for the addresses shown.
      const users = new Map<string, string[]>();
      if (ips.length) {
        const seen = await platform.client.$queryRawUnsafe<{ ip: string; user: string }[]>(
          `SELECT DISTINCT "ip", "user" FROM "AccessMinute" WHERE "minute" >= ? AND "user" <> ''
           AND "ip" IN (${ips.map(() => '?').join(',')}) ORDER BY "user"`,
          from,
          ...ips.map(row => row.key),
        );
        for (const row of seen) users.set(row.ip, [...(users.get(row.ip) ?? []), row.user]);
      }
      const addressList = await Promise.all(
        ips.map(async row => {
          const known = await addresses.match(row.key);
          const { key, ...sum } = summary(row);
          return {
            ip: key,
            label: known?.label ?? null,
            trusted: Boolean(known?.trusted),
            country: row.country,
            users: users.get(key) ?? [],
            ...sum,
          };
        }),
      );
      const totals = buckets.reduce(
        (sum, row) => ({
          requests: sum.requests + Number(row.ok) + Number(row.redirect) + Number(row.client) + Number(row.server),
          errors: sum.errors + Number(row.client) + Number(row.server),
        }),
        { requests: 0, errors: 0 },
      );
      return {
        range,
        bucketMinutes: bucket,
        buckets: Array.from({ length: count }, (_, i) => (from + i * bucket) * 60_000),
        series,
        totals: { ...totals, addresses: Number(distinct?.addresses ?? 0), countries: Number(distinct?.countries ?? 0) },
        countries,
        addresses: addressList,
        routes,
        statuses,
      };
    },
  );
}
