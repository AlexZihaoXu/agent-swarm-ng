import type { FastifyInstance } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import type { PlatformStore } from '../platform-store';
import { AvatarSchema } from '../agent-avatar';
import { parseChannelKey } from '../files/access';
import { platformZone } from '../time-notes';
import { viewerOf, type Viewer } from '../users/reach';
import {
  COUNT_CAP,
  MAX_PAGE,
  MessageSearch,
  PAGE_SIZE,
  dayStart,
  ftsQuery,
  snippetOf,
  type Kind,
  type Scope,
} from './store';

const Day = Type.String({ pattern: '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$', description: 'YYYY-MM-DD' });
const Query = Type.Object(
  {
    q: Type.Optional(Type.String({ maxLength: 200 })),
    /** One conversation (`chat:<channelId>`, `group:<id>`, `dm:<agentId>:<agentId>`), else all the person reaches. */
    conversation: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    /** With no conversation: only this organization (the dashboard's current one). */
    organizationId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    /** `you` (written by people) or `agent:<id>`. */
    from: Type.Optional(Type.String({ pattern: '^(you|agent:[^\\s]{1,64})$' })),
    /** Comma-separated: file, image, link. */
    has: Type.Optional(Type.String({ pattern: '^(file|image|link)(,(file|image|link)){0,2}$' })),
    /** Calendar days in the person's time zone (Settings → Account). */
    before: Type.Optional(Day),
    after: Type.Optional(Day),
    during: Type.Optional(Day),
    sort: Type.Optional(Type.Union([Type.Literal('newest'), Type.Literal('oldest')])),
    page: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_PAGE })),
  },
  { additionalProperties: false },
);
const Range = Type.Object({ start: Type.Integer(), end: Type.Integer() });
const Result = Type.Object({
  id: Type.String(),
  kind: Type.Union([Type.Literal('chat'), Type.Literal('group'), Type.Literal('dm')]),
  sequence: Type.Integer(),
  timestamp: Type.Number(),
  conversation: Type.Object({
    /** The conversation's key, as `conversation` takes it. */
    key: Type.String(),
    name: Type.String(),
    /** chat: the agent; dm: one of the two agents (the other is peerId). */
    agentId: Type.Optional(Type.String()),
    peerId: Type.Optional(Type.String()),
    groupId: Type.Optional(Type.String()),
  }),
  author: Type.Object({
    kind: Type.Union([Type.Literal('human'), Type.Literal('agent')]),
    /** An agent's id; null for people. */
    id: Type.Union([Type.String(), Type.Null()]),
    /** A person's name may be null on older messages (the organization's owner). */
    name: Type.Union([Type.String(), Type.Null()]),
    avatar: Type.Union([AvatarSchema, Type.Null()]),
  }),
  snippet: Type.Object({
    text: Type.String(),
    /** Matched words in `text` (UTF-16 offsets). */
    ranges: Type.Array(Range),
    clippedStart: Type.Boolean(),
    clippedEnd: Type.Boolean(),
  }),
  files: Type.Array(Type.Object({ id: Type.String(), name: Type.String(), kind: Type.String() })),
});
const Response = Type.Object({
  /** Matches, counted up to 1001: `more` says there are over 1000. */
  total: Type.Integer(),
  more: Type.Boolean(),
  page: Type.Integer(),
  pageSize: Type.Integer(),
  results: Type.Array(Result),
});
const ErrorResponse = Type.Object({ message: Type.String() });
type SearchResult = Static<typeof Result>;

const avatarOf = (json: string | null | undefined) => (json ? JSON.parse(json) : null);

