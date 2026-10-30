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

it('pipes input to a command, ends its input, and yields its output to the end', async () => {
  const dir = await mkdtemp(join(process.env.SQLITE_TEST_ROOT!, 'pipe-')),
    path = join(dir, 'docker.sock');
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => res.end(req.url?.endsWith('/json') ? '{"Running":false,"ExitCode":0}' : '{"Id":"pipe-exec"}'));
  });
  server.on('upgrade', (_req, socket) => {
    socket.write('HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n');
    const input: Buffer[] = [];
    socket.on('data', data => input.push(data));
    // The command's output once its input ended: the input, upper-cased, in two frames (and one of stderr).
    socket.on('end', () => {
      const text = Buffer.concat(input).toString().toUpperCase();
      for (const [stream, part] of [
        [1, text.slice(0, 3)],
        [2, 'noise'],
        [1, text.slice(3)],
      ] as const) {
        const header = Buffer.alloc(8);
        header[0] = stream;
        header.writeUInt32BE(Buffer.byteLength(part), 4);
        socket.write(Buffer.concat([header, Buffer.from(part)]));
      }
      socket.end();
    });
  });
  await new Promise<void>(resolve => server.listen(path, resolve));
  try {
    const run = await new DockerApi(path).pipe(
      'guest',
      ['cat'],
      'root',
      (async function* () {
        yield Buffer.from('hello ');
        yield Buffer.from('world');
      })(),
    );
    const output: Buffer[] = [];
    for await (const chunk of run.output) output.push(chunk);
    expect(Buffer.concat(output).toString()).toBe('HELLO WORLD');
    expect(await run.exitCode()).toBe(0);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

it('can leave the input open (a sized upload) and writes a large chunk in pieces', async () => {
  const dir = await mkdtemp(join(process.env.SQLITE_TEST_ROOT!, 'pipe-open-')),
    path = join(dir, 'docker.sock');
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => res.end('{"Id":"pipe-exec"}'));
  });
  let ended = false;
  const pieces: number[] = [];
  server.on('upgrade', (_req, socket) => {
    socket.write('HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n');
    let received = 0;
    socket.on('end', () => (ended = true));
    // The command reads exactly the announced 3 MiB, answers, and exits: it never needs the end of its input.
    socket.on('data', data => {
      pieces.push(data.length);
      received += data.length;
      if (received < 3 * 1024 * 1024) return;
      const answer = Buffer.from(`${received}\n`);
      const header = Buffer.alloc(8);
      header[0] = 1;
      header.writeUInt32BE(answer.length, 4);
      socket.end(Buffer.concat([header, answer]));
    });
  });
  await new Promise<void>(resolve => server.listen(path, resolve));
  try {
    const run = await new DockerApi(path).pipe(
      'guest',
      ['upload'],
      '1000:1000',
      (async function* () {
        yield Buffer.alloc(3 * 1024 * 1024, 7);
      })(),
      { keepStdinOpen: true },
    );
    const output: Buffer[] = [];
    for await (const chunk of run.output) output.push(chunk);
    expect(Buffer.concat(output).toString()).toBe(`${3 * 1024 * 1024}\n`);
    expect(ended).toBe(false);
    expect(Math.max(...pieces)).toBeLessThanOrEqual(262_144 * 2);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
