import { mkdir, readdir, readFile, stat, writeFile, rename, unlink, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScreenFrame } from './service';
export type ScreenshotReference = { id: string; agentId: string; mimeType: 'image/jpeg' | 'image/png'; width: number; height: number; bounds: number[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const namePattern = /^[0-9a-f-]{36}_[0-9a-f-]{36}\.(jpg|png)$/i;

/** One app-owned pool; immutable files, no model-supplied path, FIFO not LRU. */
export class ScreenshotPool {
  private queue: Promise<unknown> = Promise.resolve();
  private maximum: number;
  private evict: number;
  constructor(readonly directory: string, limits = { maximum: 50_000_000, evict: 10_000_000 }) {
    this.maximum = limits.maximum; this.evict = limits.evict;
  }
  put(agentId: string, frame: ScreenFrame): Promise<ScreenshotReference> {
    const operation = this.queue.then(async () => {
      if (!uuid.test(agentId)) throw new Error('Invalid screenshot owner.');
      if (!frame.data.byteLength || frame.data.byteLength >= this.maximum) throw new Error('Screenshot too large for the image pool.');
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const files = await this.files();
      let size = files.reduce((sum, file) => sum + file.size, 0);
      const target = size + frame.data.byteLength >= this.maximum ? Math.max(this.evict, size + frame.data.byteLength - this.maximum + 1) : 0;
      let removed = 0;
      for (const file of files) {
        if (removed >= target) break;
        await unlink(join(this.directory, file.name)); removed += file.size; size -= file.size;
      }
      const id = crypto.randomUUID();
      const path = join(this.directory, `${agentId}_${id}.${frame.mimeType === 'image/png' ? 'png' : 'jpg'}`);
      const temporary = `${path}.tmp`;
      try {
        await writeFile(temporary, frame.data, { mode: 0o600, flag: 'wx' });
        await rename(temporary, path);
        // Keep a total insertion order even for same-clock-tick writes/restarts.
        const timestamp = new Date(Math.max(Date.now(), Math.ceil(files.at(-1)?.time ?? 0) + 1));
        await utimes(path, timestamp, timestamp);
      } finally { await unlink(temporary).catch(() => {}); }
      return { id, agentId, mimeType: frame.mimeType, width: frame.width, height: frame.height, bounds: [...frame.bounds] };
    });
    this.queue = operation.catch(() => {}); return operation;
  }
  private async files() {
    const names = await readdir(this.directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
    return (await Promise.all(names.filter(name => namePattern.test(name)).map(async name => { const info = await stat(join(this.directory, name)); return { name, size: info.size, time: info.mtimeMs }; }))).sort((a,b) => a.time - b.time || a.name.localeCompare(b.name));
  }
  async read(agentId: string, id: string) {
    if (!uuid.test(agentId) || !uuid.test(id)) return null;
    for (const extension of ['jpg', 'png']) {
      try {
        const data = await readFile(join(this.directory, `${agentId}_${id}.${extension}`));
        if (data.byteLength >= this.maximum) return null;
        return { data, mimeType: extension === 'png' ? 'image/png' as const : 'image/jpeg' as const };
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return null;
  }
  async removeAgent(agentId: string) {
    if (!uuid.test(agentId)) return;
    const operation = this.queue.then(async () => { for (const file of await this.files()) if (file.name.startsWith(`${agentId}_`)) await unlink(join(this.directory, file.name)); });
    this.queue = operation.catch(() => {}); await operation;
  }
}
