import { test, expect, type Page } from './fixtures';
import { sampleAgents } from './sample-agents';
async function openEditor(page: Page) {
  await page.goto('/agents/avery');
  const settings = page.getByRole('region', { name: 'Settings for Avery' });
  await expect(settings).toBeVisible();
  return settings;
}
async function mockDmPeers(page: Page, ids: string[] = ['morgan']) {
  await page.route('**/api/agents/avery/dm-peers*', route => route.fulfill({ json: { peers: sampleAgents.filter(agent => ids.includes(agent.id)).map(agent => ({ id: agent.id, name: agent.name, avatar: agent.avatar ?? null, channelId: agent.channelId })), nextCursor: null } }));
}

test('Channels and DM transcripts appear without directional entrance motion', async ({ page }) => {
  await page.goto('/agents/avery');
  const channels = page.getByRole('region', { name: 'Channels' });
  const directional = channels.locator('[class*="settings-forward"], [class*="settings-back"]');
  await expect(channels.getByRole('heading', { name: 'Allowed DMs' })).toBeVisible();
  await expect(directional).toHaveCount(0);
  await channels.getByRole('button', { name: 'View DM with Morgan' }).click();
  await expect(channels.getByRole('region', { name: 'Agent DM transcript' })).toBeVisible();
  await expect(directional).toHaveCount(0);
  await channels.getByRole('button', { name: 'Swarm App' }).click();
  await expect(channels.getByRole('heading', { name: 'Allowed DMs' })).toBeVisible();
  await expect(directional).toHaveCount(0);
});

