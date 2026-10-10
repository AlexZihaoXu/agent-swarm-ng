import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { databaseFile } from './database-location';
import { CODEX_ACCOUNT_PATTERN, MAX_CODEX_ACCOUNTS } from './codex-provider';

type Row = { id: string; ownerId: string };

/**
 * The ChatGPT accounts people added after their first (docs/users.md#model-connections), beside the database like
 * the endpoints: only ids and owners; each account's login is in its own files (codexFiles).
 */
export class CodexAccounts {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private path = join(dirname(databaseFile()), 'openai-accounts.json')) {}

  private async read(): Promise<Row[]> {
    try {
      const data: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (
        !Array.isArray(data) ||
        !data.every(row => row && CODEX_ACCOUNT_PATTERN.test(row.id) && typeof row.ownerId === 'string')
      )
        throw new Error();
      return data;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
      throw new Error('Could not read the ChatGPT accounts.');
    }
  }

  private update<T>(change: (rows: Row[]) => { rows: Row[]; result: T }) {
    const work = this.queue.then(async () => {
      const { rows, result } = change(await this.read());
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(rows, null, 2), { mode: 0o600 });
      await rename(temporary, this.path);
      return result;
    });
    this.queue = work.catch(() => {});
    return work;
  }

  /** A person's added accounts, oldest first (the first account, '', is not listed). */
  async readFor(ownerId: string) {
    return (await this.read()).filter(row => row.ownerId === ownerId).map(row => row.id);
  }

  /** A new account for the person, or null at the most they may have. */
  add(ownerId: string) {
    return this.update(rows => {
      if (rows.filter(row => row.ownerId === ownerId).length + 1 >= MAX_CODEX_ACCOUNTS) return { rows, result: null };
      let id: string;
      do id = randomBytes(4).toString('hex');
      while (rows.some(row => row.id === id));
      return { rows: [...rows, { id, ownerId }], result: id };
    });
  }

  /** Whether it was the person's. */
  remove(ownerId: string, id: string) {
    return this.update(rows => {
      const kept = rows.filter(row => !(row.ownerId === ownerId && row.id === id));
      return { rows: kept, result: kept.length < rows.length };
    });
  }

  /** Removes all of a person's, returning their ids. */
  removeOwner(ownerId: string) {
    return this.update(rows => ({
      rows: rows.filter(row => row.ownerId !== ownerId),
      result: rows.filter(row => row.ownerId === ownerId).map(row => row.id),
    }));
  }
}
