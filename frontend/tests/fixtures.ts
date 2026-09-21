import { test as base } from '@playwright/test';
export { expect, type Page } from '@playwright/test';

// UI tests must not depend on, or mutate, the developer's saved agents.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route(/\/api\/agents(?:\?.*)?$/, route => route.request().method() === 'GET'
      ? route.fulfill({ json: { agents: [], nextCursor: null } }) : route.fallback());
    await page.route(/\/api\/providers\/openai-codex(?:\/login)?$/, route => route.fulfill({ json: { connected: false, models: [], login: { state: 'idle' } } }));
    await use(page);
  },
});
