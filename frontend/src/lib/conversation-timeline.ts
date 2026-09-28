import type { ChatMessage } from '../chat-types';
import type { DmNotice } from '../use-dm-inbox';

export function conversationTimeline(messages: ChatMessage[], notices: DmNotice[] = []) {
  type Item =
    | { kind: 'chat'; message: ChatMessage; timestamp: number; id: string }
    | { kind: 'dm'; notice: DmNotice; timestamp: number; id: string };
  // Message sequence is authoritative even if the wall clock moves backwards.
  const timeline: Item[] = messages.map(message => ({
    kind: 'chat',
    message,
    timestamp: message.timestamp ?? 0,
    id: message.id,
  }));
  for (const notice of [...notices].sort((a, b) => a.timestamp - b.timestamp || a.sequence - b.sequence)) {
    const index = timeline.findIndex(item => item.timestamp > notice.timestamp);
    timeline.splice(index < 0 ? timeline.length : index, 0, {
      kind: 'dm',
      notice,
      timestamp: notice.timestamp,
      id: `dm:${notice.id}`,
    });
  }
  return timeline;
}
