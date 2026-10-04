import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { databaseFile } from './database-location';
import { randomUUID } from 'node:crypto';

/** A saved model connection. It belongs to a person (`ownerId`, admin for older rows); ids are unique per person. */
export type SavedEndpoint = { id: string; name: string; baseUrl: string; apiKey: string; ownerId?: string };
export const endpointView = ({ apiKey, ownerId: _, ...endpoint }: SavedEndpoint) => ({
  ...endpoint,
  hasApiKey: Boolean(apiKey),
});
const ownerOf = (row: SavedEndpoint) => row.ownerId ?? 'admin';

export class EndpointStore {
  private queue: Promise<unknown> = Promise.resolve();
  // Saved API keys live beside the database, so DATABASE_URL relocates both (tests and dev runs never touch the real keys).
  constructor(private path = join(dirname(databaseFile()), 'endpoints.json')) {}

  async read(): Promise<SavedEndpoint[]> {
    try {
      const data: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (
        !Array.isArray(data) ||
        !data.every(
          row =>
            row &&
            ['id', 'name', 'baseUrl', 'apiKey'].every(key => typeof row[key] === 'string') &&
            (row.ownerId === undefined || typeof row.ownerId === 'string'),
        )
      )
        throw new Error();
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

  /** One person's endpoints (docs/users.md): nobody sees another's. */
  async readFor(ownerId: string) {
    return (await this.read()).filter(row => ownerOf(row) === ownerId);
  }

  async save(input: { id: string; name: string; baseUrl: string; apiKey?: string }, ownerId = 'admin') {
    const mine = (row: SavedEndpoint) => row.id === input.id && ownerOf(row) === ownerId;
    const rows = await this.update(current => {
      const previous = current.find(mine);
      const endpoint: SavedEndpoint = {
        id: input.id,
        name: input.name,
        baseUrl: input.baseUrl,
        // Never silently carry a saved credential to a different URL.
        apiKey: input.apiKey ?? (previous?.baseUrl === input.baseUrl ? previous.apiKey : ''),
        ownerId,
      };
      return [...current.filter(row => !mine(row)), endpoint];
    });
    return rows.find(mine)!;
  }

  async remove(id: string, ownerId = 'admin') {
    await this.update(rows => rows.filter(row => !(row.id === id && ownerOf(row) === ownerId)));
  }

  /** Every endpoint of a person (their account is being deleted). */
  async removeOwner(ownerId: string) {
    await this.update(rows => rows.filter(row => ownerOf(row) !== ownerId));
  }
}
