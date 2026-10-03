import { controllerHeaders } from './controller-auth';
import { fetchComputerFile, type FileOperation, type FileQuery, type FileResult } from './computer-files';
import type { ComputerSettings, ComputerStorage } from './computer-store';
import { HttpComputerRuntime } from './computer-use/runtime-client';
import type { ComputerRuntime } from './computer-use/service';

export type ComputerObservation = {
  status: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryLimitBytes: number | null;
  cpuCount: number | null;
  displayServer?: 'x11' | 'wayland';
  /** Made from an older image than the current one (Update image brings it up to date). */
  outdated?: boolean;
};
/** One host path the controller measured for the dashboard (computer-controller/src/disks.ts). */
export type ControllerDisk = { path: string; use: 'docker' | 'listed' | 'requested' } & (
  { source: string; fstype: string; size: number; used: number; avail: number } | { error: 'unavailable' }
);
export type ControllerDisks = { disks: ControllerDisk[]; zfs: { dataset: string; used: number; avail: number }[] };
export type StorageUsage = { kind: 'keep' | 'cache'; bytes: number; folder: string | null };
export type ComputerLimits = {
  cpuCores: { min: number; max: number; default: number };
  memoryGiB: { min: number; max: number; default: number };
  timezoneDefault: string;
  maxComputers?: number;
};

