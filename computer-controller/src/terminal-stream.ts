import { terminalSize } from './computer-terminal';
const validTerminalSize = (columns: unknown, rows: unknown) =>
  Number.isInteger(columns) &&
  Number.isInteger(rows) &&
  (columns as number) >= terminalSize.columns[0] &&
  (columns as number) <= terminalSize.columns[1] &&
  (rows as number) >= terminalSize.rows[0] &&
  (rows as number) <= terminalSize.rows[1];
import type { ServerWebSocket } from 'bun';
import type { ComputerManager } from './manager';
import type { ExecConnection } from './docker-exec-stream';
import { ResourceError, validateId } from './resources';
export type TerminalSocket = {
  id: string;
  session: string;
  abort: AbortController;
  connection?: ExecConnection;
  buffer: string;
  released: boolean;
  opening: boolean;
  counted: boolean;
  since: number;
  inputBytes: number;
  frames: number;
};
export function terminalSockets(manager: ComputerManager) {
  const counts = new Map<string, number>();
  let total = 0;
  const release = (data: TerminalSocket) => {
    if (!data.released) {
      data.released = true;
      data.abort.abort();
      data.connection?.close();
    }
    // Keep admission while an already-started Docker inspection/exec creation is still joining.
    if (data.opening || !data.counted) return;
    data.counted = false;
    total--;
    const left = (counts.get(data.id) ?? 1) - 1;
    if (left) counts.set(data.id, left);
    else counts.delete(data.id);
  };
  return {
    reserve(id: string, session: string): TerminalSocket {
      validateId(id);
      validateId(session);
      if (total >= 8 || (counts.get(id) ?? 0) >= 2) throw new ResourceError(429, 'Terminal viewers are busy.');
      total++;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      return {
        id,
        session,
        abort: new AbortController(),
        buffer: '',
        released: false,
        opening: true,
        counted: true,
        since: Date.now(),
        inputBytes: 0,
        frames: 0,
      };
    },
    release,
    handlers: {
      maxPayloadLength: 16384,
      backpressureLimit: 262144,
      closeOnBackpressureLimit: true,
      idleTimeout: 30,
      async open(ws: ServerWebSocket<TerminalSocket>) {
        const data = ws.data;
        try {
          data.connection = await manager.terminalStream(
            data.id,
            data.session,
            data.abort.signal,
            chunk => {
              data.buffer += chunk.toString('utf8');
              if (data.buffer.length > 32768) throw Error('Terminal output exceeded its bound.');
              let newline;
              while ((newline = data.buffer.indexOf('\n')) >= 0) {
                const event = JSON.parse(data.buffer.slice(0, newline));
                data.buffer = data.buffer.slice(newline + 1);
                const valid =
                  (event.type === 'ready' && validTerminalSize(event.columns, event.rows)) ||
                  (event.type === 'output' &&
                    typeof event.data === 'string' &&
                    event.data.length <= 12000 &&
                    /^[A-Za-z0-9+/]*={0,2}$/.test(event.data));
                if (!valid) throw Error('Terminal ended.');
                if (ws.getBufferedAmount() > 262144) throw Error('Slow terminal viewer.');
                ws.send(JSON.stringify(event));
              }
            },
            () => ws.close(1011, 'Terminal attachment ended'),
          );
          if (data.released) data.connection.close();
        } catch {
          release(data);
          ws.close(1011, 'Terminal unavailable. Reconnect without replaying input.');
        } finally {
          data.opening = false;
          if (data.released) release(data);
        }
      },
      message(ws: ServerWebSocket<TerminalSocket>, message: string | Buffer) {
        if (ws.data.released) return;
        try {
          if (typeof message !== 'string' || message.length > 16384 || !ws.data.connection) throw Error();
          if (Date.now() - ws.data.since >= 1000) {
            ws.data.since = Date.now();
            ws.data.inputBytes = 0;
            ws.data.frames = 0;
          }
          if (++ws.data.frames > 256) throw Error();
          const value = JSON.parse(message),
            keys = Object.keys(value);
          if (value.type === 'ping' && keys.length === 1) {
            ws.data.connection.write('{"type":"ping"}\n');
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
          ws.data.inputBytes += bytes.length;
          if (ws.data.inputBytes > 65536) throw Error();
          ws.data.connection.write(JSON.stringify({ type: 'input', data: value.data }) + '\n');
        } catch {
          release(ws.data);
          ws.close(1008, 'Invalid or unavailable terminal input.');
        }
      },
      close(ws: ServerWebSocket<TerminalSocket>) {
        release(ws.data);
      },
    },
  };
}
