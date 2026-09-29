import { test, expect, type Page } from './fixtures';

const agent = {
  id: 'background-agent',
  name: 'Background agent',
  channelId: 'background-channel',
  endpointId: 'endpoint',
  model: 'test-model',
  thinkingLevel: 'off',
  createdAt: 1000,
  lastMessage: null,
};
const emit = (page: Page, event: object) =>
  page.evaluate(
    value => (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent(value),
    event,
  );
async function setup(page: Page) {
  const messages: { id: string; channelId: string; sequence: number; role: string; text: string; timestamp: number }[] =
    [];
  let starts = 0,
    stops = 0;
  let run = {
    runId: 'background-run',
    agentId: agent.id,
    channelId: agent.channelId,
    clientMessageId: '',
    typing: false,
  };
  await page.route('**/api/agents', route =>
    route.fulfill({ json: { agents: [{ ...agent, lastMessage: messages.at(-1) ?? null }], nextCursor: null } }),
  );
  await page.route('**/api/channels/background-channel/messages*', route =>
    route.fulfill({ json: { messages, nextCursor: null } }),
  );
  await page.route('**/api/chat', async route => {
    starts++;
    const body = route.request().postDataJSON();
    if (!run.clientMessageId) run = { ...run, clientMessageId: body.clientMessageId };
    const message = {
      id: body.clientMessageId,
      channelId: agent.channelId,
      sequence: messages.length + 1,
      role: 'user',
      text: body.message,
      timestamp: Date.now(),
    };
    messages.push(message);
    await page.addInitScript(value => {
      Object.assign(window, { agentRunSnapshot: [value] });
    }, run);
    await page.evaluate(value => {
      Object.assign(window, { agentRunSnapshot: [value] });
    }, run);
    expect(route.request().headers().prefer).toBe('respond-async');
    // Acceptance closes this request; only the independent event feed observes work.
    return route.fulfill({ status: 202, json: { run, message } });
  });
  await page.route('**/api/agents/background-agent/stop', route => {
    stops++;
    expect(route.request().postDataJSON()).toEqual({ clientMessageId: run.clientMessageId });
    return route.fulfill({ json: { stopped: true } });
  });
  await page.goto('/chat/agents/background-agent');
  await page.getByLabel('Message Background agent').fill('Keep working');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('list', { name: 'Messages' })).toContainText('Keep working');
  return { messages, counts: () => ({ starts, stops }), run: () => run };
}

test('accepts follow-ups while working and keeps Stop targeted at the original run', async ({ page }) => {
  const backend = await setup(page);
  const original = backend.run().clientMessageId;
  const input = page.getByLabel('Message Background agent');
  await input.fill('Correction: use the new requirements');
  await expect(page.getByRole('button', { name: 'Stop response' })).toBeVisible();
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('list', { name: 'Messages' })).toContainText('Correction: use the new requirements');
  await input.fill('Another detail');
  await input.press('Enter');
  await expect(page.getByRole('list', { name: 'Messages' })).toContainText('Another detail');
  expect(backend.run().clientMessageId).toBe(original);
  await page.getByRole('button', { name: 'Stop response' }).click();
  expect(backend.counts()).toEqual({ starts: 3, stops: 1 });
});

test('shows the latest context estimate in activity without adding chat messages', async ({ page }) => {
  const backend = await setup(page);
  await page.getByRole('button', { name: 'Agent activity', exact: true }).click();
  const usage = page.getByLabel('Context usage', { exact: true });
  await expect(usage).toHaveText('Waiting for a runtime update');
  const entry = {
    id: `${backend.run().runId}:context-usage`,
    runId: backend.run().runId,
    channelId: agent.channelId,
    kind: 'status',
    label: 'Context usage',
    timestamp: Date.now(),
    text: '≈ 8,192 / 32,768 tokens · 25.0%\nMain session estimate · configured context limit, not cumulative billing.',
  };
  await emit(page, { ...backend.run(), type: 'activity', eventId: 'context-1', entry });
  await expect(usage).toHaveText('≈ 8,192 / 32,768 tokens · 25.0%');
  await emit(page, {
    ...backend.run(),
    type: 'activity',
    eventId: 'context-2',
    entry: { ...entry, text: '≈ 16,384 / 32,768 tokens · 50.0%\nMain session estimate.' },
  });
  await expect(usage).toHaveText('≈ 16,384 / 32,768 tokens · 50.0%');
  // The estimate is replaced in the header, never listed as a step.
  await expect(page.getByRole('dialog', { name: 'Agent activity' }).locator('section')).not.toContainText(
    'Context usage',
  );
  await expect(page.getByRole('list', { name: 'Messages' }).locator(':scope > li')).toHaveCount(1);
});

