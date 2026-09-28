import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseFile, databaseUrl } from '../src/database-location';

process.umask(0o077);
const url = databaseUrl();
await mkdir(dirname(databaseFile(url)), { recursive: true, mode: 0o700 });
const child = Bun.spawn([process.execPath, 'node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, DATABASE_URL: url, CHECKPOINT_DISABLE: '1' },
  stdout: 'inherit',
  stderr: 'inherit',
});
process.exit(await child.exited);
