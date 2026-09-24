import { afterEach, expect, it } from 'vitest';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DockerApi, DockerApiError } from './docker-api';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function engine(handler: (path: string, response: http.ServerResponse) => void) {
  const dir = await mkdtemp(join(process.env.SQLITE_TEST_ROOT!, 'docker-api-'));
  const socketPath = join(dir, 'docker.sock');
  const server = http.createServer((req, res) => handler(req.url ?? '', res));
  await new Promise<void>(resolve => server.listen(socketPath, resolve));
  cleanup.push(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); });
  return new DockerApi(socketPath);
}
function frame(stream: number, content: string) {
  const data = Buffer.from(content), header = Buffer.alloc(8);
  header[0] = stream; header.writeUInt32BE(data.length, 4);
  return Buffer.concat([header, data]);
}

it('bounds Docker Unix-socket responses and decodes only stdout from an exec stream', async () => {
  const client = await engine((path, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (path === '/v1.44/containers/owned/exec') res.end(JSON.stringify({ Id: 'exec-id' }));
    else if (path === '/v1.44/exec/exec-id/start') res.end(Buffer.concat([frame(2, 'diagnostic'), frame(1, 'frame-data')]));
    else if (path === '/v1.44/exec/exec-id/json') res.end(JSON.stringify({ ExitCode: 0 }));
    else res.writeHead(404).end();
  });
  expect(await client.exec('owned', ['/opt/swarm/render-preview.sh'], 'ubuntu')).toEqual(Buffer.from('frame-data'));
});

it('never treats a missing or failed Docker resource as a successful exec', async () => {
  const client = await engine((path, res) => {
    if (path.endsWith('/json')) res.writeHead(404).end('{}');
    else res.end('{}');
  });
  expect(await client.optional('/containers/missing/json')).toBeNull();
  await expect(client.exec('missing', ['true'])).rejects.toThrow();
  await expect(client.json('GET', '/containers/missing/json')).rejects.toBeInstanceOf(DockerApiError);
});
