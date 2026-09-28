import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
await mkdir(join(root, '.scratch'), { recursive: true });
const folder = await mkdtemp(join(root, '.scratch/sqlite-tests-'));
try {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  const child = Bun.spawn(['bun', 'run', 'vitest', 'run', ...args], {
    cwd: root,
    env: { ...process.env, SQLITE_TEST_ROOT: folder, DATABASE_URL: pathToFileURL(join(folder, 'default.db')).href },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  process.exitCode = await child.exited;
} finally {
  // libSQL native file handles on Windows may outlive disconnect until the test worker exits.
  await rm(folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
