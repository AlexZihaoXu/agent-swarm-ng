import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { ComputerController } from './computer-controller-client';
import type { ComputerStore } from './computer-store';
import { ComputerFileError, computerFilesSchema, computerFilePreviewSchema, fileAttachment, type FileQuery } from './computer-files';

/** Trusted operator surface, deliberately independent of agent assignments/claims. */
export function registerComputerFileRoutes(app: FastifyInstance, store: ComputerStore, controller: ComputerController | null) {
  const pending = new Set<string>();
  const errorSchema = Type.Object({ message: Type.String() });
  const errors = Object.fromEntries([400, 403, 404, 409, 413, 429, 503, 504].map(status => [status, errorSchema]));
  for (const mode of ['files', 'file-preview', 'download'] as const) {
    app.get<{ Params: { id: string }; Querystring: FileQuery }>(`/api/computers/:id/${mode}`, {
      onRequest: async (_request, reply) => { reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff'); },
      schema: {
        operationId: { files: 'listComputerFiles', 'file-preview': 'previewComputerFile', download: 'downloadComputerFile' }[mode],
        params: Type.Object({ id: Type.String({ minLength: 1, maxLength: 80 }) }),
        querystring: Type.Object({
          path: Type.String({ minLength: 1, maxLength: 4096, pattern: '^/[^\\u0000]*$' }),
          ...(mode === 'files' ? {
            offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 20_000 })),
            filter: Type.Optional(Type.String({ maxLength: 256 })),
          } : {}),
        }, { additionalProperties: false }),
        response: { 200: mode === 'files' ? computerFilesSchema : mode === 'file-preview' ? computerFilePreviewSchema : Type.String({ format: 'binary' }), ...errors },
      },
    }, async (request, reply) => {
      const id = request.params.id;
      if (pending.has(id) || pending.size >= 2) return reply.code(429).send({ message: 'File operations are busy. Retry shortly.' });
      pending.add(id);
      let operationFinished = false, responseFinished = false, released = false;
      const release = () => {
        if (operationFinished && responseFinished && !released) { released = true; pending.delete(id); }
      };
      const responseDone = () => { responseFinished = true; release(); };
      // Retain admission while a slow browser still owns a buffered download.
      reply.raw.once('finish', responseDone).once('close', responseDone);
      try {
        const record = await store.get(id);
        if (!record) return reply.code(404).send({ message: 'Computer not found.' });
        if (record.state !== 'running' || record.desiredState !== 'running') return reply.code(409).send({ message: 'Computer is not running.' });
        if (!controller?.files) throw new ComputerFileError(503, 'File browsing is unavailable.');
        if (Buffer.byteLength(request.query.path) > 4096) throw new ComputerFileError(400, 'Guest path is too long.');
        const result = await controller.files(id, mode, request.query);
        if (mode === 'download') return reply.type('application/octet-stream').header('Content-Disposition', fileAttachment(request.query.path)).send(result);
        return result;
      } catch (error) {
        const status = error instanceof ComputerFileError ? error.status : 503;
        return reply.code(status).send({ message: error instanceof ComputerFileError ? error.message : 'File browsing is unavailable.' });
      } finally { operationFinished = true; release(); }
    });
  }
}
