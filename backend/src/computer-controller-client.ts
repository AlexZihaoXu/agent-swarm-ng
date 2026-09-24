export type ComputerObservation = { status: string; cpuPercent: number | null; memoryBytes: number | null };

export interface ComputerController {
  create(id: string, name: string): Promise<void>;
  remove(id: string, name: string): Promise<void>;
  observe(): Promise<Map<string, ComputerObservation>>;
  preview(id: string, full?: boolean): Promise<Uint8Array | null>;
  pointer(id: string, x: number, y: number): Promise<void>;
}

/** Internal controller only; the browser cannot choose its Docker endpoint. */
export class HttpComputerController implements ComputerController {
  constructor(private readonly baseUrl: string, private readonly fetcher: typeof fetch = fetch) {}

  private async request(path: string, init: RequestInit = {}, timeout = 10_000) {
    const response = await this.fetcher(new URL(path, this.baseUrl), {
      ...init, signal: AbortSignal.timeout(timeout), redirect: 'error',
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    });
    if (!response.ok) throw new Error(`Computer controller returned ${response.status}.`);
    return response;
  }
  async create(id: string, name: string) {
    await this.request('/computers', { method: 'POST', body: JSON.stringify({ id, name }) }, 120_000);
  }
  async remove(id: string, name: string) {
    await this.request(`/computers/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ name }) }, 60_000);
  }
  async observe() {
    const response = await this.request('/computers');
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('computers' in data) || !Array.isArray(data.computers) || data.computers.length > 100) throw new Error('Invalid computer observations.');
    const result = new Map<string, ComputerObservation>();
    for (const item of data.computers) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.status !== 'string') throw new Error('Invalid computer observation.');
      result.set(item.id, { status: item.status, cpuPercent: item.cpuPercent ?? null, memoryBytes: item.memoryBytes ?? null });
    }
    return result;
  }
  async pointer(id: string, x: number, y: number) {
    await this.request(`/computers/${encodeURIComponent(id)}/input`, {
      method: 'POST', body: JSON.stringify({ x, y }),
    });
  }
  async preview(id: string, full = false) {
    const path = `/computers/${encodeURIComponent(id)}/preview${full ? '?full=1' : ''}`;
    const response = await this.fetcher(new URL(path, this.baseUrl), { signal: AbortSignal.timeout(16_000), redirect: 'error' });
    if (response.status === 404 || response.status === 503) return null;
    if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'image/jpeg') throw new Error('Computer preview is unavailable.');
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
    } finally { reader.releaseLock(); }
    const frame = Buffer.concat(chunks);
    if (frame.length < 4 || frame[0] !== 0xff || frame[1] !== 0xd8 || frame.at(-2) !== 0xff || frame.at(-1) !== 0xd9) throw new Error('Computer preview is not a JPEG.');
    return frame;
  }
}
