import { expect, it } from 'vitest';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { withoutScreenshotBytes } from './session-images';

const result = (toolName: string, details: object) =>
  ({
    type: 'message',
    id: 'e1',
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: 'toolResult',
      toolCallId: 'c1',
      toolName,
      content: [
        { type: 'text', text: '{"path":"wallpapers/01.jpg","kind":"image"}' },
        { type: 'image', data: 'A'.repeat(900_000), mimeType: 'image/jpeg' },
      ],
      details,
      isError: false,
      timestamp: Date.now(),
    },
  }) as unknown as SessionEntry;

it('keeps no pooled image bytes in a checkpoint, whichever platform tool pooled it (scratch_read too)', () => {
  const reference = { computerImage: { id: 'img-1', agentId: 'agent-1', mimeType: 'image/jpeg' } };
  for (const tool of ['scratch_read', 'glance', 'read_file']) {
    const saved = withoutScreenshotBytes(result(tool, reference));
    const content = (saved as { message: { content: { type: string }[] } }).message.content;
    expect(content.map(block => block.type)).toEqual(['text']);
    expect(JSON.stringify(saved).length).toBeLessThan(2000);
  }
  // Without a pooled reference the image is all there is: kept.
  const inline = withoutScreenshotBytes(result('scratch_read', {}));
  expect((inline as { message: { content: unknown[] } }).message.content).toHaveLength(2);
});
