import { expect, it } from 'vitest';
import { channelReply, channelReplyContext, dmReply, groupReply, replyExcerpt } from './reply-preview';

it('provides one bounded plain-text parent preview with trustworthy stored author metadata', () => {
  const row = { replyTo: { id: 'parent', role: 'user' as const, text: '  hello\n  ' + '🌊'.repeat(161) } };
  expect(replyExcerpt(row.replyTo.text)).toBe(`hello ${'🌊'.repeat(154)}…`);
  expect(channelReply(row)).toMatchObject({ id: 'parent', role: 'user' });
  expect(channelReplyContext(row, 'Agent')).toMatchObject({ author: 'Human', id: 'parent' });
  expect(groupReply({ replyTo: { ...row.replyTo, authorId: null, authorName: 'You' } })).toMatchObject({
    id: 'parent',
    authorName: 'You',
  });
  expect(dmReply({ replyTo: { id: 'parent', senderId: 'a', sender: { name: 'A' }, text: 'DM' } })).toEqual({
    id: 'parent',
    senderId: 'a',
    senderName: 'A',
    text: 'DM',
  });
});
