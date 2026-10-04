import type { FastifyInstance, FastifyReply } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import type { PlatformStore } from '../platform-store';
import { clientAddress } from '../auth/routes';
import { AUDIT_CATEGORIES, type AuditCategory, type AuditLog } from './store';
import type { KnownAddresses } from '../security/addresses';
import type { Alerts } from '../security/alerts';
import type { AccessLog } from '../access/log';

type Target = 'agent' | 'computer' | 'organization' | 'user';
type Rule = { kind: string; target: Target; section?: string };

/** Changes that are logged, by method and route. Edits log which fields changed, never their values. */
const RULES: Record<string, Rule> = {
  'POST /api/organizations': { kind: 'organization.create', target: 'organization' },
  'PATCH /api/organizations/:id': { kind: 'organization.update', target: 'organization' },
  'DELETE /api/organizations/:id': { kind: 'organization.delete', target: 'organization' },
  'POST /api/organizations/:id/move': { kind: 'organization.move', target: 'organization' },
  'POST /api/users': { kind: 'user.create', target: 'user' },
  'PATCH /api/users/:id': { kind: 'user.update', target: 'user' },
  'DELETE /api/users/:id': { kind: 'user.delete', target: 'user' },
  'POST /api/computers': { kind: 'computer.create', target: 'computer' },
  'PATCH /api/computers/:id/settings': { kind: 'computer.update', target: 'computer', section: 'settings' },
  'POST /api/computers/:id/settings/replacement': { kind: 'computer.update', target: 'computer', section: 'rebuilt' },
  'DELETE /api/computers/:id': { kind: 'computer.delete', target: 'computer' },
  'POST /api/agents': { kind: 'agent.create', target: 'agent' },
  'PATCH /api/agents/:id': { kind: 'agent.update', target: 'agent', section: 'agent' },
  'DELETE /api/agents/:id': { kind: 'agent.delete', target: 'agent' },
  'PATCH /api/agents/:id/settings': { kind: 'agent.update', target: 'agent', section: 'settings' },
  'PUT /api/agents/:id/computers': { kind: 'agent.update', target: 'agent', section: 'computers' },
  'PATCH /api/agents/:id/discord': { kind: 'agent.update', target: 'agent', section: 'discord' },
  'PUT /api/agents/:id/discord/token': { kind: 'agent.update', target: 'agent', section: 'discord bot connected' },
  'DELETE /api/agents/:id/discord/token': { kind: 'agent.update', target: 'agent', section: 'discord bot removed' },
  'PUT /api/agents/:id/memory/sleep-window': { kind: 'agent.update', target: 'agent', section: 'memory sleep window' },
  'PATCH /api/agents/:id/memory/:name': { kind: 'agent.update', target: 'agent', section: 'memory edited' },
  'DELETE /api/agents/:id/memory/:name': { kind: 'agent.update', target: 'agent', section: 'memory removed' },
  'POST /api/agents/:id/memory/:name/restore': { kind: 'agent.update', target: 'agent', section: 'memory restored' },
  'DELETE /api/agents/:id/memory': { kind: 'agent.update', target: 'agent', section: 'memory cleared' },
};

declare module 'fastify' {
  interface FastifyRequest {
    audit?: { rule: Rule; targetName?: string; movedName?: string; response?: unknown };
  }
  interface FastifyInstance {
    audit: AuditLog;
    alerts: Alerts;
    access: AccessLog;
  }
}

