import net from 'node:net';
export type ExecConnection = { write(data: string): void; close(): void };
/** Fixed Docker HTTP hijack over Unix TCP semantics. Raw net avoids Bun's HTTP-upgrade shim.
 * No caller URL/headers. Incremental bounded headers and non-TTY frame demultiplexing.
 */
export function attachExec(
  socketPath: string,
  id: string,
  signal: AbortSignal,
  onOutput: (chunk: Buffer) => void,
  onEnd: () => void,
  /** Idle limit once attached (0: none, for quiet streams such as monitors); stderr frames, which are dropped otherwise. */
  options: { idleTimeoutMs?: number; onStderr?: (chunk: Buffer) => void } = {},
): Promise<ExecConnection> {
  return new Promise((resolve, reject) => {
    let closed = false,
      upgraded = false,
      header = Buffer.alloc(0),
      buffer = Buffer.alloc(0);
    const socket = net.createConnection({ path: socketPath });
    const close = () => {
      if (closed) return;
      closed = true;
      reject(new Error('Terminal attachment closed.'));
      signal.removeEventListener('abort', close);
      socket.destroy();
      onEnd();
    };
    const fail = (message: string) => {
      reject(new Error(message));
      close();
    };
    const consume = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 8) {
        const size = buffer.readUInt32BE(4);
        if (size > 1048576 || ![1, 2].includes(buffer[0])) return fail('Invalid Docker stream frame.');
        if (buffer.length < size + 8) break;
        const stream = buffer[0],
          payload = buffer.subarray(8, size + 8);
        buffer = buffer.subarray(size + 8);
        if (stream === 1 || (stream === 2 && options.onStderr)) {
          try {
            (stream === 1 ? onOutput : options.onStderr!)(payload);
          } catch {
            fail('Invalid terminal stream.');
            return;
          }
        }
      }
      if (buffer.length > 1048584) fail('Docker stream exceeds its bound.');
    };
    socket.setTimeout(5000);
    socket.on('connect', () => {
      if (closed) return;
      const body = JSON.stringify({ Detach: false, Tty: false });
      socket.write(
        `POST /v1.44/exec/${encodeURIComponent(id)}/start HTTP/1.1\r\nHost: docker\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n${body}`,
      );
    });
    socket.on('data', chunk => {
      if (closed) return;
      if (upgraded) {
        consume(chunk);
        return;
      }
      header = Buffer.concat([header, chunk]);
      const end = header.indexOf('\r\n\r\n');
      if (end < 0) {
        if (header.length > 16384) fail('Docker upgrade header exceeded its bound.');
        return;
      }
      if (end > 16384 || !/^HTTP\/1\.[01] 101\b/.test(header.toString('ascii', 0, end)))
        return fail('Docker exec upgrade failed.');
      upgraded = true;
      socket.setTimeout(options.idleTimeoutMs ?? 25000);
      resolve({
        write(data) {
          if (closed || socket.writableLength > 65536) throw new Error('Terminal input is unavailable.');
          socket.write(data);
        },
        close,
      });
      const head = header.subarray(end + 4);
      header = Buffer.alloc(0);
      if (head.length) consume(head);
    });
    socket.on('error', close).on('end', close).on('close', close).on('timeout', close);
    signal.addEventListener('abort', close, { once: true });
    if (signal.aborted) close();
  });
}

/**
 * Runs a started exec to its end over a hijacked connection: `stdin` (if any) is written with backpressure and then
 * half-closed (the command sees end of input); stdout frames are yielded as they arrive (stderr is dropped). Reading
 * slower than the command writes pauses the socket. Ending the iteration early closes the connection.
 */
export async function* pipeExec(
  socketPath: string,
  id: string,
  options: {
    stdin?: AsyncIterable<Uint8Array>;
    idleTimeoutMs?: number;
    /**
     * Leave the input open after `stdin` ends. Bun's sockets cannot half-close (end() also stops the output, which
     * Docker then drops), so a command that knows how much input to read (a sized upload) is better told nothing.
     */
    keepStdinOpen?: boolean;
  } = {},
): AsyncGenerator<Buffer> {
  const socket = net.createConnection({ path: socketPath, allowHalfOpen: true });
  const queue: Buffer[] = [];
  let header: Buffer = Buffer.alloc(0),
    buffer: Buffer = Buffer.alloc(0);
  let queued = 0,
    upgraded = false,
    ended = false,
    failure: Error | undefined,
    wake: (() => void) | undefined;
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  const fail = (message: string) => {
    failure ??= new Error(message);
    socket.destroy();
    notify();
  };
  const consume = (chunk: Buffer) => {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
    while (buffer.length >= 8) {
      const size = buffer.readUInt32BE(4);
      if (size > 1048576 || ![1, 2].includes(buffer[0]!)) return fail('Invalid Docker stream frame.');
      if (buffer.length < size + 8) break;
      if (buffer[0] === 1 && size) {
        queue.push(buffer.subarray(8, size + 8));
        queued += size;
      }
      buffer = buffer.subarray(size + 8);
    }
    if (queued > 4 * 1048576) socket.pause();
    notify();
  };
  const send = async () => {
    try {
      for await (const chunk of options.stdin!) {
        // Written in pieces of at most 256 KiB: this Bun writes one very large buffer (a request body it gathered
        // while busy) many times slower than the same bytes in pieces.
        for (let offset = 0; offset < chunk.byteLength; offset += 262_144) {
          if (failure || ended) return;
          const piece = chunk.subarray(offset, offset + 262_144);
          if (!socket.write(piece)) await new Promise(done => socket.once('drain', done));
        }
      }
      if (!options.keepStdinOpen) socket.end();
    } catch (error) {
      fail(error instanceof Error ? error.message : 'Could not send the input.');
    }
  };
  socket.setTimeout(options.idleTimeoutMs ?? 60_000);
  socket.on('connect', () => {
    const body = JSON.stringify({ Detach: false, Tty: false });
    socket.write(
      `POST /v1.44/exec/${encodeURIComponent(id)}/start HTTP/1.1\r\nHost: docker\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n${body}`,
    );
  });
  socket.on('data', chunk => {
    if (upgraded) return consume(chunk);
    header = Buffer.concat([header, chunk]);
    const end = header.indexOf('\r\n\r\n');
    if (end < 0) {
      if (header.length > 16384) fail('Docker upgrade header exceeded its bound.');
      return;
    }
    if (end > 16384 || !/^HTTP\/1\.[01] 101\b/.test(header.toString('ascii', 0, end)))
      return fail('Docker exec upgrade failed.');
    upgraded = true;
    if (options.stdin) void send();
    const head = header.subarray(end + 4);
    if (head.length) consume(head);
  });
  socket.on('end', () => {
    if (!upgraded) fail('Docker exec upgrade failed.');
    else if (buffer.length) fail('Incomplete Docker exec stream frame.');
    ended = true;
    notify();
  });
  socket.on('timeout', () => fail('Docker operation timed out.'));
  socket.on('error', error => fail(error.message));
  socket.on('close', () => {
    ended = true;
    notify();
  });
  try {
    while (true) {
      const chunk = queue.shift();
      if (chunk) {
        queued -= chunk.length;
        if (queued < 1048576 && socket.isPaused()) socket.resume();
        yield chunk;
        continue;
      }
      if (failure) throw failure;
      if (ended) return;
      await new Promise<void>(resolve => (wake = resolve));
    }
  } finally {
    ended = true;
    socket.destroy();
  }
}
