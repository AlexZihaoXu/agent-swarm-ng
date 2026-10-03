import { DockerApi, DockerApiError } from './docker-api';
import { ComputerManager } from './manager';
import { ResourceError } from './resources';
import type { ComputerConfiguration } from './computer-configuration';
import { ComputerUseService } from './computer-use-service';
import { MAX_USE_BODY } from './computer-use';
import { ComputerCoreService } from './computer-core-service';
import type { RecordingOp } from './recording';
import { fileAttachment, type FileOperation } from './operator-files';
import { terminalSockets, type TerminalSocket } from './terminal-stream';
import { authorized } from './auth';
import { parseExtraDisks, validateRequestedPaths } from './disks';

process.umask(0o077);
const docker = new DockerApi();
const manager = new ComputerManager(
  docker,
  process.env.COMPUTER_NAMESPACE ?? 'agent-swarm-ng',
  undefined,
  process.env.COMPUTER_IMAGE ?? 'agent-swarm-default:stage2',
  process.env.COMPUTER_EGRESS_IMAGE ?? 'agent-swarm-computer-egress:dev',
  process.env.COMPUTER_MEDIA_IMAGE ?? 'agent-swarm-computer-media:stage2',
  process.env.COMPUTER_RENDER_DEVICE ?? '',
  Number(process.env.COMPUTER_CPU_LIMIT ?? 2),
  process.env.COMPUTER_TIMEZONE ?? '',
);
// Boot-time reconciliation starts only our labelled computers, always after
// their filtered egress sidecars. No model inference or agent work is replayed.
await manager.resume();
const terminals = terminalSockets(manager);
// Extra host paths the operator wants on the dashboard's disk chart (.env), measured read-only.
const extraDisks = parseExtraDisks(process.env.DASHBOARD_EXTRA_DISKS);
if (extraDisks.invalid.length)
  console.error('computer-controller: DASHBOARD_EXTRA_DISKS skips paths that are not plain absolute paths.');
const computerCore = new ComputerCoreService((id, mode, input) => manager.computerCoreExec(id, mode, input));
const computerUse = new ComputerUseService((id, mode, input) => manager.computerUseExec(id, mode, input));
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

/** A request body as chunks (this Bun's async iteration of a streaming request body is broken). */
async function* chunks(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* this Bun's request-body reader cannot always release its lock; the request ends anyway */
    }
  }
}

async function body(request: Request, maxBytes = 4096): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new ResourceError(400, 'A JSON body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new ResourceError(400, 'Request is too large.');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new ResourceError(400, 'Invalid JSON.');
  }
}

