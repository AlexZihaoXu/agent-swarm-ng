import { test as base } from '@playwright/test';
import { sampleAgents, sampleHistory } from './sample-agents';
export { expect, type Page } from '@playwright/test';

// All sample agents live behind test-only API mocks, never in the application.
export const test = base.extend({
  page: async ({ page }, use) => {
    let agents = structuredClone(sampleAgents);
    const history = structuredClone(sampleHistory);
    await page.route(/\/api\/agents(?:\?.*)?$/, route => route.request().method() === 'GET'
      ? route.fulfill({ json: { agents, nextCursor: null } })
      : route.fulfill({ status: 501, json: { message: 'Configure an agent-creation mock for this test.' } }));
    await page.route(/\/api\/agents\/[^/?]+$/, route => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1)!);
      const agent = agents.find(item => item.id === id);
      if (!agent) return route.fulfill({ status: 404, json: { message: 'Agent not found.' } });
      if (route.request().postDataJSON().confirmation !== agent.name) return route.fulfill({ status: 400, json: { message: 'Wrong confirmation.' } });
      agents = agents.filter(item => item.id !== id); delete history[agent.channelId];
      return route.fulfill({ json: { deleted: true } });
    });
    await page.route('**/api/channels/*/messages*', route => {
      const channel = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3]);
      return route.fulfill({ json: { messages: history[channel] ?? [], nextCursor: null } });
    });
    await page.route('**/api/chat', async route => {
      const body = route.request().postDataJSON();
      const agent = agents.find(item => item.id === body.agentId);
      if (!agent) return route.fulfill({ status: 501, json: { message: 'Configure a chat mock for this test.' } });
      const messages = history[agent.channelId];
      const message = { id: body.clientMessageId, channelId: agent.channelId, sequence: messages.length + 1, role: 'user' as const, text: body.message, timestamp: await page.evaluate(() => Date.now()) };
      messages.push(message); agent.lastMessage = message;
      return route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'user_message', ...message })}\n${JSON.stringify({ type: 'done' })}\n` });
    });
    await page.route('**/api/model-endpoints', route => route.fulfill({ json: [] }));
    await page.route(/\/api\/providers\/openai-codex(?:\/login)?$/, route => route.fulfill({ json: { connected: false, models: [], login: { state: 'idle' } } }));
    await use(page);
  },
});
