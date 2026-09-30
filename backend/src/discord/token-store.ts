import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { databaseFile } from '../database-location';

/** A Discord bot token: three base64url parts. Checked before saving, never shown back. */
export const DISCORD_TOKEN = /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/;

/**
 * Agents' Discord bot tokens, beside the database like the endpoint keys (0600, atomic writes). Tokens never leave
 * the backend: the API reports only whether one is saved.
 */
export class DiscordTokenStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private path = join(dirname(databaseFile()), 'discord-bots.json')) {}

  async read(): Promise<Record<string, string>> {
    try {
      const data: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
      return Object.fromEntries(
        Object.entries(data).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      );
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return {};
      throw new Error('Could not read Discord bot tokens.');
    }
  }
  async get(agentId: string) {
    return (await this.read())[agentId];
  }
  private update(change: (tokens: Record<string, string>) => Record<string, string>) {
    const work = this.queue.then(async () => {
      const tokens = change(await this.read());
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(tokens, null, 2), { mode: 0o600 });
      await rename(temporary, this.path);
    });
    this.queue = work.catch(() => {});
    return work;
  }
  async set(agentId: string, token: string) {
    if (!DISCORD_TOKEN.test(token)) throw new Error('That does not look like a Discord bot token.');
    await this.update(tokens => ({ ...tokens, [agentId]: token }));
  }
  async remove(agentId: string) {
    await this.update(tokens => {
      const next = { ...tokens };
      delete next[agentId];
      return next;
    });
  }
}