test('keeps appearance and permission drafts across one scroll, transcript inspection, and save', async ({ page }) => {
  const peerMessage = { id: 'dm-one', sequence: 2, conversationId: 'dm:avery:morgan', senderId: 'morgan', recipientId: 'avery', senderName: 'Morgan', recipientName: 'Avery', text: '**Separate peer result**', status: 'completed', timestamp: 1 };
  const live = [peerMessage];
  await page.route('**/api/agents/avery/dms/morgan*', route => route.fulfill({ json: new URL(route.request().url()).searchParams.has('before') ? { messages: [{ ...peerMessage, id: 'older', sequence: 1, text: 'Earlier peer context' }], nextCursor: null } : { messages: live, nextCursor: 2 } }));
  const dialog = await openEditor(page);
  await expect(dialog.getByRole('tablist', { name: 'Agent editor sections' })).toHaveCount(0);
  await dialog.getByRole('checkbox', { name: 'Morgan', exact: true }).check();
  await dialog.getByRole('heading', { name: 'Avatar' }).scrollIntoViewIfNeeded();
  await dialog.getByRole('button', { name: 'Preview Bean', exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: 'Morgan', exact: true })).toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Preview Bean', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('heading', { name: 'Channels' }).scrollIntoViewIfNeeded();
  await dialog.screenshot({ path: '../.scratch/agent-communication-settings-desktop.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: 'View DM with Morgan' }).click();
  await expect(dialog.getByRole('region', { name: 'Agent DM transcript' })).toContainText('Separate peer result');
  await expect(page.getByRole('list', { name: 'Messages' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Earlier messages' }).click();
  await expect(dialog).toContainText('Earlier peer context');
  live.push({ ...peerMessage, id: 'newer', sequence: 3, text: 'Live peer update' });
  await page.evaluate(() => (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent({ type: 'dm_updated', agentId: 'morgan', channelId: 'dm:avery:morgan', conversationId: 'dm:avery:morgan', eventId: 'dm-update' }));
  await expect(dialog).toContainText('Live peer update'); await expect(dialog).toContainText('Earlier peer context');
  await dialog.getByRole('button', { name: 'Swarm App', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Saved');
  await page.reload();
  await expect(dialog.getByRole('checkbox', { name: 'Morgan', exact: true })).toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Preview Bean', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
test('keeps paginated existing grants on mobile, supports search and reduced motion, and pins Save', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/agents/avery/settings', route => route.request().method() === 'GET' ? route.fulfill({ json: { avatar: null, allowedDmAgents: [{ id: 'remote', name: 'Saved remote peer' }] } }) : route.fallback());
  await page.route(/\/api\/agents\?.*/, route => {
    const query = new URL(route.request().url()).searchParams;
    if (!query.has('limit')) return route.fallback();
    const agents = query.get('search') ? [{ ...sampleAgents[1], name: 'Search result' }] : Array.from({ length: 24 }, (_, i) => ({ ...sampleAgents[1], id: `peer-${i}`, name: `Peer ${i}` }));
    return route.fulfill({ json: { agents, nextCursor: null } });
  });
  const dialog = await openEditor(page);
  await expect(dialog.getByRole('checkbox', { name: 'Saved remote peer' })).toBeChecked();
  const editor = dialog.getByRole('region', { name: 'Agent editor', exact: true });
  await editor.evaluate(element => { element.scrollTop = 700; });
  await expect.poll(() => editor.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  await expect(dialog.getByRole('heading', { name: 'Avatar' })).toBeVisible();
  await dialog.getByLabel('Find agents').fill('Search');
  await dialog.getByRole('checkbox', { name: 'Search result' }).check();
  await dialog.getByLabel('Find agents').fill('');
  await expect(dialog.getByRole('checkbox', { name: 'Saved remote peer' })).toBeChecked();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const save = (await dialog.getByRole('button', { name: 'Save changes' }).boundingBox())!; expect(save.y + save.height).toBeLessThan(780);
  await dialog.screenshot({ path: '../.scratch/agent-communication-settings-mobile.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await dialog.getByRole('button', { name: 'Back to agents' }).click();
});
test('tracks peer work separately from human messages and stops the peer run without chat notifications', async ({ page }) => {
  await page.goto('/chat/agents/avery'); await expect(page.getByRole('list', { name: 'Messages' })).toContainText('One step', { ignoreCase: true });
  let stopped = '';
  await page.route('**/api/agents/avery/stop', route => { stopped = route.request().postDataJSON().clientMessageId; return route.fulfill({ json: { stopped: true } }); });
  await page.evaluate(() => {
    const scope = window as unknown as { emitAgentEvent: (event: object) => void };
    scope.emitAgentEvent({ type: 'run_started', agentId: 'avery', channelId: 'dm:avery:morgan', runId: 'peer-run', clientMessageId: 'peer-message', eventId: 'peer-start' });
    scope.emitAgentEvent({ type: 'channel_message', agentId: 'avery', channelId: 'dm:avery:morgan', runId: 'peer-run', id: 'peer-output', text: 'Not a human reply', eventId: 'peer-pub' });
  });
  await expect(page.getByRole('button', { name: 'Stop response' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Messages' })).not.toContainText('Not a human reply');
  await page.getByRole('button', { name: 'Stop response' }).click(); expect(stopped).toBe('peer-message');
  expect(await page.evaluate(() => (window as unknown as { notificationAudio: { starts: number } }).notificationAudio.starts)).toBe(0);
});


test('one saved connection automatically enables the other agent and either side can remove it', async ({ page }) => {
  let settings = await openEditor(page);
  await settings.getByRole('checkbox', { name: 'Morgan', exact: true }).check();
  await settings.getByRole('button', { name: 'Save changes' }).click();
  await expect(settings.getByRole('status')).toContainText('Saved');
  await page.getByRole('button', { name: 'Open settings for Morgan' }).click();
  settings = page.getByRole('region', { name: 'Settings for Morgan' });
  await expect(settings.getByRole('checkbox', { name: 'Avery', exact: true })).toBeChecked();
  await settings.getByRole('checkbox', { name: 'Avery', exact: true }).uncheck(); await settings.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('button', { name: 'Open settings for Avery' }).click();
  settings = page.getByRole('region', { name: 'Settings for Avery' });
  await expect(settings.getByRole('checkbox', { name: 'Morgan', exact: true })).not.toBeChecked();
});

test('received DMs use decorated chat bubbles, survive refresh, and open the peer conversation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const notice = { id: 'persisted-dm', sequence: 1, conversationId: 'dm:avery:morgan', senderId: 'morgan', senderName: 'Morgan', senderAvatar: null, preview: 'The research is ready.', status: 'completed', timestamp: new Date(2030, 0, 1, 4).getTime() };
  let messages = [notice];
  await page.route('**/api/agents/avery/dm-inbox*', route => route.fulfill({ json: { messages, nextCursor: null } }));
  await page.route('**/api/agents/avery/dms/morgan*', route => route.fulfill({ json: { messages: [{ ...notice, text: 'The research is ready. Full peer transcript.', recipientId: 'avery', recipientName: 'Avery' }], nextCursor: null } }));
  await page.goto('/chat/agents/avery');
  const bubble = page.getByRole('article', { name: 'Message received from Morgan' });
  await expect(bubble).toHaveCount(1); await expect(bubble).toContainText('The research is ready.');
  expect(await bubble.evaluate(element => getComputedStyle(element).borderRadius)).toBe(await page.locator('[data-message-id]').first().evaluate(element => getComputedStyle(element).borderRadius));
  await page.screenshot({ path: '../.scratch/received-dm-bubble-desktop.png', animations: 'disabled' });
  await page.reload(); await expect(bubble).toHaveCount(1);
  await bubble.getByRole('button', { name: 'View conversation with Morgan' }).click();
  await expect(page.getByRole('combobox', { name: 'Chat with' })).toHaveText('Morgan');
  await expect(page.getByRole('region', { name: 'Agent conversation with Morgan' })).toContainText('Full peer transcript');
  await page.getByRole('combobox', { name: 'Chat with' }).click(); await page.getByRole('option', { name: 'You', exact: true }).click();
  messages = [...messages, { ...notice, id: 'second-dm', sequence: 2, preview: 'A second update.', timestamp: notice.timestamp + 1000 }];
  await page.evaluate(() => (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent({ type: 'dm_updated', agentId: 'morgan', channelId: 'dm:avery:morgan', conversationId: 'dm:avery:morgan', eventId: 'inbox-new' }));
  await expect(bubble).toHaveCount(2);
  expect(await page.evaluate(() => (window as unknown as { notificationAudio: { starts: number } }).notificationAudio.starts)).toBe(0);
  await page.setViewportSize({ width: 360, height: 780 });
  await expect(bubble).toHaveCount(2); // Keep the open desktop conversation on resize.
  await expect(page.getByRole('complementary', { name: 'Chats' })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../.scratch/received-dm-bubble-mobile.png', animations: 'disabled' });
});


test.describe('phone peer selector', () => {
  test.use({ hasTouch: true, isMobile: true });
  test('touch opens, changes peer, and returns to You without trapping the chat', async ({ page }) => {
    await mockDmPeers(page);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/chat');
    await page.getByRole('button', { name: 'Open conversation with Avery' }).tap();
    const selector = page.getByRole('combobox', { name: 'Chat with' });
    await expect(selector).toHaveText('You');
    expect((await selector.boundingBox())!.width).toBeGreaterThanOrEqual(104);
    await selector.tap();
    const menu = page.getByRole('listbox');
    expect((await menu.boundingBox())!.width).toBeGreaterThanOrEqual(180);
    await menu.getByRole('option', { name: 'Morgan', exact: true }).tap();
    await expect(page.getByRole('region', { name: 'Agent conversation with Morgan' })).toBeVisible();
    await expect(selector).toHaveText('Morgan');
    await selector.tap();
    await menu.getByRole('option', { name: 'You', exact: true }).tap();
    await expect(page.getByRole('form', { name: 'Message composer' })).toBeVisible();
    await expect(menu).toHaveCount(0);
  });
  test('Chat phone selector stays on Chat and keeps the one-row back header', async ({ page }) => {
    await mockDmPeers(page);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/chat');
    await page.getByRole('button', { name: 'Open conversation with Avery' }).tap();
    const selector = page.getByRole('combobox', { name: 'Chat with' });
    await expect(selector).toHaveText('You');
    const header = page.getByRole('region', { name: 'Conversation with Avery' }).locator('header').first();
    await expect(header.locator('[data-slot="agent-exchange-icon"]')).toHaveCount(1);
    await selector.tap(); await page.getByRole('option', { name: 'Morgan', exact: true }).tap();
    await expect(page).toHaveURL(/\/chat\/agents\/avery\/dm\/morgan$/);
    await expect(selector).toHaveText('Morgan');
    await expect(page.getByRole('button', { name: 'Back to chats' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('chat-peer-320.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Back to chats' }).tap();
    await expect(page.getByRole('complementary', { name: 'Chats' })).toBeVisible();
  });
});

test('Chat tab keeps peer selection in Chat, preserving the human draft and a direct peer URL', async ({ page }) => {
  await mockDmPeers(page);
  await page.route('**/api/agents/avery/dms/morgan*', route => route.fulfill({ json: { messages: [{ id: 'chat-peer', sequence: 1, conversationId: 'dm:avery:morgan', senderId: 'morgan', recipientId: 'avery', senderName: 'Morgan', recipientName: 'Avery', text: 'Peer result in Chat', status: 'completed', timestamp: Date.now() }], nextCursor: null } }));
  await page.goto('/chat/agents/avery');
  await expect(page.getByRole('tab', { name: 'Chat', exact: true })).toHaveAttribute('data-state', 'active');
  const selector = page.getByRole('combobox', { name: 'Chat with' });
  await expect(selector).toHaveText('You');
  await page.getByRole('textbox', { name: 'Message Avery' }).fill('Keep the human draft');
  await selector.click(); await page.getByRole('option', { name: 'Morgan', exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/agents\/avery\/dm\/morgan$/);
  await expect(page.getByRole('region', { name: 'Agent conversation with Morgan' })).toContainText('Peer result in Chat');
  await expect(page.getByRole('form', { name: 'Message composer' })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('chat-peer-desktop.png'), animations: 'disabled' });
  await selector.click(); await page.getByRole('option', { name: 'You', exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/agents\/avery$/);
  await expect(page.getByRole('textbox', { name: 'Message Avery' })).toHaveValue('Keep the human draft');
  await selector.click(); await page.getByRole('option', { name: 'Morgan', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Chat with' })).toHaveText('Morgan');
  await expect(page.getByRole('tab', { name: 'Chat', exact: true })).toHaveAttribute('data-state', 'active');
  await expect(page.getByRole('region', { name: 'Agent conversation with Morgan' })).toContainText('Peer result in Chat');
});

test('Chat with switches the main history, shows agent avatars, and keeps self left with readable sender tints', async ({ page }) => {
  await mockDmPeers(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const stamp = new Date(2030, 0, 1, 4).getTime();
  await page.route('**/api/agents/avery/dms/morgan*', route => route.fulfill({ json: { messages: [
    { id: 'self-dm', sequence: 1, conversationId: 'dm:avery:morgan', senderId: 'avery', recipientId: 'morgan', senderName: 'Avery', recipientName: 'Morgan', text: 'Sent by the selected agent', status: 'completed', timestamp: stamp },
    { id: 'remote-dm', sequence: 2, conversationId: 'dm:avery:morgan', senderId: 'morgan', recipientId: 'avery', senderName: 'Morgan', recipientName: 'Avery', text: 'Reply from the other agent', status: 'completed', timestamp: stamp + 1000 },
  ], nextCursor: null } }));
  await page.goto('/chat/agents/avery');
  const selector = page.getByRole('combobox', { name: 'Chat with' });
  await expect(selector).toHaveText('You'); await expect(selector.locator('svg[data-avatar-shape]')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Message Avery' }).fill('Keep my human draft');
  await selector.click();
  await expect(page.getByRole('option', { name: 'You', exact: true }).locator('svg[data-avatar-shape]')).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Morgan', exact: true }).locator('svg[data-avatar-shape]')).toHaveCount(1);
  await page.screenshot({ path: '../.scratch/agent-dm-selector-avatars.png', animations: 'disabled' });
  await page.getByRole('option', { name: 'Morgan', exact: true }).click();
  await expect(selector.locator('svg[data-avatar-shape]')).toHaveCount(1);
  const header = page.getByRole('region', { name: 'Conversation with Avery', exact: true }).locator('header').first();
  await expect(header.locator('[data-slot=agent-exchange-icon]')).toHaveCount(1); await expect(header.locator('svg[data-avatar-shape]')).toHaveCount(3);
  const remoteAvatar = header.getByTestId('chat-avatar').nth(1);
  await expect(remoteAvatar.locator('[data-slot="online-indicator"]')).toHaveAttribute('data-state', 'ready');
  await page.evaluate(() => (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent({ type: 'run_started', agentId: 'morgan', channelId: 'morgan', runId: 'remote-status', clientMessageId: 'remote-message', eventId: 'remote-start' }));
  await expect(remoteAvatar.locator('[data-slot="online-indicator"]')).toHaveAttribute('data-state', 'working');
  await page.evaluate(() => (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent({ type: 'typing', active: true, targets: ['dm:avery:morgan'], agentId: 'morgan', channelId: 'morgan', runId: 'remote-status', eventId: 'remote-typing' }));
  await expect(remoteAvatar.locator('[data-slot="typing-badge"]')).toHaveAttribute('data-state', 'typing');
  await page.evaluate(() => (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent({ type: 'done', agentId: 'morgan', channelId: 'morgan', runId: 'remote-status', eventId: 'remote-done' }));
  await expect(remoteAvatar.locator('[data-slot="online-indicator"]')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByRole('form', { name: 'Message composer' })).toHaveCount(0);
  const self = page.locator('[data-message-id="self-dm"]'), remote = page.locator('[data-message-id="remote-dm"]');
  await expect(self).toContainText('Avery'); await expect(remote).toContainText('Morgan');
  expect(await self.locator('..').evaluate(element => getComputedStyle(element).justifyContent)).not.toBe('flex-end');
  expect(await remote.locator('..').evaluate(element => getComputedStyle(element).justifyContent)).toBe('flex-end');
  expect(await self.evaluate(element => getComputedStyle(element).color)).toBe('rgb(237, 237, 237)');
  expect(await self.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(await remote.evaluate(element => getComputedStyle(element).backgroundColor));
  await page.screenshot({ path: '../.scratch/agent-dm-main-view.png', animations: 'disabled' });
  await page.setViewportSize({ width: 360, height: 780 });
  await expect(page.getByRole('region', { name: 'Agent conversation with Morgan' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Chats' })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../.scratch/agent-dm-main-view-mobile.png', animations: 'disabled' });
  await expect(page.getByRole('button', { name: 'Back to chats' })).toContainText('Avery');
  await expect(selector).toHaveText('Morgan');
  await expect(header.locator('[data-slot=agent-exchange-icon]')).toHaveCount(1);
  await selector.click(); await page.getByRole('option', { name: 'You', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message Avery' })).toHaveValue('Keep my human draft');
  await expect(header.locator('[data-slot=agent-exchange-icon]')).toHaveCount(1); await expect(header.locator('svg[data-avatar-shape]')).toHaveCount(1);
});


test('typing waits for a routed content stream and appears only in that conversation, including the DM footer', async ({ page }) => {
  await mockDmPeers(page, ['morgan', 'riley']);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/chat/agents/avery');
  const selector = page.getByRole('combobox', { name: 'Chat with' });
  const choose = async (name: string) => { await selector.click(); await page.getByRole('option', { name, exact: true }).click(); };
  let sequence = 0;
  const emit = (event: object) => page.evaluate(event => (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent(event), { agentId: 'avery', channelId: 'avery', runId: 'typing-a', eventId: `scope-${++sequence}`, ...event });
  await emit({ type: 'run_started', clientMessageId: 'a-input' });
  await emit({ type: 'typing', active: true, targets: [] });
  await expect(page.getByText('Avery is typing…')).not.toBeVisible();
  await emit({ type: 'typing', active: true, targets: ['dm:avery:morgan'] });
  await expect(page.getByText('Avery is typing…')).not.toBeVisible();
  const selfAvatar = page.getByRole('region', { name: 'Conversation with Avery' }).getByTestId('chat-avatar').first();
  await expect(selfAvatar.locator('[data-slot="typing-badge"]')).toHaveCount(0);
  await choose('Morgan');
  const footer = page.locator('[aria-label="Agent conversation status"]');
  await expect(footer).toContainText('Avery is typing…');
  await expect(footer.locator('.typing-dot')).toHaveCount(3);
  await expect(footer.locator('.typing-dot').first()).toHaveCSS('animation-name', 'typing-dot');
  await expect(selfAvatar.locator('[data-slot="typing-badge"]')).toBeVisible();
  await choose('Riley');
  await expect(page.getByText('Avery is typing…')).not.toBeVisible();
  await choose('Morgan');
  await emit({ type: 'run_started', agentId: 'morgan', channelId: 'morgan', runId: 'typing-m', clientMessageId: 'm-input' });
  await emit({ type: 'typing', agentId: 'morgan', channelId: 'morgan', runId: 'typing-m', active: true, targets: ['dm:morgan:riley'] });
  await expect(page.getByText('Morgan is typing…')).not.toBeVisible();
  await emit({ type: 'typing', agentId: 'morgan', channelId: 'morgan', runId: 'typing-m', active: true, targets: ['dm:avery:morgan'] });
  await expect(footer).toContainText('Morgan is typing…');
  await expect(footer.locator('.typing-dot')).toHaveCount(6);
  await expect(page.getByRole('form', { name: 'Message composer' })).toHaveCount(0);
  await page.screenshot({ path: '../.scratch/agent-dm-scoped-typing.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(footer.locator('.typing-dot').first()).toHaveCSS('animation-name', 'none');
  await emit({ type: 'typing', active: false, targets: [] });
  await emit({ type: 'done', agentId: 'morgan', channelId: 'morgan', runId: 'typing-m' });
  await expect(footer.locator('.typing-dot')).toHaveCount(0);
  await expect(footer).toContainText('Agent-to-agent conversation');
  await emit({ type: 'typing', agentId: 'morgan', channelId: 'morgan', runId: 'typing-m', active: true, targets: ['dm:avery:morgan'] });
  await expect(footer.locator('.typing-dot')).toHaveCount(0);
});


test('Chat with excludes agents without a DM and discovers an outgoing-only conversation', async ({ page }) => {
  let peers: { id: string; name: string; avatar: null; channelId: string }[] = [];
  await page.route('**/api/agents/avery/dm-peers*', route => route.fulfill({ json: { peers, nextCursor: null } }));
  await page.goto('/chat/agents/avery');
  const selector = page.getByRole('combobox', { name: 'Chat with' });
  await selector.click();
  await expect(page.getByRole('option', { name: 'You', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Morgan', exact: true })).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Riley', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  peers = [{ id: 'morgan', name: 'Morgan', avatar: null, channelId: 'morgan' }];
  await page.evaluate(() => (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent({ type: 'dm_updated', agentId: 'avery', channelId: 'avery', conversationId: 'dm:avery:morgan', eventId: 'first-outgoing-dm' }));
  await selector.click();
  await expect(page.getByRole('option', { name: 'Morgan', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Riley', exact: true })).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Quinn', exact: true })).toHaveCount(0);
});
