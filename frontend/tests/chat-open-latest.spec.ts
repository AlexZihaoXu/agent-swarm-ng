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
