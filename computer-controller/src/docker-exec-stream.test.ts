import { expect, it } from 'vitest';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DockerApi } from './docker-api';
it('streams bounded stdout across frame splits, writes stdin and closes on observer cancellation', async () => {
  const dir = await mkdtemp(join(process.env.SQLITE_TEST_ROOT!, 'pty-')),
    path = join(dir, 'docker.sock');
  const requests: any[] = [];
  let peer: any,
    input = '',
    ends = 0;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.end('{"Id":"test-exec"}');
    });
  });
  const frame = (stream: number, text: string) => {
    const b = Buffer.from(text),
      header = Buffer.alloc(8);
    header[0] = stream;
    header.writeUInt32BE(b.length, 4);
    return Buffer.concat([header, b]);
  };
  server.on('upgrade', (_req, socket) => {
    peer = socket;
    socket.on('error', () => {});
    socket.write('HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n');
    socket.on('data', data => {
      input += data.toString();
    });
  });
  await new Promise<void>(resolve => server.listen(path, resolve));
  const abort = new AbortController(),
    output: Buffer[] = [];
  try {
    const connection = await new DockerApi(path).execStream(
      'immutable-guest',
      ['/fixed/viewer', 'session'],
      abort.signal,
      chunk => output.push(chunk),
      () => {
        ends++;
      },
    );
    expect(requests[0]).toMatchObject({
      AttachStdin: true,
      Tty: false,
      User: '1000:1000',
      Cmd: ['/fixed/viewer', 'session'],
    });
    const bytes = Buffer.concat([frame(2, 'not public'), frame(1, 'hello')]);
    peer.write(bytes.subarray(0, 5));
    peer.write(bytes.subarray(5));
    await expect.poll(() => Buffer.concat(output).toString()).toBe('hello');
    connection.write('{"type":"ping"}\n');
    await expect.poll(() => input).toContain('"type":"ping"');
    abort.abort();
    await expect.poll(() => ends).toBe(1);
    expect(() => connection.write('late input')).toThrow();
  } finally {
    abort.abort();
    peer?.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
