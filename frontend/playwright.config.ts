import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: '../.scratch/test-results',
  use: { baseURL: 'http://127.0.0.1:5173', browserName: 'chromium' },
  webServer: [
    { command: 'bun run --cwd ../backend start', url: 'http://127.0.0.1:3000/api/health', reuseExistingServer: false },
    { command: 'bun run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: false },
  ],
});
