import type { FastifyInstance, FastifyReply } from 'fastify';
import { Readable } from 'node:stream';
import { Type } from '@sinclair/typebox';
import { streamOf, type ComputerController } from './computer-controller-client';
import type { ComputerStore } from './computer-store';
import {
  ComputerFileError,
  computerFilesSchema,
  computerFilePreviewSchema,
  fileAttachment,
  folderResultSchema,
  MAX_UPLOAD_PART,
  parseRange,
  uploadProgressSchema,
  uploadResultSchema,
  type FileQuery,
  type GuestPiece,
  type UploadMode,
} from './computer-files';

const FILE_WAIT_MS = 3000;
/** Uploads and downloads in flight: per computer and overall. Listings and previews have their own, smaller pool. */
const TRANSFERS_PER_COMPUTER = 4;
const TRANSFERS = 12;
const CONFLICT = 'A file with that name already exists.';
/**
 * Downloads are read from the computer in pieces of this size, the next while the browser takes the current one: this
 * runtime reads a whole response into memory as fast as it arrives, so a piece is the most one download holds (two).
 */
const PIECE = 16 * 1024 * 1024;
const SLICE = 1024 * 1024;

const GuestPath = Type.String({ minLength: 1, maxLength: 4096, pattern: '^/[^\\u0000]*$' });
/** One name in the folder being viewed: never a path. */
const GuestName = Type.String({ minLength: 1, maxLength: 255, pattern: '^(?!\\.\\.?$)[^/\\u0000]+$' });
const Params = Type.Object({ id: Type.String({ minLength: 1, maxLength: 80 }) });

