import { chmod, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { PlatformStore } from './platform-store';

export const DEFAULT_DATABASE_BACKUPS = 7;
const NAME = /^platform-(\d{4}-\d{2}-\d{2})\.db$/;

/**
 * Today's copy of the platform database (`VACUUM INTO`: consistent while the backend runs), unless one exists, then
 * only the newest `keep` copies stay. Returns the new file, or null. Chat files, screenshots and secrets beside the
 * database are not included (docs/development.md#production).
 */
export async function backupDatabase(database: PlatformStore, folder: string, keep: number, now = new Date()) {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const target = join(folder, `platform-${now.toISOString().slice(0, 10)}.db`);
  const exists = await stat(target).then(
    () => true,
    () => false,
  );
  if (!exists) {
    await database.initialize();
    const partial = `${target}.partial`;
    await rm(partial, { force: true });
    // The path is built here from a date, never from input.
    await database.client.$executeRawUnsafe(`VACUUM INTO '${partial.replaceAll("'", "''")}'`);
    await chmod(partial, 0o600);
    await rename(partial, target);
  }
  const copies = (await readdir(folder)).filter(name => NAME.test(name)).sort();
  for (const old of copies.slice(0, Math.max(0, copies.length - keep))) await rm(join(folder, old), { force: true });
  return exists ? null : target;
}
