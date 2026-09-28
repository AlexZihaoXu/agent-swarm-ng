import { controllerHeaders } from './controller-auth';
import { fetchComputerFile, type FileOperation, type FileQuery, type FileResult } from './computer-files';
import type { ComputerSettings } from './computer-store';
import { HttpComputerRuntime } from './computer-use/runtime-client';
import type { ComputerRuntime } from './computer-use/service';

export type ComputerObservation = {
  status: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryLimitBytes: number | null;
  cpuCount: number | null;
  displayServer?: 'x11' | 'wayland';
};
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
  limits(): Promise<ComputerLimits>;
  create(id: string, name: string, settings: ComputerSettings): Promise<void>;
  remove(id: string, name: string): Promise<void>;
  observe(): Promise<Map<string, ComputerObservation>>;
  preview(id: string, full?: boolean): Promise<Uint8Array | null>;
  pointer(id: string, x: number, y: number): Promise<void>;
  start(id: string, name: string): Promise<void>;
  stop(id: string, name: string): Promise<void>;
  updateResources(id: string, name: string, settings: Pick<ComputerSettings, 'cpuCores' | 'memoryGiB'>): Promise<void>;
  replaceStopped(id: string, name: string, settings: ComputerSettings): Promise<void>;
}

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
      signal: AbortSignal.timeout(timeout),
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
  terminalSocket(id: string, session: string) {
    const url = new URL(
      `/computers/${encodeURIComponent(id)}/terminals/${encodeURIComponent(session)}/stream`,
      this.baseUrl,
    );
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return new WebSocket(url, { headers: controllerHeaders() } as unknown as string[]);
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
  async create(id: string, name: string, settings: ComputerSettings) {
    await this.request('/computers', { method: 'POST', body: JSON.stringify({ id, name, settings }) }, 120_000);
  }
  async remove(id: string, name: string) {
    await this.request(
      `/computers/${encodeURIComponent(id)}`,
      { method: 'DELETE', body: JSON.stringify({ name }) },
      60_000,
    );
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
  async replaceStopped(id: string, name: string, settings: ComputerSettings) {
    await this.request(
      `/computers/${encodeURIComponent(id)}/settings/replacement`,
      { method: 'POST', body: JSON.stringify({ name, ...settings }) },
      60_000,
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
