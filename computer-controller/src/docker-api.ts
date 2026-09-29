import http from 'node:http';
import { attachExec } from './docker-exec-stream';

export class DockerApiError extends Error {
  constructor(readonly status: number) {
    super(`Docker operation returned ${status}.`);
  }
}

/** Fixed-path Docker Engine calls over the local Unix socket, never browser URLs. */
export class DockerApi {
  constructor(private readonly socketPath = '/var/run/docker.sock') {}

  async request(method: string, path: string, body?: unknown, maxBytes = 4 * 1024 * 1024, timeout = 30_000) {
    const encoded = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const response = await new Promise<{ status: number; data: Buffer }>((resolve, reject) => {
      const req = http.request(
        {
          socketPath: this.socketPath,
          path: `/v1.44${path}`,
          method,
          headers: encoded ? { 'Content-Type': 'application/json', 'Content-Length': encoded.length } : {},
          timeout,
        },
        res => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              res.destroy(new Error('Docker response exceeded its limit.'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('error', reject);
          res.on('end', () => resolve({ status: res.statusCode ?? 503, data: Buffer.concat(chunks) }));
        },
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('Docker operation timed out.')));
      req.end(encoded);
    });
    if (response.status < 200 || response.status >= 300) throw new DockerApiError(response.status);
    return response.data;
  }

  async json<T>(method: string, path: string, body?: unknown, maxBytes?: number): Promise<T> {
    const data = await this.request(method, path, body, maxBytes);
    return JSON.parse(data.toString()) as T;
  }

  async optional<T>(path: string): Promise<T | null> {
    try {
      return await this.json<T>('GET', path);
    } catch (error) {
      if (error instanceof DockerApiError && error.status === 404) return null;
      throw error;
    }
  }

  /**
   * Docker's archive endpoint for one container path: HEAD stats it, GET streams it as tar, PUT extracts a tar into
   * a folder. Streams both ways; nothing is buffered.
   */
  archive(
    method: 'HEAD' | 'GET' | 'PUT',
    container: string,
    query: Record<string, string>,
    body?: AsyncIterable<Uint8Array>,
    timeout = 120_000,
  ) {
    return new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.request(
        {
          socketPath: this.socketPath,
          path: `/v1.44/containers/${encodeURIComponent(container)}/archive?${new URLSearchParams(query)}`,
          method,
          headers: body ? { 'Content-Type': 'application/x-tar', 'Transfer-Encoding': 'chunked' } : {},
          timeout,
        },
        resolve,
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('Docker operation timed out.')));
      if (!body) return void req.end();
      void (async () => {
        try {
          for await (const chunk of body) {
            if (!req.write(chunk)) await new Promise(done => req.once('drain', done));
          }
          req.end();
        } catch (error) {
          req.destroy(error as Error);
          reject(error);
        }
      })();
    });
  }

  async execStream(
    container: string,
    command: string[],
    signal: AbortSignal,
    onOutput: (chunk: Buffer) => void,
    onEnd: () => void,
  ) {
    signal.throwIfAborted();
    const created = await this.json<{ Id: string }>('POST', `/containers/${encodeURIComponent(container)}/exec`, {
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      Cmd: command,
      User: '1000:1000',
      Env: ['XDG_RUNTIME_DIR=/run/user/1000'],
    });
    signal.throwIfAborted();
    return attachExec(this.socketPath, created.Id, signal, onOutput, onEnd);
  }

  async exec(container: string, command: string[], user = 'root', timeout = 19_000, maxBytes = 768 * 1024) {
    const created = await this.json<{ Id: string }>('POST', `/containers/${encodeURIComponent(container)}/exec`, {
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      Cmd: command,
      User: user,
      Env: ['XDG_RUNTIME_DIR=/run/user/1000'],
    });
    const raw = await this.request(
      'POST',
      `/exec/${encodeURIComponent(created.Id)}/start`,
      { Detach: false, Tty: false },
      maxBytes,
      timeout,
    );
    let offset = 0;
    const stdout: Buffer[] = [];
    while (offset < raw.length) {
      if (offset + 8 > raw.length) throw new Error('Incomplete Docker exec stream header.');
      const stream = raw[offset];
      const length = raw.readUInt32BE(offset + 4);
      offset += 8;
      if (offset + length > raw.length) throw new Error('Incomplete Docker exec stream frame.');
      if (stream === 1) stdout.push(raw.subarray(offset, offset + length));
      offset += length;
    }
    const result = await this.json<{ ExitCode: number | null }>('GET', `/exec/${encodeURIComponent(created.Id)}/json`);
    if (result.ExitCode !== 0) throw new Error('Computer command failed.');
    return Buffer.concat(stdout);
  }
}
