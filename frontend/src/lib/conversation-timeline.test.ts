import { expect, it } from 'vitest';
import { conversationTimeline } from './conversation-timeline';
it('keeps authoritative message order when the wall clock moves backwards', () => {
  const messages = [
    { id: 'old', sequence: 1, author: 'agent' as const, text: 'Earlier', timestamp: 200 },
    { id: 'new', sequence: 2, author: 'user' as const, text: 'Later', timestamp: 100 },
  ];
  expect(conversationTimeline(messages).map(item => item.id)).toEqual(['old', 'new']);
  const notices = [{ id: 'dm', sequence: 1, senderId: 'peer', senderName: 'Peer', senderAvatar: null, conversationId: 'dm:a:peer', preview: 'Received', status: 'completed', timestamp: 150, replyTo: null }];
  const timeline = conversationTimeline(messages, notices);
  expect(timeline.filter(item => item.kind === 'chat').map(item => item.id)).toEqual(['old', 'new']);
  expect(timeline.filter(item => item.kind === 'dm')).toHaveLength(1);
});
