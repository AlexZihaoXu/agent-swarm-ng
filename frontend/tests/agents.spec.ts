import { test, expect, type Page } from './fixtures';

const real = { id: 'real-agent', name: 'Real agent', endpointId: 'saved-endpoint', model: 'test-model', thinkingLevel: 'off', channelId: 'platform-channel', createdAt: Date.now(), lastMessage: null };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/model-endpoints', route => route.fulfill({ json: [{ id: 'saved-endpoint', name: 'Test endpoint', baseUrl: 'http://test.invalid/v1', hasApiKey: true }] }));
  await page.route('**/api/model-endpoints/test', route => route.fulfill({ json: { models: ['test-model', 'gpt-5'] } }));
  await page.route('**/api/agents/model-capabilities?*', route => route.fulfill({ json: route.request().url().includes('gpt-5') ? { thinkingLevels: ['off', 'low', 'medium', 'high'], reasoning: true } : { thinkingLevels: ['off'], reasoning: false } }));
  const saved: typeof real[] = [];
  await page.route('**/api/agents', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { agents: saved, nextCursor: null } });
    const created = { ...real, ...route.request().postDataJSON() }; saved.push(created);
    return route.fulfill({ json: created });
  });
  await page.route('**/api/channels/*/messages*', route => route.fulfill({ json: { messages: [], nextCursor: null } }));
});

async function configure(page: Page, model = 'test-model') {
  await page.goto('/');
  await page.getByRole('complementary', { name: 'Agents', exact: true }).click({ button: 'right', position: { x: 40, y: 360 } });
  await page.getByRole('menuitem', { name: 'Create new agent' }).click();
  await page.getByLabel('Agent name', { exact: true }).fill(real.name);
  await page.getByLabel('Endpoint', { exact: true }).click();
  await page.getByRole('option', { name: 'Test endpoint', exact: true }).click();
  await page.getByLabel('Model', { exact: true }).click();
  await page.getByRole('option', { name: model, exact: true }).click();
  await expect(page.getByRole('listbox', { includeHidden: true })).toHaveCount(0);
}

test('restores a saved agent and published messages after refresh without storing them in the browser', async ({ page }) => {
  let savedMessages: object[] = [];
  await page.route('**/api/channels/*/messages*', route => route.fulfill({ json: { messages: savedMessages, nextCursor: null } }));
  await page.route('**/api/chat', async route => {
    const body = route.request().postDataJSON();
    expect(body.agentId).toBe(real.id);
    expect(body).not.toHaveProperty('history');
    savedMessages = [
      { id: body.clientMessageId, sequence: 1, role: 'user', channelId: real.channelId, text: body.message, timestamp: Date.now() },
      { id: 'published', sequence: 2, role: 'assistant', channelId: real.channelId, text: '**Published** response', timestamp: Date.now() },
    ];
    expect(body).not.toHaveProperty('apiKey');
    await route.fulfill({ contentType: 'application/x-ndjson', body: [
      { type: 'user_message', ...savedMessages[0] },
      { type: 'thinking', text: 'PRIVATE THINKING' },
      { type: 'text_delta', text: 'PRIVATE DIRECT OUTPUT' },
      { type: 'channel_message', channelId: 'wrong-channel', id: 'wrong', text: 'WRONG CHANNEL', timestamp: Date.now() },
      { type: 'channel_message', channelId: real.channelId, id: 'published', text: '**Published** response', timestamp: Date.now() },
      { type: 'done' },
    ].map(event => JSON.stringify(event)).join('\n') + '\n' });
  });
  await configure(page);
  await expect(page.getByLabel('Thinking level')).toBeDisabled();
  await page.getByRole('button', { name: 'Create agent', exact: true }).click();
  await expect(page.getByRole('heading', { name: real.name, exact: true })).toBeVisible();
  await expect(page.getByTestId('chat-avatar').locator('[data-slot="online-indicator"]')).toBeVisible();
  await expect(page.getByRole('button', { name: `Open conversation with ${real.name}` }).locator('[data-slot="online-indicator"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open conversation with [demo] Avery' }).locator('[data-slot="online-indicator"]')).toHaveCount(0);
  await page.getByLabel(`Message ${real.name}`).fill('Hello');
  await page.getByRole('button', { name: 'Send message' }).click();
  const messages = page.getByRole('list', { name: 'Messages' });
  await expect(messages.locator('li')).toHaveCount(2);
  await expect(messages).toContainText('Published response');
  const preview = page.getByRole('button', { name: `Open conversation with ${real.name}` }).locator('[data-slot="swap-text"]').last();
  await expect(preview.locator('strong')).toHaveText('Published');
  await expect(preview).toHaveAttribute('data-prefix', '');
  await expect(messages).not.toContainText('PRIVATE');
  await expect(messages).not.toContainText('WRONG CHANNEL');
  await expect(page.getByRole('button', { name: 'Open conversation with [demo] Avery' })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain('Published response');
  await page.reload();
  await page.getByRole('button', { name: `Open conversation with ${real.name}` }).click();
  await expect(page.getByRole('list', { name: 'Messages' }).locator(':scope > li')).toHaveCount(2);
  await expect(page.getByRole('list', { name: 'Messages' })).toContainText('Published response');
});

