import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { CodexProvider } from './codex-provider';

const Status = Type.Object({ connected: Type.Boolean(), models: Type.Array(Type.String()), login: Type.Object({
  state: Type.Union(['idle', 'starting', 'waiting', 'connected', 'error'].map(value => Type.Literal(value))),
  userCode: Type.Optional(Type.String()), verificationUri: Type.Optional(Type.String()), message: Type.Optional(Type.String()),
}) });
const ErrorResponse = Type.Object({ message: Type.String() });
export function registerCodex(app: FastifyInstance, codex: CodexProvider) {
  const schema = { response: { 200: Status, 403: ErrorResponse, 503: ErrorResponse } };
  app.addHook('onClose', async () => { await codex.cancel(); });
  app.register(async routes => {
    routes.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const origin = request.headers.origin;
      if (request.headers['sec-fetch-site'] === 'cross-site' || (origin && (() => {
        try { return new URL(origin).hostname !== new URL(`http://${request.headers.host}`).hostname; }
        catch { return true; }
      })())) return reply.code(403).send({ message: 'Cross-site provider access is not allowed.' });
    });
    routes.get('/api/providers/openai-codex', { schema: { ...schema, operationId: 'getCodexProvider' } }, async (_request, reply) => {
      try { return await codex.status(); }
      catch { return reply.code(503).send({ message: 'Could not read provider connection.' }); }
    });
    routes.post('/api/providers/openai-codex/login', { schema: { ...schema, operationId: 'connectCodexProvider', body: Type.Object({}, { additionalProperties: false }) } }, async (_request, reply) => {
      try { codex.start(); return await codex.status(); }
      catch { return reply.code(503).send({ message: 'Could not start provider sign-in.' }); }
    });
    routes.delete('/api/providers/openai-codex/login', { schema: { ...schema, operationId: 'cancelCodexLogin' } }, async (_request, reply) => {
      try { await codex.cancel(); return await codex.status(); }
      catch { return reply.code(503).send({ message: 'Could not cancel sign-in.' }); }
    });
    routes.delete('/api/providers/openai-codex', { schema: { ...schema, operationId: 'disconnectCodexProvider' } }, async (_request, reply) => {
      try { await codex.disconnect(); return await codex.status(); }
      catch { return reply.code(503).send({ message: 'Could not disconnect provider.' }); }
    });
  });
}
