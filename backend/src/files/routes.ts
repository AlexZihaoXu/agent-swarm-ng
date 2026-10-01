import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { open } from 'node:fs/promises';
import { pageText } from '../text-page';
import { FileError, type FileStore, type FileView } from './store';
import { channelAccess } from './access';
import type { PlatformStore } from '../platform-store';
import type { Scratchpad } from '../scratchpad';

const Uploader = Type.Object({
  kind: Type.Union([Type.Literal('human'), Type.Literal('agent'), Type.Literal('discord')]),
  id: Type.Union([Type.String(), Type.Null()]),
  name: Type.String(),
});
/** A file as the dashboard shows it (also embedded in messages). */
export const FileSchema = Type.Object({
  id: Type.String(),
  channelKey: Type.String(),
  name: Type.String(),
  mime: Type.String(),
  kind: Type.Union([
    Type.Literal('image'),
    Type.Literal('video'),
    Type.Literal('text'),
    Type.Literal('pdf'),
    Type.Literal('other'),
    Type.Literal('scratch'),
  ]),
  size: Type.Integer(),
  status: Type.Union([Type.Literal('available'), Type.Literal('deleted')]),
  uploader: Uploader,
  messageKind: Type.Union([Type.Literal('chat'), Type.Literal('dm'), Type.Literal('group'), Type.Null()]),
  messageId: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  deleted: Type.Optional(Type.Object({ by: Uploader, at: Type.Union([Type.String(), Type.Null()]) })),
  /** A live scratch preview: the presenting agent's scratch file, read as it is now. */
  scratch: Type.Optional(Type.Object({ agentId: Type.String(), path: Type.String() })),
});
const Usage = Type.Object({
  bytes: Type.Integer(),
  budgetBytes: Type.Integer(),
  files: Type.Integer(),
  maxFileBytes: Type.Integer(),
  warning: Type.Boolean(),
  full: Type.Boolean(),
});
const error = Type.Object({ message: Type.String() });
const errors = { 400: error, 403: error, 404: error, 409: error, 410: error, 413: error, 507: error };
const ChannelKey = Type.String({ minLength: 3, maxLength: 200 });
/** Images shown inline; everything else downloads (never rendered by the browser). */
const INLINE = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);
/** One `bytes=` range of a file of `size` bytes (inclusive end), null when unusable, 'unsatisfiable' when outside it. */
function byteRange(header: string | undefined, size: number) {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match || (!match[1] && !match[2])) return null;
  let start: number, end: number;
  if (!match[1]) {
    // The last N bytes.
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return 'unsatisfiable' as const;
  return { start, end };
}
/** How much of a text file the dashboard preview reads. */
export const PREVIEW_BYTES = 1024 * 1024;