test('refresh reconnects to the existing run, receives its result once, and does not stop it', async ({ page }) => {
  const backend = await setup(page);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Stop response' })).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Conversation with Background' })
      .getByTestId('chat-avatar')
      .locator('[data-state="working"]'),
  ).toBeVisible();
  expect(backend.counts()).toEqual({ starts: 1, stops: 0 });
  const message = {
    id: 'background-answer',
    channelId: agent.channelId,
    sequence: 2,
    role: 'assistant',
    text: 'Finished while independent of the dashboard',
    timestamp: Date.now(),
  };
  backend.messages.push(message);
  const event = { ...backend.run(), ...message, type: 'channel_message', eventId: 'publication' };
  await emit(page, event);
  await emit(page, event);
  await emit(page, { ...backend.run(), type: 'done', eventId: 'done' });
  await expect(page.getByRole('list', { name: 'Messages' }).locator(':scope > li')).toHaveCount(2);
  await expect(page.getByRole('list', { name: 'Messages' })).toContainText(message.text);
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);
  expect(backend.counts().starts).toBe(1);
});

test('Stop after refresh explicitly targets the original backend request', async ({ page }) => {
  const backend = await setup(page);
  await page.reload();
  await page.getByRole('button', { name: 'Stop response' }).click();
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);
  expect(backend.counts()).toEqual({ starts: 1, stops: 1 });
});

test('a reconnect history response cannot erase a newer live publication', async ({ page }) => {
  const backend = await setup(page);
  let release!: () => void, requested!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const started = new Promise<void>(resolve => {
    requested = resolve;
  });
  await page.route('**/api/channels/background-channel/messages*', async route => {
    const snapshot = [...backend.messages];
    requested();
    await gate;
    return route.fulfill({ json: { messages: snapshot, nextCursor: null } });
  });
  await page.evaluate(() => (window as unknown as { disconnectAgentEvents: () => void }).disconnectAgentEvents());
  try {
    await started;
    const message = {
      id: 'live-answer',
      channelId: agent.channelId,
      sequence: 2,
      role: 'assistant',
      text: 'Newer than the history snapshot',
      timestamp: Date.now(),
    };
    backend.messages.push(message);
    await emit(page, { ...backend.run(), ...message, type: 'channel_message', eventId: 'live-publication' });
    await expect(page.getByRole('list', { name: 'Messages' })).toContainText(message.text);
    release();
    await expect(page.getByRole('button', { name: 'Loading messages…' })).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Messages' })).toContainText(message.text);
    await emit(page, { ...backend.run(), type: 'done', eventId: 'done' });
  } finally {
    release();
  }
});

test('reconnect catches up publications completed offline without replaying notification sounds', async ({ page }) => {
  const backend = await setup(page);
  backend.messages.push({
    id: 'offline-answer',
    channelId: agent.channelId,
    sequence: 2,
    role: 'assistant',
    text: 'Completed while disconnected',
    timestamp: Date.now(),
  });
  await page.evaluate(() => {
    const scope = window as unknown as { agentRunSnapshot: object[]; disconnectAgentEvents: () => void };
    scope.agentRunSnapshot = [];
    scope.disconnectAgentEvents();
  });
  await expect(page.getByRole('list', { name: 'Messages' })).toContainText('Completed while disconnected');
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);
  expect(backend.counts()).toEqual({ starts: 1, stops: 0 });
  expect(
    await page.evaluate(
      () => (window as unknown as { notificationAudio: { starts: number } }).notificationAudio.starts,
    ),
  ).toBe(0);
});
