import { expect, it } from 'vitest';
import { continuesGroup } from './group-message-layout';

it('groups only adjacent same-author messages within five minutes and the same day', () => {
  const first = { groupId: 'g', role: 'assistant', authorId: 'a', timestamp: new Date(2026, 8, 24, 12).getTime() };
  expect(continuesGroup(undefined, first)).toBe(false);
  expect(continuesGroup(first, { ...first, timestamp: first.timestamp + 300000 })).toBe(true);
  expect(continuesGroup(first, { ...first, timestamp: first.timestamp + 300001 })).toBe(false);
  expect(continuesGroup(first, { ...first, timestamp: first.timestamp - 1 })).toBe(false);
  expect(continuesGroup(first, { ...first, authorId: 'b' })).toBe(false);
  expect(continuesGroup(first, { ...first, role: 'user', authorId: null })).toBe(false);
  expect(continuesGroup(first, { ...first, groupId: 'other' })).toBe(false);
  const midnight = new Date(2026, 8, 25).getTime();
  expect(continuesGroup({ ...first, timestamp: midnight - 1 }, { ...first, timestamp: midnight })).toBe(false);
});