const contentDisposition = (kind: 'inline' | 'attachment', name: string) =>
  `${kind}; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/**
 * The human's file API for chats (trusted dashboard surface): upload into a channel, list a channel's files,
 * open/preview/download one, delete one (a tombstone stays). Agents use their own tools, not these routes.
 */
export function registerFileRoutes(
  app: FastifyInstance,
  database: PlatformStore,
  files: FileStore,
  scratch: Scratchpad,
) {
  /** A scratch preview's current text, or the reply already sent when the file is gone from the scratchpad. */
  const liveScratch = async (reply: FastifyReply, view: FileView) => {
    try {
      return (await scratch.content(view.scratch!.agentId, view.scratch!.path)).content;
    } catch {
      reply.code(410).send({ message: `"${view.name}" is no longer in the scratchpad.` });
      return null;
    }
  };
  const human = { kind: 'human' as const };
  const fail = (reply: FastifyReply, caught: unknown) => {
    if (caught instanceof FileError) return reply.code(caught.status).send({ message: caught.message });
    throw caught;
  };
  /** A file the human may see, or the reply already sent. */
  const visible = async (reply: FastifyReply, id: string) => {
    const found = await files.get(id);
    if (!found || !(await channelAccess(database, found.view.channelKey, human)).view) {
      reply.code(404).send({ message: 'No such file.' });
      return null;
    }
    return found;
  };

  // Uploads stream as the raw request body (any content type), never buffered or parsed.
  void app.register(async scoped => {
    scoped.removeAllContentTypeParsers();
    scoped.addContentTypeParser('*', (_request, payload, done) => done(null, payload));
    scoped.post<{ Querystring: { channelKey: string; name: string } }>(
      '/api/files',
      {
        schema: {
          operationId: 'uploadFile',
          querystring: Type.Object(
            { channelKey: ChannelKey, name: Type.String({ minLength: 1, maxLength: 1024 }) },
            { additionalProperties: false },
          ),
          response: { 201: FileSchema, ...errors },
        },
      },
      async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        try {
          const view = await files.add({
            channelKey: request.query.channelKey,
            uploader: human,
            name: request.query.name,
            source: request.body as AsyncIterable<Uint8Array>,
          });
          return reply.code(201).send(view);
        } catch (caught) {
          return fail(reply, caught);
        }
      },
    );
  });

  app.get<{
    Querystring: {
      channelKey: string;
      query?: string;
      sort?: 'date' | 'name' | 'size' | 'type';
      order?: 'asc' | 'desc';
    };
  }>(
    '/api/files',
    {
      schema: {
        operationId: 'listChannelFiles',
        querystring: Type.Object(
          {
            channelKey: ChannelKey,
            query: Type.Optional(Type.String({ maxLength: 200 })),
            sort: Type.Optional(
              Type.Union([Type.Literal('date'), Type.Literal('name'), Type.Literal('size'), Type.Literal('type')]),
            ),
            order: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')])),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ files: Type.Array(FileSchema), totalBytes: Type.Integer(), usage: Usage }),
          ...errors,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!(await channelAccess(database, request.query.channelKey, human)).view)
        return reply.code(404).send({ message: 'No such chat.' });
      const { channelKey, ...options } = request.query;
      return { ...(await files.list(channelKey, options)), usage: await files.usage() };
    },
  );

  // Portal (Ctrl/⌘+K): the human finds a file by name in any chat or any agent's scratchpad. Bounded; names only.
  app.get<{ Querystring: { q: string } }>(
    '/api/files/find',
    {
      schema: {
        operationId: 'findFiles',
        querystring: Type.Object({ q: Type.String({ minLength: 1, maxLength: 100 }) }, { additionalProperties: false }),
        response: {
          200: Type.Object({
            files: Type.Array(
              Type.Object({
                id: Type.String(),
                name: Type.String(),
                channelKey: Type.String(),
                kind: Type.String(),
                size: Type.Integer(),
              }),
            ),
            scratch: Type.Array(Type.Object({ agentId: Type.String(), path: Type.String(), size: Type.Integer() })),
          }),
          ...errors,
        },
      },
    },
    async request => {
      const q = request.query.q.trim();
      await database.initialize();
      const [found, scratch] = await Promise.all([
        database.client.channelFile.findMany({
          where: { name: { contains: q }, status: { not: 'deleted' }, messageId: { not: null } },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, name: true, channelKey: true, kind: true, size: true },
        }),
        database.client.scratchFile.findMany({
          where: { path: { contains: q } },
          orderBy: { updatedAt: 'desc' },
          take: 10,
          select: { agentId: true, path: true, size: true },
        }),
      ]);
      return { files: found, scratch };
    },
  );
  app.get<{ Params: { id: string }; Querystring: { download?: '1' } }>(
    '/api/files/:id/content',
    {
      schema: {
        operationId: 'getFileContent',
        params: Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) }),
        querystring: Type.Object({ download: Type.Optional(Type.Literal('1')) }, { additionalProperties: false }),
      },
    },
    async (request, reply) => {
      const found = await visible(reply, request.params.id);
      if (!found) return reply;
      const { view, blobId } = found;
      if (view.status !== 'deleted' && view.scratch) {
        const text = await liveScratch(reply, view);
        if (text === null) return reply;
        return reply
          .header('Content-Type', 'application/octet-stream')
          .header('Content-Disposition', contentDisposition('attachment', view.name))
          .header('X-Content-Type-Options', 'nosniff')
          .header('Cache-Control', 'no-store')
          .header('Content-Security-Policy', "default-src 'none'; sandbox")
          .send(Buffer.from(text));
      }
      if (view.status === 'deleted' || !blobId) return reply.code(410).send({ message: `"${view.name}" was deleted.` });
      const inline = !request.query.download && INLINE.has(view.mime);
      // A file's bytes never change, but it can be deleted: browsers revalidate each time (cheap: 304).
      const etag = `"${blobId}"`;
      reply.header('ETag', etag).header('Cache-Control', 'private, no-cache');
      if (request.headers['if-none-match'] === etag) return reply.code(304).send();
      reply
        .header('Content-Type', inline ? view.mime : 'application/octet-stream')
        .header('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', view.name))
        .header('Accept-Ranges', 'bytes')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "default-src 'none'; sandbox");
      // Players seek by asking for parts of the file (one byte range; a stale If-Range gets the whole file).
      const ifRange = request.headers['if-range'];
      const range = !ifRange || ifRange === etag ? byteRange(request.headers.range, view.size) : null;
      if (range === 'unsatisfiable') return reply.code(416).header('Content-Range', `bytes */${view.size}`).send();
      if (range)
        return reply
          .code(206)
          .header('Content-Range', `bytes ${range.start}-${range.end}/${view.size}`)
          .header('Content-Length', String(range.end - range.start + 1))
          .send(files.blobs.stream(blobId, range));
      return reply.header('Content-Length', String(view.size)).send(files.blobs.stream(blobId));
    },
  );

  app.get<{ Params: { id: string }; Querystring: { offset?: number; limit?: number } }>(
    '/api/files/:id/text',
    {
      schema: {
        operationId: 'previewFileText',
        params: Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) }),
        querystring: Type.Object(
          {
            offset: Type.Optional(Type.Integer({ minimum: 1 })),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            text: Type.String(),
            offset: Type.Integer(),
            lines: Type.Integer(),
            totalLines: Type.Integer(),
            truncated: Type.Boolean(),
            partialLine: Type.Boolean(),
            nextOffset: Type.Union([Type.Integer(), Type.Null()]),
            prevOffset: Type.Union([Type.Integer(), Type.Null()]),
            previewLimited: Type.Boolean(),
          }),
          ...errors,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const found = await visible(reply, request.params.id);
      if (!found) return reply;
      const { view, blobId } = found;
      if (view.status !== 'deleted' && view.scratch) {
        const text = await liveScratch(reply, view);
        if (text === null) return reply;
        return { ...pageText(text, request.query.offset, request.query.limit), previewLimited: false };
      }
      if (view.status === 'deleted' || !blobId) return reply.code(410).send({ message: `"${view.name}" was deleted.` });
      if (view.kind !== 'text') return reply.code(400).send({ message: 'Only text files have a text preview.' });
      // The preview reads at most the first megabyte; the full file downloads.
      const handle = await open(files.blobs.path(blobId), 'r');
      const buffer = Buffer.alloc(PREVIEW_BYTES);
      let read;
      try {
        ({ bytesRead: read } = await handle.read(buffer, 0, PREVIEW_BYTES, 0));
      } finally {
        await handle.close();
      }
      const limited = view.size > PREVIEW_BYTES;
      const text = new TextDecoder().decode(buffer.subarray(0, read));
      return { ...pageText(text, request.query.offset, request.query.limit), previewLimited: limited };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/files/:id',
    {
      schema: {
        operationId: 'deleteFile',
        params: Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) }),
        response: { 200: FileSchema, ...errors },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return await files.delete(request.params.id, human, 'You');
      } catch (caught) {
        return fail(reply, caught);
      }
    },
  );
}
export type { FileView };
