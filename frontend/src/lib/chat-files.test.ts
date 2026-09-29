import { expect, it } from 'vitest';
import { chatFiles, dmFilesKey, messagePreview, replaceFile, type ChatFile } from './chat-files';

const file = (id: string, status: ChatFile['status'] = 'available') =>
  ({ id, name: `${id}.txt`, kind: 'text', size: 1, status }) as ChatFile;

it('names DM file channels like DM conversations, in sorted order', () => {
  expect(dmFilesKey('b', 'a')).toBe('dm:a:b');
});

it('swaps a deleted file into the messages that carry it and leaves the rest untouched', () => {
  const messages = [{ id: 'm1', files: [file('a'), file('b')] }, { id: 'm2' }];
  const next = replaceFile(messages, file('b', 'deleted'));
  expect(next[0].files!.map(item => item.status)).toEqual(['available', 'deleted']);
  expect(next[1]).toBe(messages[1]);
  expect(replaceFile(messages, file('zzz'))).toBe(messages);
});

it('previews a files-only message by what was sent, and accepts only well-formed files from events', () => {
  expect(messagePreview('', [file('a')])).toBe('📎 a.txt');
  expect(messagePreview(' ', [file('a'), file('b')])).toBe('📎 2 files');
  expect(messagePreview('hi', [file('a')])).toBe('hi');
  expect(chatFiles([file('a'), { id: 1 }, null])).toHaveLength(1);
  expect(chatFiles('nope')).toBeUndefined();
});
