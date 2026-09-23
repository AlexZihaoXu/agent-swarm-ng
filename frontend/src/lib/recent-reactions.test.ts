import { expect, it } from 'vitest';
import { parseRecentReactions, rememberReaction } from './recent-reactions';

it('stores only three distinct supported reactions, most recent first, without invented defaults', () => {
  expect(parseRecentReactions(null)).toEqual([]);
  expect(parseRecentReactions('broken')).toEqual([]);
  expect(parseRecentReactions('{}')).toEqual([]);
  expect(parseRecentReactions('["👍","unknown","🔥","👍","❤️","😂"]')).toEqual(['👍', '🔥', '❤️']);
  expect(rememberReaction(['👍', '🔥', '❤️'], '🔥')).toEqual(['🔥', '👍', '❤️']);
  expect(rememberReaction(['👍', '🔥', '❤️'], '👀')).toEqual(['👀', '👍', '🔥']);
});