async function installChannelStream(page: Page) {
  await page.addInitScript(channelId => {
    const original = window.fetch.bind(window);
    const scope = window as unknown as { emitChannelEvent: (event: object) => void; finishChannel: () => void };
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.endsWith('/api/chat')) return original(input, init);
      const signal = input instanceof Request ? input.signal : init?.signal;
      return Promise.resolve(new Response(new ReadableStream({ async start(controller) {
        scope.emitChannelEvent = event => controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n'));
        scope.finishChannel = () => controller.close();
        signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
        const body = input instanceof Request ? await input.clone().json() : JSON.parse(String(init?.body));
        scope.emitChannelEvent({ type: 'user_message', channelId, id: body.clientMessageId, text: body.message, timestamp: Date.now() });
      } }), { headers: { 'Content-Type': 'application/x-ndjson' } }));
    };
  }, real.channelId);
}

async function emitChannel(page: Page, event: object) {
  await page.evaluate(event => (window as unknown as { emitChannelEvent: (event: object) => void }).emitChannelEvent(event), event);
}

test('typing is channel-scoped and clears when the tool publishes', async ({ page }) => {
  await installChannelStream(page);
  await configure(page);
  await page.getByRole('button', { name: 'Create agent', exact: true }).click();
  await page.getByLabel(`Message ${real.name}`).fill('Hello');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('status')).toHaveText('Agent is working…');
  const avatar = page.getByTestId('chat-avatar');
  const dotBox = (await avatar.locator('[data-slot="online-indicator"]').boundingBox())!;
  await expect(avatar.locator('[data-slot="avatar-face"]')).not.toHaveCSS('mask-image', 'none');
  await emitChannel(page, { type: 'typing', channelId: 'wrong-channel', active: true });
  await expect(page.getByRole('status')).toHaveText('Agent is working…');
  await emitChannel(page, { type: 'typing', channelId: real.channelId, active: true });
  await expect(page.getByRole('status')).toHaveText('Real agent is typing…');
  await expect(page.getByRole('button', { name: `Open conversation with ${real.name}` }).locator('[data-slot="typing-badge"]')).toBeVisible();
  const badge = page.getByTestId('chat-avatar').locator('[data-slot="typing-badge"]');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveCSS('background-color', 'rgb(35, 165, 90)');
  await expect(badge).toHaveCSS('width', '20px');
  await expect(badge).toHaveCSS('height', '10px');
  await expect(badge).toHaveCSS('box-shadow', 'none');
  await expect(avatar.locator('[data-slot="presence-cutout"]')).toHaveCSS('width', '24px');
  const pillBox = (await badge.boundingBox())!;
  expect(pillBox.x + pillBox.width / 2).toBeCloseTo(dotBox.x + dotBox.width / 2, 1);
  expect(pillBox.y + pillBox.height / 2).toBeCloseTo(dotBox.y + dotBox.height / 2, 1);
  const statusBox = await page.getByRole('status').boundingBox();
  const composerBox = await page.getByRole('form', { name: 'Message composer' }).boundingBox();
  expect(statusBox!.y + statusBox!.height).toBeLessThanOrEqual(composerBox!.y);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('status').locator('.typing-dot').first()).toHaveCSS('animation-name', 'none');
  await expect(page.getByRole('list', { name: 'Messages' }).locator('li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Open conversation with [demo] Avery' }).click();
  await expect(page.getByText('Real agent is typing…')).not.toBeVisible();
  await page.getByRole('button', { name: `Open conversation with ${real.name}` }).click();
  await expect(page.getByRole('status')).toHaveText('Real agent is typing…');
  await emitChannel(page, { type: 'typing', channelId: real.channelId, active: false });
  await emitChannel(page, { type: 'channel_message', channelId: real.channelId, id: 'delivered', text: 'Finished message', timestamp: Date.now() });
  await expect(page.getByRole('status')).toHaveText('Agent is working…');
  await emitChannel(page, { type: 'done' });
  await page.evaluate(() => (window as unknown as { finishChannel: () => void }).finishChannel());
  await expect(page.getByRole('status')).not.toBeVisible();
  await expect(page.getByRole('list', { name: 'Messages' }).locator('li')).toHaveCount(2);
});

