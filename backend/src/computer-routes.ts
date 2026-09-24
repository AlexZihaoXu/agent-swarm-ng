import type { FastifyInstance, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { PlatformStore } from './platform-store';
import { ComputerStore, ComputerStoreError } from './computer-store';
import type { ComputerController, ComputerObservation } from './computer-controller-client';

const idParams = Type.Object({ id: Type.String({ minLength: 1, maxLength: 80 }) });
const errorSchema = Type.Object({ message: Type.String() });
const errors = { 400: errorSchema, 404: errorSchema, 409: errorSchema, 503: errorSchema };
const viewSchema = Type.Object({
  id: Type.String(), name: Type.String(), state: Type.String(), createdAt: Type.Number(),
  cpuPercent: Type.Union([Type.Number(), Type.Null()]), memoryBytes: Type.Union([Type.Number(), Type.Null()]),
});

function view(record: { id: string; name: string; state: string; createdAt: Date }, observed?: ComputerObservation) {
  return {
    id: record.id, name: record.name,
    state: record.state === 'running' ? (observed?.status ?? 'unavailable') : record.state,
    createdAt: record.createdAt.getTime(), cpuPercent: observed?.cpuPercent ?? null, memoryBytes: observed?.memoryBytes ?? null,
  };
}
function unavailable(reply: FastifyReply) {
  return reply.code(503).send({ message: 'Computer management is unavailable. Retry when the controller is healthy.' });
}
function failure(reply: FastifyReply, error: unknown) {
  if (error instanceof ComputerStoreError) {
    return reply.code(error.code === 'missing' ? 404 : error.code === 'conflict' ? 409 : 400).send({ message: error.message });
  }
  return unavailable(reply);
}

export function registerComputerRoutes(app: FastifyInstance, platform: PlatformStore, controller: ComputerController | null) {
  const store = new ComputerStore(platform);
  app.get('/api/computers', {
    schema: { operationId: 'listComputers', response: { 200: Type.Object({ computers: Type.Array(viewSchema) }), ...errors } },
  }, async (_, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!controller) return unavailable(reply);
    try {
      const [records, observed] = await Promise.all([store.list(), controller.observe()]);
      return { computers: records.map(record => view(record, observed.get(record.id))) };
    } catch (error) { return failure(reply, error); }
  });
  app.post<{ Body: { name: string; requestKey: string } }>('/api/computers', {
    schema: { operationId: 'createComputer', body: Type.Object({ name: Type.String({ minLength: 1, maxLength: 80 }), requestKey: Type.String({ format: 'uuid' }) }, { additionalProperties: false }), response: { 200: viewSchema, 201: viewSchema, ...errors } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!controller) return unavailable(reply);
    let recordId: string | undefined;
    try {
      const { computer, created } = await store.reserve(request.body.name, request.body.requestKey);
      recordId = computer.id;
      if (computer.state === 'deleting' || computer.state === 'failed') return reply.code(409).send({ message: 'Delete the incomplete computer before reusing this create request.' });
      if (computer.state === 'creating') {
        await controller.create(computer.id, computer.name);
        await store.markRunning(computer.id);
      }
      const observed = await controller.observe();
      const current = await store.get(computer.id);
      if (!current) return unavailable(reply);
      return reply.code(created ? 201 : 200).send(view(current, observed.get(computer.id)));
    } catch (error) {
      if (!(error instanceof ComputerStoreError) && recordId) await store.markFailed(recordId).catch(() => {});
      return failure(reply, error);
    }
  });
  app.delete<{ Params: { id: string }; Body: { confirmation: string } }>('/api/computers/:id', {
    schema: { operationId: 'deleteComputer', params: idParams, body: Type.Object({ confirmation: Type.String({ minLength: 1, maxLength: 80 }) }, { additionalProperties: false }), response: { 200: Type.Object({ deleted: Type.Boolean() }), ...errors } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!controller) return unavailable(reply);
    try {
      const record = await store.markDeleting(request.params.id, request.body.confirmation);
      await controller.remove(record.id, record.name);
      if (!await store.finalizeDelete(record.id, record.name)) return unavailable(reply);
      return { deleted: true };
    } catch (error) { return failure(reply, error); }
  });
  app.get<{ Params: { id: string } }>('/api/computers/:id/preview', {
    schema: { operationId: 'getComputerPreview', params: idParams, response: { 200: Type.String({ format: 'binary' }), ...errors } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!controller) return unavailable(reply);
    const record = await store.get(request.params.id);
    if (!record) return reply.code(404).send({ message: 'Computer not found.' });
    if (record.state !== 'running') return unavailable(reply);
    try {
      const image = await controller.preview(record.id);
      if (!image) return unavailable(reply);
      return reply.type('image/jpeg').send(Buffer.from(image));
    } catch (error) { return failure(reply, error); }
  });
}
