import { deflateSync } from 'node:zlib';
import { test, expect } from './fixtures';

/** A solid PNG of the given size (its height is only known once it loads, like a real photo). */
function png(width: number, height: number) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (data: Buffer) => {
    let c = 0xffffffff;
    for (const byte of data) c = table[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x60)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('an opened chat stays at its latest message while images below load', async ({ page }) => {
  const image = png(400, 600);
  await page.route(/\/api\/files\/[^/]+\/content(\?.*)?$/, async route => {
    await new Promise(resolve => setTimeout(resolve, 1200));
    await route.fulfill({ body: image, contentType: 'image/png' });
  });
  const messages = Array.from({ length: 30 }, (_, index) => ({
    id: `m${index}`,
    channelId: 'avery',
    sequence: index + 1,
    role: index % 2 ? 'assistant' : 'user',
    text: `Message ${index}: ${'words '.repeat(12)}`,
    timestamp: Date.now() - (30 - index) * 60_000,
    replyTo: null,
    ...(index >= 27
      ? {
          files: [
            {
              id: `f${index}`,
              channelKey: 'chat:avery',
              name: `photo-${index}.png`,
              mime: 'image/png',
              kind: 'image',
              size: 4096,
              status: 'available',
              uploader: { kind: 'agent', id: 'avery', name: 'Avery' },
              messageKind: 'chat',
              messageId: `m${index}`,
              createdAt: new Date().toISOString(),
            },
          ],
        }
      : {}),
  }));
  await page.route('**/api/channels/avery/messages*', route => route.fulfill({ json: { messages, nextCursor: null } }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/chat/agents/avery');
  const chat = page.getByRole('region', { name: 'Conversation with Avery' });
  await expect(chat.getByText('Message 29:')).toBeVisible();
  // Every photo has loaded (and grown its message).
  await expect
    .poll(
      () =>
        page
          .locator('img[alt^="photo-"]')
          .evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0)),
      { timeout: 10_000 },
    )
    .toBe(true);
  await page.waitForTimeout(300);
  const fromBottom = await chat
    .getByRole('region', { name: 'Chat history' })
    .evaluate(root => root.scrollHeight - root.scrollTop - root.clientHeight);
  expect(fromBottom).toBeLessThan(8);
});

test('a new message from the agent scrolls into view when the reader is at the bottom', async ({ page }) => {
  const messages = Array.from({ length: 30 }, (_, index) => ({
    id: `m${index}`,
    channelId: 'avery',
    sequence: index + 1,
    role: index % 2 ? 'assistant' : 'user',
    text: `Message ${index}: ${'words '.repeat(12)}`,
    timestamp: Date.now() - (30 - index) * 60_000,
    replyTo: null,
  }));
  await page.route('**/api/channels/avery/messages*', route => route.fulfill({ json: { messages, nextCursor: null } }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/chat/agents/avery');
  const chat = page.getByRole('region', { name: 'Conversation with Avery' });
  await expect(chat.getByText('Message 29:')).toBeVisible();
  const history = chat.getByRole('region', { name: 'Chat history' });
  const fromBottom = () => history.evaluate(root => root.scrollHeight - root.scrollTop - root.clientHeight);
  await expect.poll(fromBottom).toBeLessThan(8);
  for (const [index, text] of [
    'A short reply.',
    `A long reply.\n\n${'More detail here. '.repeat(40)}\n\n- one\n- two\n- three`,
  ].entries()) {
    await page.evaluate(
      event => (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent(event),
      {
        type: 'channel_message',
        agentId: 'avery',
        channelId: 'avery',
        runId: `r${index}`,
        id: `new-${index}`,
        text,
        timestamp: Date.now(),
      },
    );
    await expect(chat.getByText(text.split('\n')[0]!)).toBeVisible();
    await expect.poll(fromBottom, { timeout: 3000 }).toBeLessThan(8);
  }
});

test('the floating chat follows a new message from the agent too', async ({ page }) => {
  const messages = Array.from({ length: 30 }, (_, index) => ({
    id: `g${index}`,
    channelId: 'morgan',
    sequence: index + 1,
    role: index % 2 ? 'assistant' : 'user',
    text: `Morgan message ${index}: ${'words '.repeat(12)}`,
    timestamp: Date.now() - (30 - index) * 60_000,
    replyTo: null,
  }));
  await page.route('**/api/channels/morgan/messages*', route =>
    route.fulfill({ json: { messages, nextCursor: null } }),
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/chat/agents/avery');
  await expect(page.getByRole('link', { name: 'Settings' }).first()).toBeVisible();
  await page.keyboard.press('Control+k');
  const portal = page.getByRole('dialog', { name: 'Portal' });
  await portal.getByRole('combobox').fill('@morg');
  await expect(portal.getByRole('option', { name: /Morgan/, selected: true })).toBeVisible();
  await portal.getByRole('combobox').press('Enter');
  const window_ = page.getByRole('region', { name: 'Chat with Morgan' });
  const history = window_.getByRole('region', { name: 'Messages with Morgan' });
  await expect(history.getByText('Morgan message 29:')).toBeVisible();
  const fromBottom = () => history.evaluate(root => root.scrollHeight - root.scrollTop - root.clientHeight);
  await expect.poll(fromBottom).toBeLessThan(8);
  await page.evaluate(
    event => (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent(event),
    {
      type: 'channel_message',
      agentId: 'morgan',
      channelId: 'morgan',
      runId: 'rf',
      id: 'new-floating',
      text: `Done.\n\n${'Here is what changed. '.repeat(30)}`,
      timestamp: Date.now(),
    },
  );
  await expect(history.getByText('Done.')).toBeVisible();
  await expect.poll(fromBottom, { timeout: 3000 }).toBeLessThan(8);
});

test('sending a message scrolls to it even when the reader had scrolled up', async ({ page }) => {
  const messages = Array.from({ length: 40 }, (_, index) => ({
    id: `m${index}`,
    channelId: 'avery',
    sequence: index + 1,
    role: index % 2 ? 'assistant' : 'user',
    text: `Message ${index}: ${'words '.repeat(12)}`,
    timestamp: Date.now() - (40 - index) * 60_000,
    replyTo: null,
  }));
  await page.route('**/api/channels/avery/messages*', route => route.fulfill({ json: { messages, nextCursor: null } }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/chat/agents/avery');
  const chat = page.getByRole('region', { name: 'Conversation with Avery' });
  await expect(chat.getByText('Message 39:')).toBeVisible();
  const history = chat.getByRole('region', { name: 'Chat history' });
  const fromBottom = () => history.evaluate(root => root.scrollHeight - root.scrollTop - root.clientHeight);
  // Opening goes straight to the latest message (no scroll from the top).
  expect(await fromBottom()).toBeLessThan(8);
  await history.evaluate(root => {
    root.scrollTop = 0;
  });
  await expect.poll(fromBottom).toBeGreaterThan(300);
  await page.getByLabel('Message Avery').fill('Sent while scrolled up');
  await page.getByLabel('Message Avery').press('Enter');
  await expect(chat.getByText('Sent while scrolled up')).toBeVisible();
  await expect.poll(fromBottom, { timeout: 3000 }).toBeLessThan(8);
});

test('a long chat (a full window of 150) shows a new message all the way down, and stays down as the chat gets shorter', async ({
  page,
}) => {
  const messages = Array.from({ length: 200 }, (_, index) => ({
    id: `m${index}`,
    channelId: 'avery',
    sequence: index + 1,
    role: index % 2 ? 'assistant' : 'user',
    text: `Message ${index}: ${'words '.repeat(8)}`,
    timestamp: Date.now() - (200 - index) * 60_000,
    replyTo: null,
  }));
  await page.route('**/api/channels/avery/messages*', route => route.fulfill({ json: { messages, nextCursor: null } }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/chat/agents/avery');
  const chat = page.getByRole('region', { name: 'Conversation with Avery' });
  await expect(chat.getByText('Message 199:')).toBeVisible();
  const history = chat.getByRole('region', { name: 'Chat history' });
  const fromBottom = () => history.evaluate(root => root.scrollHeight - root.scrollTop - root.clientHeight);
  await expect.poll(fromBottom).toBeLessThan(8);
  for (let n = 0; n < 3; n++) {
    await page.evaluate(
      event => (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent(event),
      {
        type: 'channel_message',
        agentId: 'avery',
        channelId: 'avery',
        runId: `r${n}`,
        id: `new-${n}`,
        text: `Fresh reply ${n}`,
        timestamp: Date.now(),
      },
    );
    await expect(chat.getByText(`Fresh reply ${n}`)).toBeVisible({ timeout: 3000 });
    await expect.poll(fromBottom, { timeout: 3000 }).toBeLessThan(2);
  }
  // The chat area gets shorter (here the window; a to-do list or a taller composer does the same): still at the end.
  await page.setViewportSize({ width: 1280, height: 600 });
  await expect.poll(fromBottom, { timeout: 3000 }).toBeLessThan(2);
});

test('a reply after you send, while the agent works with a to-do bar, ends fully in view (agents loading late)', async ({
  page,
}) => {
  const messages = Array.from({ length: 40 }, (_, index) => ({
    id: `m${index}`,
    channelId: 'avery',
    sequence: index + 1,
    role: index % 2 ? 'assistant' : 'user',
    text: `Message ${index}: ${'words '.repeat(20)}\n\n\`code\` and more`,
    timestamp: Date.now() - (40 - index) * 60_000,
    replyTo: null,
  }));
  await page.route('**/api/channels/avery/messages*', route => route.fulfill({ json: { messages, nextCursor: null } }));
  // The agent list arrives late (the app opened straight into this chat).
  await page.route(/\/api\/agents(\?.*)?$/, async route => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    await route.fallback();
  });
  await page.setViewportSize({ width: 1000, height: 580 });
  await page.goto('/chat/agents/avery');
  const chat = page.getByRole('region', { name: 'Conversation with Avery' });
  await expect(chat.getByText('Message 39:')).toBeVisible();
  const history = chat.getByRole('region', { name: 'Chat history' });
  const fromBottom = () => history.evaluate(root => root.scrollHeight - root.scrollTop - root.clientHeight);
  const emit = (event: object) =>
    page.evaluate(e => (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent(e), event);
  await emit({
    type: 'todos_updated',
    eventId: 't1',
    runId: 'platform',
    agentId: 'avery',
    channelId: 'platform',
    todos: [{ content: 'LB-6: execute Rust WebRTC spike and track stages', status: 'in_progress' }],
  });
  await page.getByLabel('Message Avery').fill('which model were u on');
  await page.getByLabel('Message Avery').press('Enter');
  await expect(chat.getByText('which model were u on')).toBeVisible();
  await expect.poll(fromBottom).toBeLessThan(2);
  await emit({
    type: 'channel_message',
    agentId: 'avery',
    channelId: 'avery',
    runId: 'rx',
    id: 'reply-x',
    timestamp: Date.now(),
    text: '**LB-6** is In progress. A separate Claude session was on `opus`.\n\n- one\n- two\n- three\n\nMore text here that wraps a few lines to make the bubble tall. '.repeat(
      2,
    ),
  });
  await expect.poll(fromBottom, { timeout: 3000 }).toBeLessThan(2);
});
