import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// The suite's backend gets its own throwaway data directory and no computer controller, so it can never touch the
// deployed stack's database, saved API keys or Docker computers.
const data = fileURLToPath(new URL('../.scratch/e2e-data', import.meta.url));

export default defineConfig({
  testDir: './tests',
  outputDir: '../.scratch/test-results',
  use: { baseURL: 'http://127.0.0.1:5173', browserName: 'chromium' },
  webServer: [
    {
      command: `rm -rf "${data}" && bun run --cwd ../backend start`,
      url: 'http://127.0.0.1:3000/api/health',
      reuseExistingServer: false,
      env: { DATABASE_URL: `file:${data}/platform.db`, COMPUTER_CONTROLLER_URL: '' },
    },
    { command: 'bun run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: false },
  ],
});
