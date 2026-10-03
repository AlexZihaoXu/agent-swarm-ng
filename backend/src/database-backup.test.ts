import { expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, readdir, stat, writeFile } from 'node:fs/promises';
import { createClient } from '@libsql/client';
import { pathToFileURL } from 'node:url';
import { prepareDatabase } from './test-database';
import { backupDatabase } from './database-backup';

it('keeps one consistent copy of the database per day, newest few only', async () => {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const folder = await mkdtemp(join(process.env.SQLITE_TEST_ROOT!, 'backups-'));
  for (const day of ['2026-09-01', '2026-09-02', '2026-09-03']) await writeFile(join(folder, `platform-${day}.db`), '');
  await writeFile(join(folder, 'notes.txt'), 'not a backup');

  const made = await backupDatabase(database, folder, 3, new Date('2026-10-03T12:00:00Z'));
  expect(made).toBe(join(folder, 'platform-2026-10-03.db'));
  // Again the same day: nothing new.
  expect(await backupDatabase(database, folder, 3, new Date('2026-10-03T18:00:00Z'))).toBeNull();
  expect((await readdir(folder)).sort()).toEqual([
    'notes.txt',
    'platform-2026-09-02.db',
    'platform-2026-09-03.db',
    'platform-2026-10-03.db',
  ]);
  expect((await stat(made!)).mode & 0o077).toBe(0);
  // The copy is a working database with the same data.
  const copy = createClient({ url: pathToFileURL(made!).href });
  const users = await copy.execute('SELECT name FROM "User"');
  copy.close();
  expect(users.rows.map(row => row.name)).toEqual(['Admin']);
});
