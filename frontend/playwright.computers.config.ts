import config from './playwright.config';

// Opt-in against an isolated dev Compose project only. Never auto-start a
// backend against .local or run this file against the live Tailnet dashboard.
export default {
  ...config,
  testMatch: ['**/computers.spec.ts', '**/computers.live.ts'],
  outputDir: '../.scratch/test-results-computers-live',
  webServer: undefined,
  use: { ...config.use, baseURL: 'http://127.0.0.1:5173', launchOptions: { chromiumSandbox: true } },
};
