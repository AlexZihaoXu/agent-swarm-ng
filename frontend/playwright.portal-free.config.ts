import config from './playwright.config';

// Opt-in only against scripts/test-computers-x11-dev.sh's isolated stack.
// Never auto-start a backend against .local or run against live Tailnet data.
export default {
  ...config,
  testMatch: ['**/computers.portal-free.ts'],
  outputDir: '../.scratch/test-results-computers-portal-free',
  webServer: undefined,
  use: { ...config.use, baseURL: 'http://127.0.0.1:5173', launchOptions: { chromiumSandbox: true } },
};
