import { expect, it } from 'vitest';
import { isTypingInConversation } from './conversation-typing';
it('never fans typing out to the human chat or another peer conversation', () => {
  expect(isTypingInConversation(true, undefined, 'dm:a:b')).toBe(false);
  expect(isTypingInConversation(true, [], 'dm:a:b')).toBe(false);
  expect(isTypingInConversation(true, ['dm:a:b'], 'human-a')).toBe(false);
  expect(isTypingInConversation(true, ['dm:a:b'], 'dm:a:c')).toBe(false);
  expect(isTypingInConversation(true, ['dm:a:b'], 'dm:a:b')).toBe(true);
  expect(isTypingInConversation(false, ['dm:a:b'], 'dm:a:b')).toBe(false);
  expect(isTypingInConversation(true, ['dm:a:b'], 'dm:a:b', false)).toBe(false);
});