export function registerSearchRoutes(app: FastifyInstance, platform: PlatformStore) {
  const search = new MessageSearch(platform);
  // Keep the triggers' queue short while nobody searches (each search applies it too).
  const timer = setInterval(
    () => void search.sync().catch(error => app.log.warn({ err: error }, 'Could not update the message search index')),
    10 * 60_000,
  );
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));

  /** What the request may read: its conversation (checked again here, beyond the route rule) or organizations. */
  async function scopeOf(viewer: Viewer, query: Static<typeof Query>): Promise<Scope | null> {
    const reach = app.reach;
    if (query.conversation) {
      const key = parseChannelKey(query.conversation);
      if (!key || !(await reach.channel(viewer, query.conversation))) return null;
      if (key.kind === 'chat') {
        const channel = await platform.client.channel.findUnique({
          where: { id: key.channelId },
          select: { id: true },
        });
        return channel ? { conversation: { kind: 'chat', channelId: key.channelId } } : null;
      }
      if (key.kind === 'group') {
        const group = await platform.client.groupChat.findUnique({ where: { id: key.groupId }, select: { id: true } });
        return group ? { conversation: { kind: 'group', groupId: key.groupId } } : null;
      }
      // An agent↔agent DM, read-only in the dashboard: both agents must still exist and be the person's.
      if (key.kind === 'dm') {
        const agents = await platform.client.agent.count({ where: { id: { in: [key.a, key.b] } } });
        return agents === 2 ? { conversation: { kind: 'dm', key: query.conversation } } : null;
      }
      return null; // Discord is not searched here.
    }
    const reachable = await reach.organizations(viewer);
    if (query.organizationId) {
      if (!(await reach.organization(viewer, query.organizationId))) return null;
      return { organizations: [query.organizationId] };
    }
    return { organizations: reachable };
  }

  app.get<{ Querystring: Static<typeof Query> }>(
    '/api/search/messages',
    {
      schema: {
        operationId: 'searchMessages',
        querystring: Query,
        response: { 200: Response, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      await platform.initialize();
      const viewer = viewerOf(request);
      const query = request.query;
      const scope = await scopeOf(viewer, query);
      if (!scope) return reply.code(404).send({ message: 'Conversation not found.' });
      const has = query.has ? ([...new Set(query.has.split(','))] as ('file' | 'image' | 'link')[]) : [];
      if (!query.q?.trim() && !query.from && !has.length && !query.before && !query.after && !query.during)
        return reply.code(400).send({ message: 'Type something to search for, or choose a filter.' });
      // Days are the person's own (docs/users.md#time-zone), else the platform's.
      const user = await platform.client.user.findUnique({ where: { id: viewer.userId }, select: { timeZone: true } });
      const zone = user?.timeZone || platformZone();
      const nextDay = (day: string) => {
        const [year, month, date] = day.split('-').map(Number);
        return dayStart(new Date(Date.UTC(year!, month! - 1, date! + 1)).toISOString().slice(0, 10), zone);
      };
      const bounds: Date[][] = [[], []];
      if (query.during) (bounds[0].push(dayStart(query.during, zone)), bounds[1].push(nextDay(query.during)));
      if (query.after) bounds[0].push(nextDay(query.after));
      if (query.before) bounds[1].push(dayStart(query.before, zone));
      const since = bounds[0].length ? new Date(Math.max(...bounds[0].map(Number))) : undefined;
      const until = bounds[1].length ? new Date(Math.min(...bounds[1].map(Number))) : undefined;
      const page = query.page ?? 1;
      // Across all chats, a search must use the index: a term of 3+ characters (short terms and has:link alone would
      // read every message the person can see, and a query holds up the single backend while it runs).
      const parsed = query.q?.trim() ? ftsQuery(query.q) : null;
      if (!('conversation' in scope) && !parsed?.match && (parsed?.likes.length || has?.includes('link')))
        return reply.code(400).send({ message: 'To search all chats, type at least 3 characters.' });
      const found = await search.search(scope, {
        text: query.q,
        from:
          query.from === 'you'
            ? { kind: 'people' }
            : query.from
              ? { kind: 'agent', id: query.from.slice(6) }
              : undefined,
        has,
        since,
        until,
        sort: query.sort ?? 'newest',
        page,
      });
      return {
        total: Math.min(found.total, COUNT_CAP),
        more: found.total > COUNT_CAP,
        page,
        pageSize: PAGE_SIZE,
        results: await details(found.hits, found.terms),
      };
    },
  );

  /** The found messages as cards, in the order found. */
  async function details(hits: { kind: Kind; sequence: number }[], terms: string[]) {
    const of = (kind: Kind) => hits.filter(hit => hit.kind === kind).map(hit => hit.sequence);
    const client = platform.client;
    const [chats, groups, dms] = await Promise.all([
      of('chat').length
        ? client.message.findMany({
            where: { sequence: { in: of('chat') } },
            include: { channel: { select: { agent: { select: { id: true, name: true, avatar: true } } } } },
          })
        : [],
      of('group').length
        ? client.groupMessage.findMany({
            where: { sequence: { in: of('group') } },
            include: { group: { select: { name: true } } },
          })
        : [],
      of('dm').length
        ? client.dmMessage.findMany({
            where: { sequence: { in: of('dm') } },
            include: {
              sender: { select: { id: true, name: true, avatar: true } },
              recipient: { select: { id: true, name: true, avatar: true } },
            },
          })
        : [],
    ]);
    const files = await client.channelFile.findMany({
      where: {
        status: 'available',
        OR: [
          { messageKind: 'chat', messageId: { in: chats.map(row => row.id) } },
          { messageKind: 'group', messageId: { in: groups.map(row => row.id) } },
          { messageKind: 'dm', messageId: { in: dms.map(row => row.id) } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, kind: true, messageKind: true, messageId: true },
    });
    const filesOf = (kind: Kind, id: string) =>
      files
        .filter(file => file.messageKind === kind && file.messageId === id)
        .map(({ id, name, kind }) => ({ id, name, kind }));
    const cards = new Map<string, SearchResult>();
    const snippet = (_kind: Kind, _sequence: number, text: string) => snippetOf(text, terms);
    for (const row of chats) {
      const agent = row.channel.agent;
      cards.set(`chat:${row.sequence}`, {
        id: row.id,
        kind: 'chat',
        sequence: row.sequence,
        timestamp: row.createdAt.getTime(),
        conversation: { key: `chat:${row.channelId}`, name: agent.name, agentId: agent.id },
        author:
          row.role === 'user'
            ? { kind: 'human', id: null, name: row.authorName, avatar: null }
            : { kind: 'agent', id: agent.id, name: agent.name, avatar: avatarOf(agent.avatar) },
        snippet: snippet('chat', row.sequence, row.text),
        files: filesOf('chat', row.id),
      });
    }
    for (const row of groups)
      cards.set(`group:${row.sequence}`, {
        id: row.id,
        kind: 'group',
        sequence: row.sequence,
        timestamp: row.createdAt.getTime(),
        conversation: { key: `group:${row.groupId}`, name: row.group.name, groupId: row.groupId },
        author:
          row.role === 'user'
            ? { kind: 'human', id: null, name: row.authorName, avatar: null }
            : { kind: 'agent', id: row.authorId, name: row.authorName, avatar: avatarOf(row.authorAvatar) },
        snippet: snippet('group', row.sequence, row.text),
        files: filesOf('group', row.id),
      });
    for (const row of dms)
      cards.set(`dm:${row.sequence}`, {
        id: row.id,
        kind: 'dm',
        sequence: row.sequence,
        timestamp: row.createdAt.getTime(),
        conversation: {
          key: row.conversationId,
          name: `${row.sender.name} and ${row.recipient.name}`,
          agentId: row.senderId,
          peerId: row.recipientId,
        },
        author: { kind: 'agent', id: row.sender.id, name: row.sender.name, avatar: avatarOf(row.sender.avatar) },
        snippet: snippet('dm', row.sequence, row.text),
        files: filesOf('dm', row.id),
      });
    return hits.flatMap(hit => cards.get(`${hit.kind}:${hit.sequence}`) ?? []);
  }
}
