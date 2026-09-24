import { DockerApi, DockerApiError } from './docker-api';
import { ComputerManager } from './manager';
import { ResourceError } from './resources';

process.umask(0o077);
const docker = new DockerApi();
const manager = new ComputerManager(docker, process.env.COMPUTER_NAMESPACE ?? 'agent-swarm-ng', undefined,
  process.env.COMPUTER_IMAGE ?? 'agent-swarm-default:stage2',
  process.env.COMPUTER_EGRESS_IMAGE ?? 'agent-swarm-computer-egress:dev',
  process.env.COMPUTER_MEDIA_IMAGE ?? 'agent-swarm-computer-media:stage2',
  Number(process.env.COMPUTER_MAX_COUNT ?? 4),
  process.env.COMPUTER_RENDER_DEVICE ?? '');
// Boot-time reconciliation starts only our labelled computers, always after
// their filtered egress sidecars. No model inference or agent work is replayed.
await manager.resume();
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

async function body(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new ResourceError(400, 'A JSON body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) throw new ResourceError(400, 'Request is too large.');
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw new ResourceError(400, 'Invalid JSON.'); }
}

Bun.serve({
  hostname: '0.0.0.0', port: Number(process.env.COMPUTER_CONTROLLER_PORT ?? 3101),
  async fetch(request) {
    try {
      const { pathname, searchParams } = new URL(request.url);
      if (pathname === '/health' && request.method === 'GET') {
        await docker.request('GET', '/_ping', undefined, 128, 2000);
        return json({ status: 'ok' });
      }
      if (pathname === '/computers' && request.method === 'GET') return json({ computers: await manager.observe() });
      if (pathname === '/computers' && request.method === 'POST') {
        const input = await body(request);
        if (!input || typeof input !== 'object' || !('id' in input) || !('name' in input) || typeof input.id !== 'string' || typeof input.name !== 'string') throw new ResourceError(400, 'Invalid computer request.');
        await manager.create(input.id, input.name);
        return json({ created: true }, 201);
      }
      const match = /^\/computers\/([^/]+)(\/preview|\/input)?$/.exec(pathname);
      if (!match) return json({ message: 'Not found.' }, 404);
      const id = decodeURIComponent(match[1]);
      if (request.method === 'DELETE' && !match[2]) {
        const input = await body(request);
        if (!input || typeof input !== 'object' || !('name' in input) || typeof input.name !== 'string') throw new ResourceError(400, 'Invalid computer deletion.');
        await manager.remove(id, input.name);
        return json({ deleted: true });
      }
      if (request.method === 'POST' && match[2] === '/input') {
        const input = await body(request);
        if (!input || typeof input !== 'object' || !('x' in input) || !('y' in input) ||
            typeof input.x !== 'number' || typeof input.y !== 'number') throw new ResourceError(400, 'Invalid desktop coordinates.');
        await manager.pointer(id, input.x, input.y);
        return json({ accepted: true }, 202);
      }
      if (request.method === 'GET' && match[2] === '/preview') {
        const full = searchParams.get('full');
        if (full !== null && full !== '1') throw new ResourceError(400, 'Invalid preview size.');
        const image = await manager.preview(id, full === '1');
        if (!image) return json({ message: 'Computer preview unavailable.' }, 503);
        return new Response(new Uint8Array(image), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' } });
      }
      return json({ message: 'Method not allowed.' }, 405);
    } catch (error) {
      const status = error instanceof ResourceError ? error.code : error instanceof DockerApiError && error.status === 404 ? 404 : 503;
      // Docker's raw errors may include host paths; never return them to the API/browser.
      const message = error instanceof ResourceError ? error.message : 'Computer operation failed.';
      console.error('computer-controller:', error instanceof Error ? error.message : String(error));
      return json({ message }, status);
    }
  },
});
