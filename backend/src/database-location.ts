import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export function databaseUrl() {
  const url = process.env.DATABASE_URL ?? new URL('../../.local/platform.db', import.meta.url).href;
  if (!url.startsWith('file:')) throw new Error('DATABASE_URL must point to a local SQLite file.');
  const normalized = new URL(url.startsWith('file://') ? url : pathToFileURL(resolve(url.slice('file:'.length))).href);
  if (normalized.hostname || normalized.search || normalized.hash) throw new Error('DATABASE_URL must be a local file without a host, query, or fragment.');
  return normalized.href;
}

export function databaseFile(url = databaseUrl()) {
  return url.startsWith('file://') ? fileURLToPath(url) : url.slice('file:'.length);
}
