import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Reach, viewerOf, type Viewer } from './reach';

/**
 * Who may call each route (docs/users.md#enforcement). Admin passes everywhere; for a user the route's rule decides,
 * and a route without a rule is refused. Things a user cannot reach answer 404, like things that do not exist.
 *
 * - 'signed-in': any signed-in person (the handler shows only their own, where it shows anything personal);
 * - 'admin': admin only;
 * - 'scoped': the handler scopes what it lists or creates to the person's organizations;
 * - a param check: the agent, computer, group, channel, file or organization the route names;
 * - a function: a check on the query or body.
 */
type Check = (request: FastifyRequest, reach: Reach, viewer: Viewer) => Promise<boolean>;
type Rule =
  | 'public'
  | 'signed-in'
  | 'admin'
  | 'scoped'
  | { agent: string }
  | { computer: string }
  | { group: string }
  | { channel: string }
  | { file: string }
  | { organization: string }
  | Check;

const param = (request: FastifyRequest, name: string) => (request.params as Record<string, string>)[name];
const query = (request: FastifyRequest, name: string) => (request.query as Record<string, string> | undefined)?.[name];
const body = (request: FastifyRequest) => (request.body ?? {}) as Record<string, unknown>;
const agent = { agent: 'id' },
  computer = { computer: 'id' },
  group = { group: 'id' };
const channelKey: Check = (request, reach, viewer) => reach.channel(viewer, query(request, 'channelKey'));

export const RULES: Record<string, Rule> = {
  'GET /api/health': 'public',
  'GET /api/auth/session': 'public',
  'POST /api/auth/setup': 'public',
  'POST /api/auth/login': 'public',
  'POST /api/auth/logout': 'public',
  'POST /api/auth/password': 'signed-in',
  // Caddy's desktop check: the handler checks the computer in the forwarded path.
  'GET /api/auth/check': 'signed-in',

  'GET /api/users': 'admin',
  'POST /api/users': 'admin',
  'PATCH /api/users/:id': 'admin',
  'DELETE /api/users/:id': 'admin',

  'GET /api/audit': 'admin',
  'GET /api/access': 'admin',
  'GET /api/alerts': 'admin',
  'POST /api/alerts/:id/dismiss': 'admin',
  'GET /api/security': 'admin',
  'POST /api/security/addresses': 'admin',
  'PATCH /api/security/addresses/:id': 'admin',
  'DELETE /api/security/addresses/:id': 'admin',
  'POST /api/security/unlock': 'admin',
  'GET /api/settings/swarm': 'admin',
  'PATCH /api/settings/swarm': 'admin',
  'GET /api/computer-storage': 'admin',
  'PUT /api/computer-storage': 'admin',

  // A person's own connections and accounts.
  'GET /api/model-endpoints': 'signed-in',
  'POST /api/model-endpoints': 'signed-in',
  'POST /api/model-endpoints/test': 'signed-in',
  'DELETE /api/model-endpoints/:id': 'signed-in',
  'GET /api/providers/openai-codex': 'signed-in',
  'DELETE /api/providers/openai-codex': 'signed-in',
  'POST /api/providers/openai-codex/login': 'signed-in',
  'DELETE /api/providers/openai-codex/login': 'signed-in',
  'GET /api/discord/owner': 'signed-in',
  'PUT /api/discord/owner': 'signed-in',
  'GET /api/knowledge': 'signed-in',
  'GET /api/knowledge/search': 'signed-in',
  'GET /api/knowledge/entry': 'signed-in',
  'GET /api/dashboard/live': 'signed-in',
  'GET /api/dashboard/live/stream': 'signed-in',
  'GET /api/computers/settings-limits': 'signed-in',
  // Filtered per person (run-streams.ts).
  'GET /api/events': 'signed-in',

  'GET /api/organizations': 'scoped',
  'POST /api/organizations': 'signed-in',
  'PATCH /api/organizations/:id': { organization: 'id' },
  'DELETE /api/organizations/:id': { organization: 'id' },
  'POST /api/organizations/:id/move': async (request, reach, viewer) => {
    const { kind, id } = body(request);
    const reachable =
      kind === 'agent'
        ? reach.agent(viewer, String(id))
        : kind === 'computer'
          ? reach.computer(viewer, String(id))
          : kind === 'group'
            ? reach.group(viewer, String(id))
            : false;
    return (await reach.organization(viewer, param(request, 'id'))) && (await reachable);
  },

  'GET /api/dashboard': 'scoped',
  'GET /api/agents': 'scoped',
  'POST /api/agents': 'scoped',
  'GET /api/agents/model-capabilities': 'scoped',
  'PATCH /api/agents/:id': agent,
  'DELETE /api/agents/:id': agent,
  'POST /api/agents/:id/stop': agent,
  'GET /api/agents/:id/activity': agent,
  'GET /api/agents/:id/activity/entry': agent,
  'GET /api/agents/:id/scratch': agent,
  'GET /api/agents/:id/scratch/file': agent,
  'GET /api/agents/:id/scratch/image': agent,
  'GET /api/agents/:id/screenshots/:imageId': agent,
  'GET /api/agents/:id/settings': agent,
  'PATCH /api/agents/:id/settings': agent,
  'GET /api/agents/:id/memory': agent,
  'DELETE /api/agents/:id/memory': agent,
  'POST /api/agents/:id/memory/sleep': agent,
  'PUT /api/agents/:id/memory/sleep-window': agent,
  'PATCH /api/agents/:id/memory/:name': agent,
  'DELETE /api/agents/:id/memory/:name': agent,
  'POST /api/agents/:id/memory/:name/restore': agent,
  'GET /api/agents/:id/memory/:name/versions': agent,
  'GET /api/agents/:id/dm-peers': agent,
  'GET /api/agents/:id/dm-inbox': agent,
  'GET /api/agents/:id/dms/:peerId': agent,
  'GET /api/agents/:id/discord': agent,
  'PATCH /api/agents/:id/discord': agent,
  'PUT /api/agents/:id/discord/token': agent,
  'DELETE /api/agents/:id/discord/token': agent,
  'GET /api/agents/:id/discord/channels/:channelId/messages': agent,
  'GET /api/agents/:id/discord/people': agent,
  'GET /api/agents/:id/computers': agent,
  'PUT /api/agents/:id/computers': agent,
  'POST /api/chat': (request, reach, viewer) => reach.agent(viewer, String(body(request).agentId ?? '')),
  'GET /api/channels/:channelId/messages': { channel: 'channelId' },
  'GET /api/chats/:channelId/reactions': { channel: 'channelId' },
  'PUT /api/chats/:channelId/messages/:messageId/reaction': { channel: 'channelId' },

  'GET /api/groups': 'scoped',
  'POST /api/groups': 'scoped',
  'GET /api/groups/:id': group,
  'PATCH /api/groups/:id': group,
  'DELETE /api/groups/:id': group,
  'GET /api/groups/:id/messages': group,
  'POST /api/groups/:id/messages': group,

  'GET /api/files': channelKey,
  'POST /api/files': channelKey,
  'GET /api/files/find': 'scoped',
  'DELETE /api/files/:id': { file: 'id' },
  'GET /api/files/:id/content': { file: 'id' },
  'GET /api/files/:id/text': { file: 'id' },

  'GET /api/computers': 'scoped',
  'POST /api/computers': 'scoped',
  'GET /api/computers/control': 'scoped',
  'DELETE /api/computers/:id': computer,
  'GET /api/computers/:id/files': computer,
  'GET /api/computers/:id/file-preview': computer,
  'GET /api/computers/:id/download': computer,
  'POST /api/computers/:id/desktop/input': computer,
  'POST /api/computers/:id/power': computer,
  'GET /api/computers/:id/preview': computer,
  'PATCH /api/computers/:id/settings': computer,
  'POST /api/computers/:id/settings/replacement': computer,
  'GET /api/computers/:id/storage': computer,
  'POST /api/computers/:id/cache/clear': computer,
  'POST /api/computers/:id/terminals': computer,
  'GET /api/computers/:id/terminals/:session/stream': computer,
  'POST /api/computers/:id/recordings/stop': computer,
  'POST /api/computers/:id/release': computer,
};