export interface ComputerController {
  readonly runtime?: ComputerRuntime;
  files?(id: string, mode: FileOperation, query: FileQuery): Promise<FileResult>;
  terminalSocket?(id: string, session: string): WebSocket;
  /** Streams one guest file out, at most `maxBytes` (agent file copies). */
  exportFile?(id: string, path: string, maxBytes: number, signal?: AbortSignal): Promise<GuestFile>;
  /** Writes one file into an existing guest folder. */
  importFile?(
    id: string,
    path: string,
    size: number,
    body: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<{ path: string; size: number }>;
  /** Agent recordings inside the guest (recording.py). */
  recording?(
    id: string,
    op: 'start' | 'mark' | 'update' | 'stop' | 'list' | 'terminals',
    input: object,
  ): Promise<Record<string, any>>;
  limits(): Promise<ComputerLimits>;
  create(
    id: string,
    name: string,
    settings: ComputerSettings,
    maxComputers?: number,
    storage?: ComputerStorage,
  ): Promise<void>;
  remove(id: string, name: string, storage?: ComputerStorage): Promise<void>;
  checkStorageFolder?(kind: 'keep' | 'cache', folder: string): Promise<void>;
  clearCache?(id: string, name: string): Promise<void>;
  storageUsage?(id: string, name: string): Promise<{ lastStart: string | null; storage: StorageUsage[] }>;
  /** Disk usage of Docker's data root, the operator's DASHBOARD_EXTRA_DISKS and these marked Keep/Cache folders (≤ 16). */
  diskUsage?(paths: string[]): Promise<ControllerDisks>;
  /** A monitor's output stream (see the controller's /monitor), open until `signal` aborts or `lifetimeMs` passes. */
  monitor?(id: string, command: string, signal: AbortSignal, lifetimeMs: number): Promise<ReadableStream<Uint8Array>>;
  observe(): Promise<Map<string, ComputerObservation>>;
  preview(id: string, full?: boolean): Promise<Uint8Array | null>;
  pointer(id: string, x: number, y: number): Promise<void>;
  start(id: string, name: string): Promise<void>;
  stop(id: string, name: string): Promise<void>;
  updateResources(id: string, name: string, settings: Pick<ComputerSettings, 'cpuCores' | 'memoryGiB'>): Promise<void>;
  replaceStopped(
    id: string,
    name: string,
    settings: ComputerSettings,
    options?: { image?: 'current' | 'same'; keptPaths?: string[] },
  ): Promise<void>;
}

/** A fetch request body from any byte source (this Bun has no ReadableStream.from). */
export function streamOf(source: AsyncIterable<Uint8Array>) {
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

export type GuestFile = { name: string; size: number; stream: AsyncIterable<Uint8Array> };

/** A rejection the controller itself explained (its ResourceError messages are operator-safe). */
export class ControllerError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Internal controller only; the browser cannot choose its Docker endpoint. */
export class HttpComputerController implements ComputerController {
  readonly runtime: HttpComputerRuntime;
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.runtime = new HttpComputerRuntime(baseUrl, fetcher);
  }

  private async request(path: string, init: RequestInit = {}, timeout = 10_000) {
    const response = await this.fetcher(new URL(path, this.baseUrl), {
      ...init,
      signal: init.signal ? AbortSignal.any([AbortSignal.timeout(timeout), init.signal]) : AbortSignal.timeout(timeout),
      redirect: 'error',
      headers: {
        ...controllerHeaders(),
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      let message = `Computer controller returned ${response.status}.`;
      try {
        const body: unknown = JSON.parse(new TextDecoder().decode((await response.arrayBuffer()).slice(0, 4096)));
        if (
          body &&
          typeof body === 'object' &&
          'message' in body &&
          typeof body.message === 'string' &&
          body.message.trim()
        )
          message = body.message.slice(0, 200);
      } catch {
        /* keep the generic message */
      }
      throw new ControllerError(response.status, message);
    }
    return response;
  }
  async monitor(id: string, command: string, signal: AbortSignal, lifetimeMs: number) {
    const response = await this.request(
      `/computers/${encodeURIComponent(id)}/monitor`,
      // Bun's fetch otherwise gives up on a body silent for 5 minutes; the controller also sends a heartbeat.
      { method: 'POST', body: JSON.stringify({ command }), signal, timeout: false } as RequestInit,
      lifetimeMs,
    );
    if (!response.body) throw new ControllerError(503, 'The monitor stream is unavailable.');
    return response.body;
  }
  /** Agent recordings (the guest's recording.py); stop may encode for minutes. */
  async recording(id: string, op: 'start' | 'mark' | 'update' | 'stop' | 'list' | 'terminals', input: object) {
    const response = await this.request(
      `/computers/${encodeURIComponent(id)}/recording/${op}`,
      { method: 'POST', body: JSON.stringify(input) },
      op === 'stop' ? 900_000 : 30_000,
    );
    return (await response.json()) as Record<string, any>;
  }
  terminalSocket(id: string, session: string) {
    const url = new URL(
      `/computers/${encodeURIComponent(id)}/terminals/${encodeURIComponent(session)}/stream`,
      this.baseUrl,
    );
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return new WebSocket(url, { headers: controllerHeaders() } as unknown as string[]);
  }
  async exportFile(id: string, path: string, maxBytes: number, signal?: AbortSignal): Promise<GuestFile> {
    const query = new URLSearchParams({ path, max: String(maxBytes) });
    const response = await this.request(`/computers/${encodeURIComponent(id)}/export?${query}`, { signal }, 300_000);
    const length = response.headers.get('x-file-size') ?? response.headers.get('content-length');
    const size = length === null ? NaN : Number(length);
    if (!response.body || !Number.isSafeInteger(size) || size < 0)
      throw new ControllerError(503, 'Invalid file response.');
    return {
      name: decodeURIComponent(response.headers.get('x-file-name') ?? '') || path.split('/').pop() || 'file',
      size,
      stream: response.body as unknown as AsyncIterable<Uint8Array>,
    };
  }
  async importFile(id: string, path: string, size: number, body: AsyncIterable<Uint8Array>, signal?: AbortSignal) {
    const query = new URLSearchParams({ path, size: String(size) });
    const response = await this.request(
      `/computers/${encodeURIComponent(id)}/import?${query}`,
      {
        method: 'PUT',
        body: streamOf(body),
        headers: { 'content-type': 'application/octet-stream' },
        signal,
        duplex: 'half',
      } as RequestInit,
      300_000,
    );
    return (await response.json()) as { path: string; size: number };
  }
  async files(id: string, mode: FileOperation, query: FileQuery) {
    return fetchComputerFile(this.fetcher, this.baseUrl, id, mode, query);
  }
  async limits(): Promise<ComputerLimits> {
    const response = await this.request('/computers/settings-limits');
    const data: unknown = await response.json();
    if (
      !data ||
      typeof data !== 'object' ||
      !('cpuCores' in data) ||
      !('memoryGiB' in data) ||
      !('timezoneDefault' in data) ||
      typeof data.timezoneDefault !== 'string' ||
      !data.cpuCores ||
      !data.memoryGiB ||
      typeof data.cpuCores !== 'object' ||
      typeof data.memoryGiB !== 'object' ||
      !('max' in data.cpuCores) ||
      !('max' in data.memoryGiB) ||
      typeof data.cpuCores.max !== 'number' ||
      typeof data.memoryGiB.max !== 'number'
    )
      throw new Error('Invalid computer capacity.');
    const max = (data as { maxComputers?: unknown }).maxComputers;
    return {
      ...(data as ComputerLimits),
      maxComputers: typeof max === 'number' && Number.isInteger(max) && max > 0 ? max : undefined,
    };
  }
  /** Creates a computer; the controller refuses one past `maxComputers` (the operator's Settings → Swarm limit). */
  async create(id: string, name: string, settings: ComputerSettings, maxComputers?: number, storage?: ComputerStorage) {
    await this.request(
      '/computers',
      { method: 'POST', body: JSON.stringify({ id, name, settings, maxComputers, storage }) },
      120_000,
    );
  }
  /** Deletes the computer with its Keep and Cache folders (which can take a while for large folders). */
  async remove(id: string, name: string, storage?: ComputerStorage) {
    await this.request(
      `/computers/${encodeURIComponent(id)}`,
      { method: 'DELETE', body: JSON.stringify({ name, storage }) },
      660_000,
    );
  }
  /** Whether a host folder can be the Keep or Cache folder (it exists and carries its marker file). */
  async checkStorageFolder(kind: 'keep' | 'cache', folder: string) {
    await this.request('/computers/storage/check', { method: 'POST', body: JSON.stringify({ kind, folder }) }, 60_000);
  }
  async clearCache(id: string, name: string) {
    await this.request(
      `/computers/${encodeURIComponent(id)}/cache/clear`,
      { method: 'POST', body: JSON.stringify({ name }) },
      660_000,
    );
  }
  /** Its Keep/Cache sizes and how its last start went (`ok`, `running`, or `failed: …`, with a time; null if never). */
  async storageUsage(id: string, name: string): Promise<{ lastStart: string | null; storage: StorageUsage[] }> {
    const response = await this.request(
      `/computers/${encodeURIComponent(id)}/storage`,
      { method: 'POST', body: JSON.stringify({ name }) },
      330_000,
    );
    const data = (await response.json()) as { storage?: unknown; lastStart?: unknown };
    if (
      !Array.isArray(data.storage) ||
      !data.storage.every(
        item =>
          item &&
          (item.kind === 'keep' || item.kind === 'cache') &&
          typeof item.bytes === 'number' &&
          (item.folder === null || typeof item.folder === 'string'),
      )
    )
      throw new Error('Invalid storage usage.');
    return {
      lastStart: typeof data.lastStart === 'string' ? data.lastStart.slice(0, 500) : null,
      storage: data.storage as StorageUsage[],
    };
  }
  async diskUsage(paths: string[]): Promise<ControllerDisks> {
    const response = await this.request('/metrics/disks', { method: 'POST', body: JSON.stringify({ paths }) }, 90_000);
    const data = (await response.json()) as Partial<ControllerDisks> | null;
    const bytes = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    if (
      !data ||
      !Array.isArray(data.disks) ||
      !Array.isArray(data.zfs) ||
      !data.disks.every(
        disk =>
          disk &&
          typeof disk.path === 'string' &&
          ['docker', 'listed', 'requested'].includes(disk.use) &&
          ('error' in disk
            ? disk.error === 'unavailable'
            : typeof disk.source === 'string' &&
              typeof disk.fstype === 'string' &&
              bytes(disk.size) &&
              bytes(disk.used) &&
              bytes(disk.avail)),
      ) ||
      !data.zfs.every(item => item && typeof item.dataset === 'string' && bytes(item.used) && bytes(item.avail))
    )
      throw new Error('Invalid disk usage.');
    return data as ControllerDisks;
  }
  async observe() {
    const response = await this.request('/computers');
    const data: unknown = await response.json();
    if (
      !data ||
      typeof data !== 'object' ||
      !('computers' in data) ||
      !Array.isArray(data.computers) ||
      data.computers.length > 100
    )
      throw new Error('Invalid computer observations.');
    const result = new Map<string, ComputerObservation>();
    for (const item of data.computers) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.status !== 'string')
        throw new Error('Invalid computer observation.');
      result.set(item.id, {
        status: item.status,
        cpuPercent: item.cpuPercent ?? null,
        memoryBytes: item.memoryBytes ?? null,
        memoryLimitBytes: item.memoryLimitBytes ?? null,
        cpuCount: item.cpuCount ?? null,
        displayServer:
          item.displayServer === 'x11' || item.displayServer === 'wayland' ? item.displayServer : undefined,
        outdated: item.outdated === true,
      });
    }
    return result;
  }
  async start(id: string, name: string) {
    await this.request(
      `/computers/${encodeURIComponent(id)}/power`,
      { method: 'POST', body: JSON.stringify({ name, action: 'start' }) },
      60_000,
    );
  }
  async stop(id: string, name: string) {
    await this.request(
      `/computers/${encodeURIComponent(id)}/power`,
      { method: 'POST', body: JSON.stringify({ name, action: 'stop' }) },
      45_000,
    );
  }
  async updateResources(id: string, name: string, settings: Pick<ComputerSettings, 'cpuCores' | 'memoryGiB'>) {
    await this.request(
      `/computers/${encodeURIComponent(id)}/settings`,
      { method: 'PATCH', body: JSON.stringify({ name, ...settings }) },
      30_000,
    );
  }
  /** Rebuilds a powered-off computer: new timezone or kept paths, or the current image (`image: 'current'`). */
  async replaceStopped(
    id: string,
    name: string,
    settings: ComputerSettings,
    options: { image?: 'current' | 'same'; keptPaths?: string[] } = {},
  ) {
    await this.request(
      `/computers/${encodeURIComponent(id)}/settings/replacement`,
      { method: 'POST', body: JSON.stringify({ name, ...settings, ...options }) },
      // Newly kept paths are carried over from the old computer first: a large database folder takes minutes.
      900_000,
    );
  }
  async pointer(id: string, x: number, y: number) {
    await this.request(`/computers/${encodeURIComponent(id)}/input`, {
      method: 'POST',
      body: JSON.stringify({ x, y }),
    });
  }
  async preview(id: string, full = false) {
    const path = `/computers/${encodeURIComponent(id)}/preview${full ? '?full=1' : ''}`;
    const response = await this.fetcher(new URL(path, this.baseUrl), {
      signal: AbortSignal.timeout(16_000),
      redirect: 'error',
      headers: controllerHeaders(),
    });
    if (response.status === 404 || response.status === 503) return null;
    if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'image/jpeg')
      throw new Error('Computer preview is unavailable.');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Computer preview is empty.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > (full ? 512 : 256) * 1024) throw new Error('Computer preview exceeded its limit.');
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const frame = Buffer.concat(chunks);
    if (frame.length < 4 || frame[0] !== 0xff || frame[1] !== 0xd8 || frame.at(-2) !== 0xff || frame.at(-1) !== 0xd9)
      throw new Error('Computer preview is not a JPEG.');
    return frame;
  }
}

/** The managed-computer controller is an internal service only; the browser can
 * never choose its Docker endpoint. Absent URL means computers are unavailable. */
export function computerControllerFromEnv(url = process.env.COMPUTER_CONTROLLER_URL): ComputerController | null {
  return url ? new HttpComputerController(url) : null;
}
