import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export type SavedEndpoint = { id: string; name: string; baseUrl: string; apiKey: string };
export const endpointView = ({ apiKey, ...endpoint }: SavedEndpoint) => ({ ...endpoint, hasApiKey: Boolean(apiKey) });

export class EndpointStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private path = fileURLToPath(new URL('../../.local/endpoints.json', import.meta.url))) {}

  async read(): Promise<SavedEndpoint[]> {
    try {
      const data: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!Array.isArray(data) || !data.every(row => row && ['id', 'name', 'baseUrl', 'apiKey'].every(key => typeof row[key] === 'string'))) throw new Error();
      return data;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
      throw new Error('Could not read endpoint preferences.');
    }
  }

  private update(change: (rows: SavedEndpoint[]) => SavedEndpoint[]) {
    const work = this.queue.then(async () => {
      const rows = change(await this.read());
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(rows, null, 2), { mode: 0o600 });
      await rename(temporary, this.path);
      return rows;
    });
    this.queue = work.catch(() => {});
    return work;
  }

  async save(input: { id: string; name: string; baseUrl: string; apiKey?: string }) {
    const rows = await this.update(current => {
      const previous = current.find(row => row.id === input.id);
      const endpoint: SavedEndpoint = {
        id: input.id, name: input.name, baseUrl: input.baseUrl,
        // Never silently carry a saved credential to a different URL.
        apiKey: input.apiKey ?? (previous?.baseUrl === input.baseUrl ? previous.apiKey : ''),
      };
      return [...current.filter(row => row.id !== input.id), endpoint];
    });
    return rows.find(row => row.id === input.id)!;
  }

  async remove(id: string) { await this.update(rows => rows.filter(row => row.id !== id)); }
}
