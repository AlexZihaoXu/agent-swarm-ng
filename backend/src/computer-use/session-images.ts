import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { ScreenshotPool, ScreenshotReference } from './image-pool';

function reference(entry: SessionEntry): ScreenshotReference | null {
  if (
    entry.type !== 'message' ||
    entry.message.role !== 'toolResult' ||
    !['glance', 'look_at', 'read', 'terminal_view', 'read_file'].includes(entry.message.toolName)
  )
    return null;
  const details = entry.message.details as { computerImage?: ScreenshotReference } | undefined;
  const image = details?.computerImage;
  return image && typeof image.id === 'string' && typeof image.agentId === 'string' ? image : null;
}
/** Keep canonical private entries stable across image eviction; no base64 SQLite duplicate. */
export function withoutScreenshotBytes(entry: SessionEntry): SessionEntry {
  if (!reference(entry) || entry.type !== 'message' || entry.message.role !== 'toolResult') return entry;
  return {
    ...entry,
    message: { ...entry.message, content: entry.message.content.filter(block => block.type !== 'image') },
  };
}
export async function hydrateScreenshot(
  entry: SessionEntry,
  agentId: string,
  pool: ScreenshotPool,
): Promise<SessionEntry> {
  const image = reference(entry);
  if (!image || image.agentId !== agentId || entry.type !== 'message' || entry.message.role !== 'toolResult')
    return entry;
  const stored = await pool.read(agentId, image.id);
  if (!stored) return entry; // Its durable text explicitly describes image expiry; no invented pixels.
  return {
    ...entry,
    message: {
      ...entry.message,
      content: [
        ...entry.message.content.filter(block => block.type !== 'image'),
        { type: 'image', data: stored.data.toString('base64'), mimeType: stored.mimeType },
      ],
    },
  };
}
