import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PlatformStore } from './platform-store';
import { ScratchError, type Scratchpad } from './scratchpad';
import { TextError } from './text-page';

const error = Type.Object({ message: Type.String() });
const usage = Type.Object({
  files: Type.Integer(),
  bytes: Type.Integer(),
  maxFiles: Type.Integer(),
  maxBytes: Type.Integer(),
  maxFileBytes: Type.Integer(),
});
const listing = Type.Object({
  folder: Type.String(),
  folders: Type.Array(
    Type.Object({ name: Type.String(), path: Type.String(), files: Type.Integer(), size: Type.Integer() }),
  ),
  files: Type.Array(
    Type.Object({
      name: Type.String(),
      path: Type.String(),
      kind: Type.Union([Type.Literal('text'), Type.Literal('image')]),
      size: Type.Integer(),
      updatedAt: Type.String(),
    }),
  ),
  usage,
});
const page = Type.Object({
  path: Type.String(),
  size: Type.Integer(),
  updatedAt: Type.String(),
  text: Type.String(),
  offset: Type.Integer(),
  lines: Type.Integer(),
  totalLines: Type.Integer(),
  truncated: Type.Boolean(),
  partialLine: Type.Boolean(),
  nextOffset: Type.Union([Type.Integer(), Type.Null()]),
  prevOffset: Type.Union([Type.Integer(), Type.Null()]),
});
const params = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) });

/**
 * The human's read-only view of an agent's scratchpad (Agents → agent → Scratchpad). The human changes files only
 * by asking the agent; there is no write route. Trusted dashboard surface.
 */
export function registerScratchRoutes(app: FastifyInstance, database: PlatformStore, pad: Scratchpad) {
  const guard = async (reply: FastifyReply, agentId: string, work: () => Promise<unknown>) => {
    reply.header('Cache-Control', 'no-store');
    if (!(await database.hasAgent(agentId))) return reply.code(404).send({ message: 'Agent not found.' });
    try {
      return await work();
    } catch (caught) {
      if (caught instanceof ScratchError || caught instanceof TextError)
        return reply.code(/no (file|folder)/.test(caught.message) ? 404 : 400).send({ message: caught.message });
      throw caught;
    }
  };
  app.get<{ Params: { id: string }; Querystring: { folder?: string } }>(
    '/api/agents/:id/scratch',
    {
      schema: {
        operationId: 'listScratch',
        params,
        querystring: Type.Object(
          { folder: Type.Optional(Type.String({ maxLength: 263 })) },
          { additionalProperties: false },
        ),
        response: { 200: listing, 400: error, 404: error },
      },
    },
    (request, reply) => guard(reply, request.params.id, () => pad.list(request.params.id, request.query.folder ?? '')),
  );
  app.get<{ Params: { id: string }; Querystring: { path: string; offset?: number; limit?: number } }>(
    '/api/agents/:id/scratch/file',
    {
      schema: {
        operationId: 'readScratchFile',
        params,
        querystring: Type.Object(
          {
            path: Type.String({ minLength: 1, maxLength: 263 }),
            offset: Type.Optional(Type.Integer({ minimum: 1 })),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
          },
          { additionalProperties: false },
        ),
        response: { 200: page, 400: error, 404: error },
      },
    },
    (request, reply) =>
      guard(reply, request.params.id, () =>
        pad.read(request.params.id, request.query.path, request.query.offset, request.query.limit),
      ),
  );
  // An image file's bytes, for the preview. Served as the stored image type only, never as a document.
  app.get<{ Params: { id: string }; Querystring: { path: string } }>(
    '/api/agents/:id/scratch/image',
    {
      schema: {
        operationId: 'scratchImage',
        params,
        querystring: Type.Object(
          { path: Type.String({ minLength: 1, maxLength: 263 }) },
          { additionalProperties: false },
        ),
        response: { 400: error, 404: error },
      },
    },
    (request, reply) =>
      guard(reply, request.params.id, async () => {
        const row = await pad.content(request.params.id, request.query.path);
        if (!row.mime || !row.data) throw new ScratchError(`"${row.path}" is not an image.`);
        return reply
          .header('Content-Type', row.mime)
          .header('X-Content-Type-Options', 'nosniff')
          .header('Content-Security-Policy', "default-src 'none'")
          .send(Buffer.from(row.data));
      }),
  );
}