const Event = Type.Object({
  sequence: Type.Integer(),
  at: Type.String({ format: 'date-time' }),
  kind: Type.String(),
  outcome: Type.String(),
  actor: Type.Union([Type.String(), Type.Null()]),
  ip: Type.Union([Type.String(), Type.Null()]),
  targetId: Type.Union([Type.String(), Type.Null()]),
  targetName: Type.Union([Type.String(), Type.Null()]),
  detail: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  /** The known address's label (Settings → Security) and whether it is trusted. */
  ipLabel: Type.Union([Type.String(), Type.Null()]),
  ipTrusted: Type.Boolean(),
});
const Query = Type.Object({
  category: Type.Optional(Type.Union(Object.keys(AUDIT_CATEGORIES).map(key => Type.Literal(key)))),
  before: Type.Optional(Type.Integer({ minimum: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
});

const bodyFields = (body: unknown) =>
  body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).slice(0, 30) : [];

/** The audit log's route hooks (create, edit, delete of organizations, computers and agents) and its read API. */
export function registerAudit(
  app: FastifyInstance,
  platform: PlatformStore,
  audit: AuditLog,
  addresses?: KnownAddresses,
) {
  const nameOf = async (target: Target, id: string) => {
    await platform.initialize();
    const client = platform.client;
    const found =
      target === 'agent'
        ? await client.agent.findUnique({ where: { id }, select: { name: true } })
        : target === 'computer'
          ? await client.computer.findUnique({ where: { id }, select: { name: true } })
          : target === 'user'
            ? await client.user.findUnique({ where: { id }, select: { name: true } })
            : await client.organization.findUnique({ where: { id }, select: { name: true } });
    return found?.name;
  };

  // Before the handler: which rule applies, and the target's name while it still exists (deletes).
  app.addHook('preHandler', async request => {
    const rule = RULES[`${request.method} ${request.routeOptions.url}`];
    if (!rule) return;
    const id = (request.params as { id?: string } | undefined)?.id;
    request.audit = { rule, targetName: id ? await nameOf(rule.target, id).catch(() => undefined) : undefined };
    // A move names what moved (an agent or a computer; groups have no name lookup here).
    const moved = request.body as { kind?: unknown; id?: unknown } | undefined;
    if (
      rule.kind === 'organization.move' &&
      typeof moved?.id === 'string' &&
      (moved.kind === 'agent' || moved.kind === 'computer')
    )
      request.audit.movedName = await nameOf(moved.kind, moved.id).catch(() => undefined);
  });
  // Created things get their id and name from the answer.
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.audit && reply.statusCode < 300 && typeof payload === 'string' && payload.length < 1_000_000) {
      try {
        request.audit.response = JSON.parse(payload);
      } catch {
        // Not JSON: nothing to read.
      }
    }
    return payload;
  });
  app.addHook('onResponse', async (request, reply) => {
    const entry = request.audit;
    if (!entry || reply.statusCode === 401) return;
    const { rule } = entry;
    const params = request.params as { id?: string; name?: string } | undefined;
    const body = request.body as Record<string, unknown> | undefined;
    // A move preview changes nothing, and a retried create (the same request key answered again) made nothing new.
    if (rule.kind === 'organization.move' && body?.apply !== true) return;
    if (rule.kind === 'computer.create' && reply.statusCode === 200) return;
    const created = rule.kind.endsWith('.create') ? createdTarget(rule, body, entry.response) : undefined;
    await audit.record(
      {
        kind: rule.kind,
        outcome: reply.statusCode < 400 ? 'ok' : 'failed',
        actor: request.signedIn?.name ?? null,
        ip: clientAddress(request),
        targetId: created?.id ?? params?.id ?? null,
        targetName: created?.name ?? entry.targetName ?? null,
        detail: {
          ...(rule.section ? { section: rule.section } : {}),
          ...(rule.kind.endsWith('.update') || rule.kind === 'organization.move' ? { fields: bodyFields(body) } : {}),
          ...(rule.kind === 'organization.move'
            ? { moved: `${String(body?.kind)} ${entry.movedName ? `“${entry.movedName}”` : String(body?.id)}` }
            : {}),
          ...(params?.name ? { memory: params.name } : {}),
          ...(rule.kind === 'agent.update' && typeof body?.name === 'string' ? { newName: body.name } : {}),
          ...(reply.statusCode >= 400 ? { status: reply.statusCode } : {}),
        },
      },
      arrived(reply),
    );
  });

  app.get(
    '/api/audit',
    {
      schema: {
        operationId: 'listAuditEvents',
        querystring: Query,
        response: { 200: Type.Object({ events: Type.Array(Event), next: Type.Union([Type.Integer(), Type.Null()]) }) },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const { category, before, limit } = request.query as Static<typeof Query>;
      const page = await audit.list({ category: category as AuditCategory | undefined, before, limit });
      const events = await Promise.all(
        page.events.map(async event => {
          const known = await addresses?.match(event.ip);
          return { ...event, ipLabel: known?.label ?? null, ipTrusted: Boolean(known?.trusted) };
        }),
      );
      return { ...page, events };
    },
  );
}

function createdTarget(rule: Rule, body: Record<string, unknown> | undefined, response: unknown) {
  const answer = (response ?? {}) as { id?: unknown; name?: unknown; organizations?: { id: string; name: string }[] };
  if (rule.target === 'organization') {
    const name = typeof body?.name === 'string' ? body.name.trim() : undefined;
    const made = [...(answer.organizations ?? [])].reverse().find(org => org.name === name);
    return { id: made?.id, name: made?.name ?? name };
  }
  return {
    id: typeof answer.id === 'string' ? answer.id : undefined,
    name: typeof answer.name === 'string' ? answer.name : typeof body?.name === 'string' ? body.name : undefined,
  };
}

/** When the request arrived (not when the answer went out): the moment the event happened. */
export const arrived = (reply: FastifyReply) => new Date(Date.now() - reply.elapsedTime);