for (const ending of ['error', 'stop'] as const) {
  test(`typing clears on ${ending}`, async ({ page }) => {
    await installChannelStream(page);
    await configure(page);
    await page.getByRole('button', { name: 'Create agent', exact: true }).click();
    await page.getByLabel(`Message ${real.name}`).fill('Hello');
    await page.getByRole('button', { name: 'Send message' }).click();
    await emitChannel(page, { type: 'typing', channelId: real.channelId, active: true });
    await expect(page.getByRole('status')).toHaveText('Real agent is typing…');
    if (ending === 'stop') await page.getByRole('button', { name: 'Stop response' }).click();
    else {
      await emitChannel(page, { type: 'error', message: 'Tool call failed.' });
      await emitChannel(page, { type: 'done' });
      await page.evaluate(() => (window as unknown as { finishChannel: () => void }).finishChannel());
    }
    await expect(page.getByText('Real agent is typing…')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
    await expect(page.locator('[data-slot="typing-badge"]')).toHaveCount(0);
    await expect(page.getByTestId('chat-avatar').locator('[data-slot="online-indicator"]')).toBeVisible();
  });
}

test('operator activity streams separately, accumulates while closed, and stays agent-scoped', async ({ page }) => {
  await installChannelStream(page);
  await configure(page);
  await page.getByRole('button', { name: 'Create agent', exact: true }).click();
  await page.getByLabel(`Message ${real.name}`).fill('Hello');
  await page.getByRole('button', { name: 'Send message' }).click();
  const entry = { id: 'thought', runId: 'run', channelId: real.channelId, kind: 'thinking', label: 'Thinking', text: 'PRIVATE thought ', timestamp: Date.now() };
  await emitChannel(page, { type: 'activity', agentId: real.id, append: true, entry });
  await expect(page.getByText('PRIVATE thought ', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Agent activity', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Agent activity', exact: true });
  await expect(panel).toContainText('PRIVATE thought');
  await emitChannel(page, { type: 'activity', agentId: real.id, append: true, entry: { ...entry, text: 'continued' } });
  await expect(panel.locator('[data-activity-kind="thinking"]')).toHaveCount(1);
  await expect(panel).toContainText('PRIVATE thought continued');
  await emitChannel(page, { type: 'activity', agentId: 'other-agent', entry: { ...entry, text: 'OTHER AGENT SECRET' } });
  await expect(panel).not.toContainText('OTHER AGENT SECRET');
  await emitChannel(page, { type: 'activity', agentId: real.id, entry: { ...entry, id: 'call', kind: 'tool_call', label: 'send_message', text: '{"text":"Draft message"}' } });
  await expect(panel).toContainText('Draft message');
  const chat = page.getByRole('list', { name: 'Messages' });
  await expect(chat).not.toContainText('PRIVATE');
  await expect(chat).not.toContainText('Draft message');
  await page.getByRole('button', { name: 'Open conversation with [demo] Avery' }).click();
  await expect(panel).toContainText('Demo agents have no runtime activity.');
  await expect(panel).not.toContainText('PRIVATE');
  await page.getByRole('button', { name: `Open conversation with ${real.name}` }).click();
  await expect(panel).toContainText('PRIVATE thought continued');
  await page.getByRole('button', { name: 'Close activity' }).click();
  await expect(panel).not.toBeVisible();
  await page.getByRole('button', { name: 'Agent activity', exact: true }).click();
  await expect(panel).toContainText('PRIVATE thought continued');
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain('PRIVATE');
  await emitChannel(page, { type: 'done' });
  await page.evaluate(() => (window as unknown as { finishChannel: () => void }).finishChannel());
});

test('activity panel fits mobile and closes accessibly', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open conversation with [demo] Avery' }).click();
  const trigger = page.getByRole('button', { name: 'Agent activity', exact: true });
  await trigger.click();
  await expect(page.getByRole('dialog', { name: 'Agent activity' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('select menus visibly highlight hovered options and animate with reduced-motion support', async ({ page }) => {
  await configure(page);
  const model = page.getByLabel('Model', { exact: true });
  await model.click();
  const option = page.getByRole('option', { name: 'gpt-5', exact: true });
  await option.hover();
  await expect(option).toHaveCSS('background-color', 'rgb(48, 48, 48)');
  await expect(option).toHaveCSS('transition-duration', '0.12s');
  await expect(page.getByRole('listbox')).toHaveCSS('animation-name', 'dialog-in');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).not.toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await model.click();
  await expect(page.getByRole('listbox')).toHaveCSS('animation-name', 'none');
  await expect(page.getByRole('option', { name: 'gpt-5', exact: true })).toHaveCSS('transition-property', 'none');
});

test('styled selects support keyboard selection, dismissal, and long lists on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const lastModel = 'provider-' + 'long-model-name-'.repeat(6);
  await page.route('**/api/model-endpoints/test', route => route.fulfill({ json: { models: ['test-model', ...Array.from({ length: 40 }, (_, i) => `model-${i}`), lastModel] } }));
  await configure(page);
  const model = page.getByLabel('Model', { exact: true });
  await model.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('option', { name: 'test-model', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('option', { name: lastModel, exact: true })).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(model).toContainText(lastModel);
  await expect(model).toBeFocused();
  await page.keyboard.press('Space');
  const menu = await page.getByRole('listbox').boundingBox();
  expect(menu!.x).toBeGreaterThanOrEqual(0);
  expect(menu!.x + menu!.width).toBeLessThanOrEqual(390);
  expect(menu!.y + menu!.height).toBeLessThanOrEqual(844);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).not.toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Create new agent' })).toBeVisible();
  await expect(model).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('allows supported thinking levels in creation', async ({ page }) => {
  await configure(page, 'gpt-5');
  await expect(page.getByLabel('Thinking level')).toBeEnabled();
  await page.getByLabel('Thinking level').click();
  await page.getByRole('option', { name: 'Medium', exact: true }).click();
  const request = page.waitForRequest(request => request.url().endsWith('/api/agents') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Create agent', exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ model: 'gpt-5', thinkingLevel: 'medium' });
});

test('unsaved sends retain their draft and message ID until the backend acknowledges persistence', async ({ page }) => {
  const ids: string[] = [];
  await page.route('**/api/chat', route => {
    const body = route.request().postDataJSON(); ids.push(body.clientMessageId);
    if (ids.length === 1) return route.fulfill({ status: 503, json: { message: 'Storage unavailable' } });
    return route.fulfill({ contentType: 'application/x-ndjson', body: [
      { type: 'user_message', channelId: real.channelId, id: body.clientMessageId, text: body.message, timestamp: Date.now() },
      { type: 'done' },
    ].map(event => JSON.stringify(event)).join('\n') + '\n' });
  });
  await configure(page);
  await page.getByRole('button', { name: 'Create agent', exact: true }).click();
  const input = page.getByLabel(`Message ${real.name}`);
  await input.fill('Save me');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(input).toHaveValue('Save me');
  await expect(page.getByRole('list', { name: 'Messages' }).locator(':scope > li')).toHaveCount(0);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('list', { name: 'Messages' }).locator(':scope > li')).toHaveCount(1);
  await expect(input).toHaveValue('');
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
});

test('model failures do not become chat bubbles or diagnostic footer text', async ({ page }) => {
  await page.route('**/api/chat', route => {
    const body = route.request().postDataJSON();
    return route.fulfill({ contentType: 'application/x-ndjson', body: [
      { type: 'user_message', channelId: real.channelId, id: body.clientMessageId, text: body.message, timestamp: Date.now() },
      { type: 'error', message: 'Agent did not publish a channel message.' }, { type: 'done' },
    ].map(event => JSON.stringify(event)).join('\n') + '\n' });
  });
  await configure(page);
  await page.getByRole('button', { name: 'Create agent', exact: true }).click();
  await page.getByLabel(`Message ${real.name}`).fill('Hello');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  await expect(page.getByText('Agent did not publish a channel message.')).not.toBeVisible();
  await expect(page.getByText('Temporary chat — only channel-tool messages are shown.')).not.toBeVisible();
  await expect(page.getByRole('list', { name: 'Messages' }).locator('li')).toHaveCount(1);
});