async function allowed(rule: Rule, request: FastifyRequest, reach: Reach, viewer: Viewer) {
  if (typeof rule === 'function') return rule(request, reach, viewer);
  if (rule === 'admin') return false;
  if (typeof rule === 'string') return true;
  if ('agent' in rule) return reach.agent(viewer, param(request, rule.agent));
  if ('computer' in rule) return reach.computer(viewer, param(request, rule.computer));
  if ('group' in rule) return reach.group(viewer, param(request, rule.group));
  if ('channel' in rule) return reach.channel(viewer, param(request, rule.channel));
  if ('file' in rule) return reach.file(viewer, param(request, rule.file) ?? '');
  return reach.organization(viewer, param(request, rule.organization));
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Routes added without a rule (refused for users): a test keeps this empty. */
    unruledRoutes: string[];
  }
}

/** Applies RULES to every request (after sign-in, so a user is known), before the route's own checks. */
export function registerRules(app: FastifyInstance, reach: Reach) {
  const unruled: string[] = [];
  app.decorate('unruledRoutes', unruled);
  app.addHook('onRoute', route => {
    if (!route.url.startsWith('/api/')) return;
    for (const method of [route.method].flat())
      if (method !== 'HEAD' && !RULES[`${method} ${route.url}`]) unruled.push(`${method} ${route.url}`);
  });
  // At preValidation (the body is parsed, not yet validated): before any route's own checks, which could otherwise
  // tell whether something of another organization exists.
  app.addHook('preValidation', async (request, reply) => {
    const url = request.routeOptions.url;
    if (!url?.startsWith('/api/')) return;
    const viewer = viewerOf(request);
    if (viewer.admin) return;
    const method = request.method === 'HEAD' ? 'GET' : request.method;
    const rule = RULES[`${method} ${url}`];
    if (!rule || !(await allowed(rule, request, reach, viewer)))
      return reply
        .code(rule === 'admin' ? 403 : 404)
        .send({ message: rule === 'admin' ? 'Admin only.' : 'Not found.' });
  });
}
