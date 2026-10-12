import { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { PlatformStore } from './platform-store';
import type { BlobStore } from './files/blob-store';
import type { DiscordTokenStore } from './discord/token-store';
import type { DiscordConnections } from './discord/connections';
import type { Connections } from './users/connections';
import type { AgentTimers } from './agent-timers';
import { ArchiveError, OpenedArchive } from './agent-archive';
import { DEFAULT_INCLUDES, exportAgent, type ExportIncludes } from './agent-export';
import { importAgent } from './agent-import';
import { agentProblems, removeUnresolved } from './agent-review';

/** The largest agent file accepted (compressed), and what it may unpack to. */
export const IMPORT_LIMITS = { compressed: 4 * 1024 ** 3, unpacked: 16 * 1024 ** 3 };
const PARTS = Object.keys(DEFAULT_INCLUDES) as (keyof ExportIncludes)[];
const error = Type.Object({ message: Type.String() });
const params = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) });
const Problem = Type.Object({
  section: Type.Union([Type.Literal('model'), Type.Literal('links'), Type.Literal('discord')]),
  row: Type.Optional(Type.Integer()),
  kind: Type.Optional(Type.Union([Type.Literal('computers'), Type.Literal('dmPeers'), Type.Literal('groups')])),
  id: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  message: Type.String(),
});
const Review = Type.Object({ paused: Type.Boolean(), problems: Type.Array(Problem) });

/** A file name from an agent's name ("Lobbify CTO" → "Lobbify-CTO.swarm-agent"). */
const fileName = (name: string) =>
  `${
    name
      .trim()
      .replace(/[\\/:*?"<>|\s]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'agent'
  }.swarm-agent`;

/**
 * Agents as files (docs/agent-export.md): export (everything by default; the bot token only when asked), import (a
 * new, paused agent in an organization), what needs fixing, removing a link that does not exist here, and resuming.
 */
export function registerAgentTransferRoutes(
  app: FastifyInstance,
  database: PlatformStore,
  blobs: BlobStore,
  tokens: DiscordTokenStore,
  connections: Connections,
  timers: AgentTimers,
  /** The dashboard's view of an agent (chat.ts), returned for the imported one. */
  view: { schema: TSchema; of: (agentId: string) => Promise<unknown> },
  discord?: DiscordConnections,
) {
  app.get<{ Params: Static<typeof params>; Querystring: { parts?: string } }>(
    '/api/agents/:id/export',
    {
      schema: {
        operationId: 'exportAgent',
        params,
        // Comma-separated parts to include (default: everything but the Discord bot token).
        querystring: Type.Object(
          { parts: Type.Optional(Type.String({ maxLength: 200 })) },
          { additionalProperties: false },
        ),
        response: { 404: error },
      },
    },
    async (request, reply) => {
      const chosen = request.query.parts?.split(',').filter(Boolean);
      const includes = Object.fromEntries(
        PARTS.map(part => [part, chosen ? chosen.includes(part) : DEFAULT_INCLUDES[part]]),
      ) as ExportIncludes;
      const exported = await exportAgent(database, blobs, tokens, request.params.id, includes);
      if (!exported) return reply.code(404).send({ message: 'Agent not found.' });
      request.audit && (request.audit.targetName = exported.name);
      const name = fileName(exported.name);
      return reply
        .header('Cache-Control', 'no-store')
        .header('Content-Type', 'application/gzip')
        .header('Content-Disposition', `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`)
        .send(Readable.from(exported.tar).pipe(createGzip()));
    },
  );

  // The file streams as the raw request body.
  void app.register(async scoped => {
    scoped.removeAllContentTypeParsers();
    scoped.addContentTypeParser('*', (_request, payload, done) => done(null, payload));
    scoped.post<{ Querystring: { organizationId: string } }>(
      '/api/agents/import',
      {
        schema: {
          operationId: 'importAgent',
          querystring: Type.Object(
            { organizationId: Type.String({ minLength: 1, maxLength: 64 }) },
            { additionalProperties: false },
          ),
          response: {
            201: Type.Object({
              agent: view.schema,
              skipped: Type.Object({ dms: Type.Integer(), links: Type.Integer() }),
            }),
            400: error,
            404: error,
          },
        },
      },
      async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        await database.initialize();
        const organization = await database.client.organization.findUnique({
          where: { id: request.query.organizationId },
        });
        if (!organization) return reply.code(404).send({ message: 'Organization not found.' });
        let archive: OpenedArchive | undefined;
        try {
          archive = await OpenedArchive.open(
            request.body as AsyncIterable<Uint8Array>,
            IMPORT_LIMITS.compressed,
            IMPORT_LIMITS.unpacked,
          );
          const { agentId, skipped } = await importAgent(database, blobs, tokens, archive, organization.id);
          const agent = await database.client.agent.findUniqueOrThrow({
            where: { id: agentId },
            select: { name: true },
          });
          if (request.audit) request.audit.targetName = agent.name;
          return reply.code(201).send({ agent: await view.of(agentId), skipped });
        } catch (caught) {
          if (caught instanceof ArchiveError) return reply.code(400).send({ message: caught.message });
          throw caught;
        } finally {
          await archive?.close();
        }
      },
    );
  });

  app.get<{ Params: Static<typeof params> }>(
    '/api/agents/:id/review',
    { schema: { operationId: 'reviewAgent', params, response: { 200: Review } } },
    async request => {
      await database.initialize();
      return agentProblems(database, connections, tokens, request.params.id);
    },
  );

  app.post<{ Params: Static<typeof params>; Body: { kind: 'computers' | 'dmPeers' | 'groups'; id: string } }>(
    '/api/agents/:id/review/remove',
    {
      schema: {
        operationId: 'removeUnresolvedLink',
        params,
        body: Type.Object(
          {
            kind: Type.Union([Type.Literal('computers'), Type.Literal('dmPeers'), Type.Literal('groups')]),
            id: Type.String({ minLength: 1, maxLength: 64 }),
          },
          { additionalProperties: false },
        ),
        response: { 200: Review, 404: error },
      },
    },
    async (request, reply) => {
      await database.initialize();
      if (!(await removeUnresolved(database, request.params.id, request.body.kind, request.body.id)))
        return reply.code(404).send({ message: 'That link is not listed.' });
      return agentProblems(database, connections, tokens, request.params.id);
    },
  );

  app.post<{ Params: Static<typeof params> }>(
    '/api/agents/:id/resume',
    {
      schema: {
        operationId: 'resumeAgent',
        params,
        body: Type.Optional(Type.Object({}, { additionalProperties: false })),
        response: { 200: Review, 409: Type.Object({ message: Type.String(), problems: Type.Array(Problem) }) },
      },
    },
    async (request, reply) => {
      await database.initialize();
      const review = await agentProblems(database, connections, tokens, request.params.id);
      if (review.problems.length)
        return reply.code(409).send({ message: 'Fix the settings shown in red first.', problems: review.problems });
      await database.client.agent.update({ where: { id: request.params.id }, data: { paused: false } });
      // What waited while it was paused: its timers' firings, and its Discord bot.
      void timers.redeliver(request.params.id).catch(() => {});
      if (discord && (await tokens.get(request.params.id))) void discord.restart(request.params.id);
      return { paused: false, problems: [] };
    },
  );
}
