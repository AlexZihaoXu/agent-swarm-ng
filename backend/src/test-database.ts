import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { PlatformStore } from './platform-store';

export async function prepareDatabase(path: string) {
  const url = pathToFileURL(resolve(path)).href;
  const client = createClient({ url });
  try {
    const root = new URL('../prisma/migrations/', import.meta.url);
    for (const name of (await readdir(root)).filter(name => name !== 'migration_lock.toml').sort()) {
      await client.executeMultiple(await readFile(new URL(`${name}/migration.sql`, root), 'utf8'));
    }
  } finally {
    client.close();
  }
  const store = new PlatformStore(url);
  await store.initialize();
  return store;
}
