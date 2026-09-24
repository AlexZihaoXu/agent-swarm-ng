import { expect, it } from 'vitest';
import { replyExcerpt } from './reply-preview';

it('bounds plain-text reply previews without splitting a surrogate pair at a UTF-16 boundary', () => {
  expect(replyExcerpt('  hello\n  world  ')).toBe('hello world');
  expect(replyExcerpt('a'.repeat(159) + '🌊' + 'tail')).toBe('a'.repeat(159) + '🌊…');
});
