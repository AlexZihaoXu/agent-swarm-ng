import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { ComputerController } from './computer-controller-client';
import type { ComputerUseService } from './computer-use/service';
export function terminalOrigin(origin: unknown, host: string | undefined) {
  try {
    if (typeof origin !== 'string' || !host) return false;
    const from = new URL(origin);
    return (
      ['http:', 'https:'].includes(from.protocol) &&
      from.origin === origin &&
      from.origin === new URL(`${from.protocol}//${host}`).origin
    );
  } catch {
    return false;
  }
}
/** Human-only, same-origin PTY relay. Never exposes this socket as an agent tool. */
export function registerTerminalStreams(
  app: FastifyInstance,
  service: ComputerUseService,
  controller: ComputerController | null,
) {
  const counts = new Map<string, number>();
  let total = 0;
  const uuid = Type.String({ format: 'uuid' });
  app.get<{ Params: { id: string; session: string } }>(
    '/api/computers/:id/terminals/:session/stream',
    {
      websocket: true,
      schema: { hide: true, params: Type.Object({ id: uuid, session: uuid }) },
      preValidation: async (request, reply) => {
        if (!terminalOrigin(request.headers.origin, request.headers.host))
          return reply.code(403).send({ message: 'Same-origin terminal connection required.' });
        await service.ready();
        const computer = await service.database.client.computer.findUnique({ where: { id: request.params.id } });
        if (!computer) return reply.code(404).send({ message: 'Computer not found.' });
        if (computer.state !== 'running' || computer.desiredState !== 'running')
          return reply.code(409).send({ message: 'Computer is not running.' });
        if (!controller?.terminalSocket) return reply.code(503).send({ message: 'Terminal streaming is unavailable.' });
      },
    },
    (socket, request) => {
      const { id, session } = request.params;
      if (total >= 8 || (counts.get(id) ?? 0) >= 2) {
        socket.close(1008, 'Terminal viewers are busy.');
        return;
      }
      total++;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      let closed = false,
        ready = false,
        pending = 0,
        pendingFrames = 0,
        frames = 0,
        since = Date.now(),
        chain = Promise.resolve(),
        upstream: WebSocket | undefined;
      let connectionTimer: ReturnType<typeof setTimeout> | undefined;
      let unwatch = () => {};
      const close = () => {
        if (closed) return;
        closed = true;
        unwatch();
        clearTimeout(connectionTimer);
        total--;
        const left = (counts.get(id) ?? 1) - 1;
        if (left) counts.set(id, left);
        else counts.delete(id);
        upstream?.close();
        socket.close(1011, 'Terminal disconnected. Inspect before repeating input.');
      };
      // Signing out (or a password change) ends this terminal view.
      unwatch = app.watchSession?.(request, close) ?? unwatch;
      // Attach handlers before async work, and serialize checks/sends without replay on reconnect.
      socket
        .on('close', close)
        .on('error', close)
        .on('message', (raw, binary) => {
          if (closed) return;
          try {
            if (binary || !ready || !Buffer.isBuffer(raw) || raw.length > 16384) throw Error();
            if (Date.now() - since >= 1000) {
              since = Date.now();
              frames = 0;
            }
            if (++frames > 256) throw Error();
            const value = JSON.parse(raw.toString()),
              keys = Object.keys(value);
            if (value.type === 'ping' && keys.length === 1) {
              upstream!.send('{"type":"ping"}');
              return;
            }
            if (
              value.type !== 'input' ||
              keys.length !== 2 ||
              typeof value.data !== 'string' ||
              !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data) ||
              value.data.length > 5464
            )
              throw Error();
            const bytes = Buffer.from(value.data, 'base64');
            if (!bytes.length || bytes.length > 4096 || bytes.toString('base64') !== value.data) throw Error();
            pending += bytes.length;
            pendingFrames++;
            if (pending > 65536 || pendingFrames > 256) throw Error();
            chain = chain
              .then(async () => {
                if (closed) return;
                await service.operatorTerminalKeyboard(id, () => {
                  if (!closed) {
                    if (upstream!.bufferedAmount > 65536) throw Error();
                    upstream!.send(JSON.stringify({ type: 'input', data: value.data }));
                  }
                });
              })
              .catch(close)
              .finally(() => {
                pending -= bytes.length;
                pendingFrames--;
              });
          } catch {
            close();
          }
        });
      try {
        connectionTimer = setTimeout(close, 10000);
        upstream = controller!.terminalSocket!(id, session);
        upstream.onmessage = event => {
          try {
            if (typeof event.data !== 'string' || event.data.length > 16384 || socket.bufferedAmount > 262144)
              throw Error();
            const data = JSON.parse(event.data);
            if (
              data.type === 'ready' &&
              Number.isInteger(data.columns) &&
              Number.isInteger(data.rows) &&
              data.columns >= 40 &&
              data.columns <= 240 &&
              data.rows >= 10 &&
              data.rows <= 80
            ) {
              ready = true;
              clearTimeout(connectionTimer);
            } else if (
              data.type !== 'output' ||
              typeof data.data !== 'string' ||
              data.data.length > 12000 ||
              !/^[A-Za-z0-9+/]*={0,2}$/.test(data.data)
            )
              throw Error();
            if (!closed) socket.send(event.data);
          } catch {
            close();
          }
        };
        upstream.onerror = close;
        upstream.onclose = close;
      } catch {
        close();
      }
    },
  );
}