/** Trusted operator surface, deliberately independent of agent assignments/claims. */
export function registerComputerFileRoutes(
  app: FastifyInstance,
  store: ComputerStore,
  controller: ComputerController | null,
) {
  const pending = new Set<string>();
  // Browsing fires a listing and a preview back to back; wait briefly for a slot instead of failing the second one.
  const acquire = async (id: string) => {
    const deadline = Date.now() + FILE_WAIT_MS;
    while (pending.has(id) || pending.size >= 2) {
      if (Date.now() >= deadline) return false;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    pending.add(id);
    return true;
  };
  const transfers = new Map<string, number>();
  /** A transfer slot held until the response closes (finished, failed or abandoned by the browser). */
  const transfer = (id: string, reply: FastifyReply) => {
    let total = 0;
    for (const count of transfers.values()) total += count;
    if ((transfers.get(id) ?? 0) >= TRANSFERS_PER_COMPUTER || total >= TRANSFERS) return null;
    transfers.set(id, (transfers.get(id) ?? 0) + 1);
    const abort = new AbortController();
    reply.raw.once('close', () => {
      // A response that closes before it finished was abandoned: stop the guest side too.
      if (!reply.raw.writableFinished) abort.abort();
      const left = (transfers.get(id) ?? 1) - 1;
      if (left > 0) transfers.set(id, left);
      else transfers.delete(id);
    });
    return abort.signal;
  };
  /** The saved computer is running (the controller rechecks the real guest), or the reply is sent. */
  const running = async (id: string, reply: FastifyReply) => {
    const record = await store.get(id);
    if (!record) return (reply.code(404).send({ message: 'Computer not found.' }), false);
    if (record.state !== 'running' || record.desiredState !== 'running')
      return (reply.code(409).send({ message: 'Computer is not running.' }), false);
    return true;
  };
  const failed = (reply: FastifyReply, error: unknown, unavailable = 'File browsing is unavailable.') => {
    if (!(error instanceof ComputerFileError)) return reply.code(503).send({ message: unavailable });
    if (error.status === 416 && error.size !== undefined) reply.header('Content-Range', `bytes */${error.size}`);
    return reply
      .code(error.status)
      .send(
        error.status === 409 && error.message === CONFLICT
          ? { message: CONFLICT, conflict: true }
          : { message: error.message },
      );
  };
  const noStore = async (_request: unknown, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
  };
  const errorSchema = Type.Object({ message: Type.String() });
  const errors = Object.fromEntries(
    [400, 403, 404, 409, 411, 412, 416, 429, 503, 504, 507].map(status => [status, errorSchema]),
  );

  for (const mode of ['files', 'file-preview'] as const) {
    app.get<{ Params: { id: string }; Querystring: FileQuery }>(
      `/api/computers/:id/${mode}`,
      {
        onRequest: noStore,
        schema: {
          operationId: mode === 'files' ? 'listComputerFiles' : 'previewComputerFile',
          params: Params,
          querystring: Type.Object(
            {
              path: GuestPath,
              ...(mode === 'files'
                ? {
                    offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 20_000 })),
                    filter: Type.Optional(Type.String({ maxLength: 256 })),
                  }
                : {}),
            },
            { additionalProperties: false },
          ),
          response: { 200: mode === 'files' ? computerFilesSchema : computerFilePreviewSchema, ...errors },
        },
      },
      async (request, reply) => {
        const id = request.params.id;
        if (!(await acquire(id))) return reply.code(429).send({ message: 'File operations are busy. Retry shortly.' });
        try {
          if (!(await running(id, reply))) return reply;
          if (!controller?.files) throw new ComputerFileError(503, 'File browsing is unavailable.');
          if (Buffer.byteLength(request.query.path) > 4096) throw new ComputerFileError(400, 'Guest path is too long.');
          return await controller.files(id, mode, request.query);
        } catch (error) {
          return failed(reply, error);
        } finally {
          pending.delete(id);
        }
      },
    );
  }

  // Downloads of any size: the guest file in bounded pieces, written to the browser as it takes them (the response
  // socket's back-pressure paces the reads). One byte range (Range/If-Range) lets browsers resume.
  app.get<{ Params: { id: string }; Querystring: { path: string } }>(
    '/api/computers/:id/download',
    {
      onRequest: noStore,
      schema: {
        operationId: 'downloadComputerFile',
        params: Params,
        querystring: Type.Object({ path: GuestPath }, { additionalProperties: false }),
        response: { 200: Type.String({ format: 'binary' }), 206: Type.String({ format: 'binary' }), ...errors },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { path } = request.query;
      const signal = transfer(id, reply);
      if (!signal) return reply.code(429).send({ message: 'Too many transfers are running. Retry when one finishes.' });
      try {
        if (!(await running(id, reply))) return reply;
        const download = controller?.download?.bind(controller);
        if (!download) throw new ComputerFileError(503, 'File transfer is unavailable.');
        if (Buffer.byteLength(path) > 4096) throw new ComputerFileError(400, 'Guest path is too long.');
        const range = parseRange(request.headers.range);
        // The first piece also says the file's size and validators; a ranged request reads one byte for them.
        const first = await download(id, { path, start: 0, end: range ? 0 : PIECE - 1 }, signal);
        const { size, etag, modified } = first;
        const ifRange = request.headers['if-range'];
        let start = 0,
          end = size - 1;
        const partial = Boolean(
          range && size > 0 && (ifRange === undefined || ifRange === etag || ifRange === modified),
        );
        if (range && partial) {
          if ('suffix' in range) start = Math.max(0, size - range.suffix);
          else {
            start = range.start;
            end = Math.min(range.end ?? end, end);
          }
          if (start >= size || ('suffix' in range && range.suffix === 0))
            throw new ComputerFileError(416, 'The requested range is not available.', size);
        }
        const length = size === 0 ? 0 : end - start + 1;
        const piece = (offset: number) =>
          download(id, { path, start: offset, end: Math.min(offset + PIECE - 1, end), match: etag }, signal);
        async function* bytes() {
          let offset = start;
          let current: Promise<GuestPiece> | null =
            offset === 0 && first.length >= Math.min(PIECE, length) ? Promise.resolve(first) : piece(offset);
          while (current && offset <= end && length > 0) {
            const nextOffset = offset + PIECE;
            const next = nextOffset <= end ? piece(nextOffset) : null;
            next?.catch(() => {}); // awaited below, unless the browser went away first
            const { data } = await current;
            for (let at = 0; at < data.byteLength; at += SLICE)
              yield Buffer.from(data.buffer, data.byteOffset + at, Math.min(SLICE, data.byteLength - at));
            offset = nextOffset;
            current = next;
          }
        }
        reply
          .code(partial ? 206 : 200)
          .type('application/octet-stream')
          .header('Content-Disposition', fileAttachment(path))
          .header('Content-Length', String(length))
          .header('Accept-Ranges', 'bytes')
          .header('ETag', etag)
          .header('Last-Modified', modified);
        if (partial) reply.header('Content-Range', `bytes ${start}-${end}/${size}`);
        // A failure after the headers ends the response early: the browser sees an incomplete download.
        return reply.send(Readable.from(bytes(), { objectMode: false, highWaterMark: SLICE }));
      } catch (error) {
        return failed(reply, error, 'File transfer is unavailable.');
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { path: string; name: string } }>(
    '/api/computers/:id/folders',
    {
      onRequest: noStore,
      bodyLimit: 16_384,
      schema: {
        operationId: 'createComputerFolder',
        params: Params,
        body: Type.Object({ path: GuestPath, name: GuestName }, { additionalProperties: false }),
        response: { 200: folderResultSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      if (Buffer.byteLength(request.body.name) > 255)
        return reply.code(400).send({ message: 'Use a folder name of at most 255 bytes.' });
      if (!(await acquire(id))) return reply.code(429).send({ message: 'File operations are busy. Retry shortly.' });
      try {
        if (!(await running(id, reply))) return reply;
        if (!controller?.folder) throw new ComputerFileError(503, 'File transfer is unavailable.');
        return await controller.folder(id, request.body.path, request.body.name);
      } catch (error) {
        return failed(reply, error, 'File transfer is unavailable.');
      } finally {
        pending.delete(id);
      }
    },
  );

  // Uploads come in parts (any file size; each part at most MAX_UPLOAD_PART) as the raw request body, streamed to
  // the computer without a parser (this scope only).
  void app.register(async scoped => {
    scoped.removeAllContentTypeParsers();
    scoped.addContentTypeParser('*', (_request, payload, done) => done(null, payload));
    scoped.put<{
      Params: { id: string };
      Querystring: { path: string; name: string; size: number; offset: number; upload: string; mode?: UploadMode };
    }>(
      '/api/computers/:id/upload',
      {
        onRequest: noStore,
        schema: {
          operationId: 'uploadComputerFile',
          params: Params,
          querystring: Type.Object(
            {
              path: GuestPath,
              name: GuestName,
              /** The whole file's size; this part is the request body (its Content-Length), at `offset`. */
              size: Type.Integer({ minimum: 0 }),
              offset: Type.Integer({ minimum: 0 }),
              /** Chosen by the browser for this upload (32 hex characters), the same on every part. */
              upload: Type.String({ pattern: '^[0-9a-f]{32}$' }),
              /** A name already taken: refused with 409 (the default), replaced, or kept as "name (1).ext". */
              mode: Type.Optional(
                Type.Union([Type.Literal('refuse'), Type.Literal('overwrite'), Type.Literal('rename')]),
              ),
            },
            { additionalProperties: false },
          ),
          response: {
            201: uploadResultSchema,
            202: uploadProgressSchema,
            ...errors,
            409: Type.Object({ message: Type.String(), conflict: Type.Optional(Type.Boolean()) }),
            413: errorSchema,
          },
        },
      },
      async (request, reply) => {
        const { id } = request.params;
        const { path, name, size, offset, upload } = request.query;
        const header = request.headers['content-length'];
        // No Content-Length and no Transfer-Encoding: no body (RFC 9112), an empty part.
        const length =
          header === undefined && request.headers['transfer-encoding'] === undefined
            ? 0
            : header !== undefined && /^\d{1,16}$/.test(header)
              ? Number(header)
              : NaN;
        if (!Number.isSafeInteger(length))
          return reply.code(411).send({ message: 'An upload part needs a Content-Length.' });
        if (length > MAX_UPLOAD_PART) return reply.code(413).send({ message: 'An upload part is at most 64 MiB.' });
        if (offset + length > size) return reply.code(400).send({ message: 'The part does not fit the file.' });
        if (Buffer.byteLength(name) > 255)
          return reply.code(400).send({ message: 'Use a file name of at most 255 bytes.' });
        const mode = request.query.mode ?? 'refuse';
        const last = offset + length === size;
        // Audited once per file: its last part (or a refused part), not every part in between.
        if (request.audit) request.audit.detail = { size, mode };
        const signal = transfer(id, reply);
        if (!signal)
          return reply.code(429).send({ message: 'Too many transfers are running. Retry when one finishes.' });
        try {
          if (!(await running(id, reply))) return reply;
          if (!controller?.upload) throw new ComputerFileError(503, 'File transfer is unavailable.');
          const body = (request.body as AsyncIterable<Uint8Array> | undefined) ?? (async function* () {})();
          const result = await controller.upload(
            id,
            { path, name, size, offset, length, upload, mode },
            streamOf(body),
            signal,
          );
          if (!last || !('name' in result)) {
            delete request.audit;
            return reply.code(202).send(result);
          }
          if (request.audit) request.audit.detail = { size, mode, renamed: result.name !== name };
          return reply.code(201).send(result);
        } catch (error) {
          return failed(reply, error, 'File transfer is unavailable.');
        }
      },
    );
  });

  // Cancelling an unfinished upload removes its hidden partial file from the computer.
  app.delete<{ Params: { id: string }; Querystring: { path: string; name: string; upload: string } }>(
    '/api/computers/:id/upload',
    {
      onRequest: noStore,
      schema: {
        operationId: 'cancelComputerUpload',
        params: Params,
        querystring: Type.Object(
          { path: GuestPath, name: GuestName, upload: Type.String({ pattern: '^[0-9a-f]{32}$' }) },
          { additionalProperties: false },
        ),
        response: { 200: Type.Object({ cancelled: Type.Boolean() }), ...errors },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      try {
        if (!(await running(id, reply))) return reply;
        if (!controller?.cancelUpload) throw new ComputerFileError(503, 'File transfer is unavailable.');
        await controller.cancelUpload(id, request.query);
        return { cancelled: true };
      } catch (error) {
        return failed(reply, error, 'File transfer is unavailable.');
      }
    },
  );
}
