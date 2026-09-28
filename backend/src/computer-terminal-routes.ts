import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { ComputerUseError, type ComputerUseService } from './computer-use/service';
import { terminalRequest, type TerminalRequest } from './computer-use/terminal-tools';
const session = Type.Object({
  id: Type.String(),
  name: Type.String(),
  alive: Type.Boolean(),
  exitCode: Type.Union([Type.Integer(), Type.Null()]),
  exitSignal: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  createdAt: Type.Integer(),
  columns: Type.Integer(),
  rows: Type.Integer(),
  cwd: Type.Optional(Type.String()),
  currentCommand: Type.Optional(Type.String()),
});
const result = Type.Object({
  type: Type.Literal('terminal'),
  sessions: Type.Optional(Type.Array(session)),
  session: Type.Optional(session),
  text: Type.Optional(Type.String()),
  truncated: Type.Optional(Type.Boolean()),
  window: Type.Optional(
    Type.Object({ from: Type.Integer(), to: Type.Integer(), total: Type.Integer(), up: Type.Integer() }),
  ),
  note: Type.Optional(Type.String()),
  accepted: Type.Optional(Type.Boolean()),
  deleted: Type.Optional(Type.Boolean()),
  sessionId: Type.Optional(Type.String()),
});
const error = Type.Object({ message: Type.String() });
const params = Type.Object(
  { id: Type.String({ pattern: '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$' }) },
  { additionalProperties: false },
);
/** Explicit trusted-operator terminal surface. Never an agent grant or raw Docker/tmux proxy. */
export function registerComputerTerminalRoutes(app: FastifyInstance, service: ComputerUseService) {
  app.post<{ Params: { id: string }; Body: TerminalRequest }>(
    '/api/computers/:id/terminals',
    {
      bodyLimit: 65536,
      // Fastify's default removeAdditional mutates union bodies while trying other branches.
      // Validate this small strict union without coercion/removal so session/text cannot disappear.
      validatorCompiler:
        ({ httpPart }) =>
        data =>
          Value.Check(httpPart === 'body' ? terminalRequest : params, data)
            ? { value: data }
            : { error: new Error('Invalid terminal request.') },
      schema: {
        operationId: 'computerTerminal',
        params,
        body: terminalRequest,
        response: { 200: result, 400: error, 403: error, 404: error, 409: error, 503: error },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
      try {
        const receipt = await service.operatorTerminal(request.params.id, request.body);
        if (receipt.error) return reply.code(400).send({ message: receipt.error });
        return receipt.result;
      } catch (err) {
        return reply.code(err instanceof ComputerUseError ? err.status : 503).send({
          message:
            err instanceof ComputerUseError ? err.message : 'Terminal unavailable; inspect before retrying input.',
        });
      }
    },
  );
}