Bun.serve<TerminalSocket>({
  websocket: terminals.handlers,
  hostname: '0.0.0.0',
  port: Number(process.env.COMPUTER_CONTROLLER_PORT ?? 3101),
  idleTimeout: 150,
  // Agent file copies stream up to the 1 GiB transfer bound.
  maxRequestBodySize: 1025 * 1024 * 1024,
  async fetch(request, server) {
    try {
      const { pathname, searchParams } = new URL(request.url);
      if (!authorized(request, undefined, pathname)) return json({ message: 'Unauthorized.' }, 401);
      if (pathname === '/health' && request.method === 'GET') {
        await docker.request('GET', '/_ping', undefined, 128, 2000);
        return json({ status: 'ok' });
      }
      if (pathname === '/computers/settings-limits' && request.method === 'GET') return json(await manager.limits());
      if (pathname === '/computers' && request.method === 'GET') return json({ computers: await manager.observe() });
      if (pathname === '/computers' && request.method === 'POST') {
        const input = await body(request);
        if (
          !input ||
          typeof input !== 'object' ||
          !('id' in input) ||
          !('name' in input) ||
          typeof input.id !== 'string' ||
          typeof input.name !== 'string'
        )
          throw new ResourceError(400, 'Invalid computer request.');
        if (
          'settings' in input &&
          (!input.settings || typeof input.settings !== 'object' || Array.isArray(input.settings))
        )
          throw new ResourceError(400, 'Invalid computer settings.');
        if (
          'maxComputers' in input &&
          input.maxComputers !== undefined &&
          (!Number.isInteger(input.maxComputers) || (input.maxComputers as number) < 1)
        )
          throw new ResourceError(400, 'Invalid computer limit.');
        await manager.create(
          input.id,
          input.name,
          'settings' in input ? (input.settings as ComputerConfiguration) : undefined,
          'maxComputers' in input ? (input.maxComputers as number | undefined) : undefined,
          'storage' in input ? input.storage : undefined,
        );
        return json({ created: true }, 201);
      }
      // Dashboard disk usage: Docker's root and the operator's list are added here, never chosen by the caller.
      if (pathname === '/metrics/disks' && request.method === 'POST') {
        const input = await body(request);
        if (!input || typeof input !== 'object' || !('paths' in input))
          throw new ResourceError(400, 'Invalid disk paths.');
        return json(await manager.diskUsage(validateRequestedPaths(input.paths), extraDisks.paths));
      }
      if (pathname === '/computers/storage/check' && request.method === 'POST') {
        const input = await body(request);
        if (
          !input ||
          typeof input !== 'object' ||
          !('kind' in input) ||
          (input.kind !== 'keep' && input.kind !== 'cache') ||
          !('folder' in input) ||
          typeof input.folder !== 'string'
        )
          throw new ResourceError(400, 'Invalid storage check.');
        await manager.checkFolder(input.kind, input.folder);
        return json({ ready: true });
      }
      const terminalMatch = /^\/computers\/([^/]+)\/terminals\/([^/]+)\/stream$/.exec(pathname);
      if (terminalMatch) {
        if (request.method !== 'GET' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
          return json({ message: 'WebSocket required.' }, 400);
        const data = terminals.reserve(decodeURIComponent(terminalMatch[1]), decodeURIComponent(terminalMatch[2]));
        if (server.upgrade(request, { data })) return;
        data.opening = false;
        terminals.release(data);
        return json({ message: 'Terminal upgrade failed.' }, 400);
      }
      // A monitor: the command's stdout as a stream; a final line "\0exit {code, stderr}" says how it ended. Closing
      // the stream (the backend stopped the monitor) kills the command's process group in the guest.
      const monitorMatch = /^\/computers\/([^/]+)\/monitor$/.exec(pathname);
      if (monitorMatch) {
        if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);
        const input = await body(request);
        if (!input || typeof input !== 'object' || !('command' in input))
          throw new ResourceError(400, 'Invalid monitor request.');
        const abort = new AbortController();
        request.signal?.addEventListener('abort', () => abort.abort(), { once: true });
        let output!: ReadableStreamDefaultController<Uint8Array>;
        let stderr = '';
        let code: number | null = null;
        const encoder = new TextEncoder();
        // A quiet command (waiting for an error that has not happened) must not look like a dead connection to this
        // server's or the backend's idle limits: a heartbeat line every 30 s, which the backend skips.
        const heartbeat = setInterval(() => {
          try {
            output.enqueue(encoder.encode('\0ping\n'));
          } catch {
            clearInterval(heartbeat);
          }
        }, 30_000);
        abort.signal.addEventListener('abort', () => clearInterval(heartbeat), { once: true });
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            output = controller;
          },
          cancel() {
            abort.abort();
          },
        });
        try {
          await manager.monitorStream(
            decodeURIComponent(monitorMatch[1]),
            input.command,
            abort.signal,
            chunk => output.enqueue(new Uint8Array(chunk)),
            chunk => {
              stderr = (stderr + chunk.toString()).slice(-4000);
              const exit = /\0monitor-exit (\d+)\n/.exec(stderr);
              if (exit) {
                code = Number(exit[1]);
                stderr = stderr.slice(0, exit.index);
              }
            },
            () => {
              clearInterval(heartbeat);
              try {
                // Only a command that really exited says so; a stopped computer or broken exec just ends the stream.
                if (code !== null)
                  output.enqueue(encoder.encode(`\n\0exit ${JSON.stringify({ code, stderr: stderr.slice(-2000) })}\n`));
                output.close();
              } catch {
                /* the reader is gone */
              }
            },
          );
        } catch (error) {
          abort.abort();
          throw error;
        }
        server.timeout(request, 0);
        return new Response(stream, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }
      // Agent file copies: stream one guest file out, or one file in (bytes never buffered here).
      const transferMatch = /^\/computers\/([^/]+)\/(export|import)$/.exec(pathname);
      if (transferMatch) {
        const id = decodeURIComponent(transferMatch[1]);
        if (transferMatch[2] === 'export') {
          if (request.method !== 'GET') return json({ message: 'Method not allowed.' }, 405);
          const file = await manager.exportFile(
            id,
            searchParams.get('path') ?? '',
            Number(searchParams.get('max') ?? 0),
          );
          return new Response(
            new ReadableStream<Uint8Array>({
              async pull(controller) {
                try {
                  const next = await file.stream.next();
                  if (next.done) controller.close();
                  else controller.enqueue(next.value);
                } catch (error) {
                  controller.error(error);
                }
              },
              async cancel() {
                file.close();
                await file.stream.return(undefined);
              },
            }),
            {
              headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Length': String(file.size),
                // Bun sends streamed bodies chunked (dropping Content-Length), so the size also travels here.
                'X-File-Size': String(file.size),
                'X-File-Name': encodeURIComponent(file.name),
                'Cache-Control': 'no-store',
              },
            },
          );
        }
        if (request.method !== 'PUT') return json({ message: 'Method not allowed.' }, 405);
        if (!request.body) return json({ message: 'A file body is required.' }, 400);
        return json(
          await manager.importFile(
            id,
            searchParams.get('path') ?? '',
            Number(searchParams.get('size')),
            chunks(request.body),
          ),
        );
      }
      const fileMatch = /^\/computers\/([^/]+)\/(files|file-preview|download)$/.exec(pathname);
      if (fileMatch) {
        if (request.method !== 'GET') return json({ message: 'Method not allowed.' }, 405);
        const mode = fileMatch[2] as FileOperation;
        const output = await manager.operatorFiles(decodeURIComponent(fileMatch[1]), mode, {
          path: searchParams.get('path') ?? '',
          offset: searchParams.has('offset') ? Number(searchParams.get('offset')) : undefined,
          filter: searchParams.get('filter') ?? undefined,
        });
        if (output.bytes !== null)
          return new Response(new Uint8Array(output.bytes), {
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Disposition': fileAttachment(output.result.name),
              'Cache-Control': 'no-store',
              'X-Content-Type-Options': 'nosniff',
            },
          });
        return json(output.result);
      }
      const recordingMatch = /^\/computers\/([^/]+)\/recording\/(start|mark|update|stop|list|terminals)$/.exec(
        pathname,
      );
      if (recordingMatch) {
        if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);
        const id = decodeURIComponent(recordingMatch[1]);
        return json(await manager.recording(id, recordingMatch[2] as RecordingOp, await body(request, 32 * 1024)));
      }
      const coreMatch = /^\/computers\/([^/]+)\/core\/(prepare|execute|cancel)$/.exec(pathname);
      if (coreMatch) {
        if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);
        const id = decodeURIComponent(coreMatch[1]),
          input = await body(request, MAX_USE_BODY);
        if (coreMatch[2] === 'prepare') return json(await computerCore.prepare(id, input));
        if (coreMatch[2] === 'execute') return json(await computerCore.execute(id, input));
        return json(await computerCore.cancel(id));
      }
      const useMatch = /^\/computers\/([^/]+)\/(capture|actions|actions\/validate|actions\/cancel)$/.exec(pathname);
      if (useMatch) {
        if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);
        const id = decodeURIComponent(useMatch[1]);
        const input = await body(request, MAX_USE_BODY);
        switch (useMatch[2]) {
          case 'capture':
            return json(await computerUse.capture(id, input));
          case 'actions/validate':
            return json(await computerUse.validate(id, input));
          case 'actions':
            return json(await computerUse.execute(id, input));
          case 'actions/cancel':
            return json(await computerUse.cancel(id));
        }
      }
      const match =
        /^\/computers\/([^/]+)(\/preview|\/input|\/power|\/settings|\/settings\/replacement|\/cache\/clear|\/storage)?$/.exec(
          pathname,
        );
      if (!match) return json({ message: 'Not found.' }, 404);
      const id = decodeURIComponent(match[1]);
      if (request.method === 'DELETE' && !match[2]) {
        const input = await body(request);
        if (!input || typeof input !== 'object' || !('name' in input) || typeof input.name !== 'string')
          throw new ResourceError(400, 'Invalid computer deletion.');
        await manager.remove(id, input.name, 'storage' in input ? input.storage : undefined);
        return json({ deleted: true });
      }
      if (request.method === 'POST' && (match[2] === '/cache/clear' || match[2] === '/storage')) {
        const input = await body(request);
        if (!input || typeof input !== 'object' || !('name' in input) || typeof input.name !== 'string')
          throw new ResourceError(400, 'Invalid storage request.');
        if (match[2] === '/cache/clear') {
          await manager.clearCache(id, input.name);
          return json({ cleared: true });
        }
        return json(await manager.storageUsage(id, input.name));
      }
      if (request.method === 'POST' && match[2] === '/power') {
        // Power control keeps the expected name so a renamed or foreign
        // container is refused by the ownership check, exactly like deletion.
        const input = await body(request);
        if (
          !input ||
          typeof input !== 'object' ||
          !('name' in input) ||
          typeof input.name !== 'string' ||
          !('action' in input) ||
          (input.action !== 'start' && input.action !== 'stop')
        )
          throw new ResourceError(400, 'Invalid power request.');
        if (input.action === 'start') await manager.start(id, input.name);
        else await manager.stop(id, input.name);
        return json({ action: input.action, accepted: true }, 202);
      }
      if (request.method === 'POST' && match[2] === '/settings/replacement') {
        const input = await body(request);
        if (
          !input ||
          typeof input !== 'object' ||
          !('name' in input) ||
          typeof input.name !== 'string' ||
          !('cpuCores' in input) ||
          !('memoryGiB' in input) ||
          !('timezone' in input)
        )
          throw new ResourceError(400, 'Invalid computer settings.');
        if ('image' in input && input.image !== 'current' && input.image !== 'same')
          throw new ResourceError(400, 'Invalid computer image choice.');
        await manager.replaceStopped(
          id,
          input.name,
          {
            cpuCores: input.cpuCores as number,
            memoryGiB: input.memoryGiB as number,
            timezone: input.timezone as string,
          },
          {
            ...('image' in input ? { image: input.image as 'current' | 'same' } : {}),
            ...('keptPaths' in input ? { keptPaths: input.keptPaths } : {}),
          },
        );
        return json({ replaced: true });
      }
      if (request.method === 'PATCH' && match[2] === '/settings') {
        const input = await body(request);
        if (
          !input ||
          typeof input !== 'object' ||
          !('name' in input) ||
          typeof input.name !== 'string' ||
          !('cpuCores' in input) ||
          !('memoryGiB' in input)
        )
          throw new ResourceError(400, 'Invalid computer settings.');
        await manager.updateResources(id, input.name, {
          cpuCores: input.cpuCores as number,
          memoryGiB: input.memoryGiB as number,
        });
        return json({ updated: true });
      }
      if (request.method === 'POST' && match[2] === '/input') {
        const input = await body(request);
        if (
          !input ||
          typeof input !== 'object' ||
          !('x' in input) ||
          !('y' in input) ||
          typeof input.x !== 'number' ||
          typeof input.y !== 'number'
        )
          throw new ResourceError(400, 'Invalid desktop coordinates.');
        await manager.pointer(id, input.x, input.y);
        return json({ accepted: true }, 202);
      }
      if (request.method === 'GET' && match[2] === '/preview') {
        const full = searchParams.get('full');
        if (full !== null && full !== '1') throw new ResourceError(400, 'Invalid preview size.');
        const image = await manager.preview(id, full === '1');
        if (!image) return json({ message: 'Computer preview unavailable.' }, 503);
        return new Response(new Uint8Array(image), {
          headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' },
        });
      }
      return json({ message: 'Method not allowed.' }, 405);
    } catch (error) {
      const status =
        error instanceof ResourceError
          ? error.code
          : error instanceof DockerApiError && error.status === 404
            ? 404
            : 503;
      // Docker's raw errors may include host paths; never return them to the API/browser.
      const message = error instanceof ResourceError ? error.message : 'Computer operation failed.';
      console.error('computer-controller:', error instanceof Error ? error.message : String(error));
      return json({ message }, status);
    }
  },
});
if (!process.env.COMPUTER_CONTROLLER_TOKEN)
  console.error('computer-controller: COMPUTER_CONTROLLER_TOKEN is not set; refusing every request but GET /health.');
