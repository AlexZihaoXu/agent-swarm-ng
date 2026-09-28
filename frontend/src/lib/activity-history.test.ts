import { expect, it } from 'vitest';
import { mergeActivity, reconcileActivityPage, type ActivityEntry } from './activity-history';
const entry = (revision: number, text: string, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({ id: 'run:one', runId: 'run', channelId: 'channel', kind: 'thinking', label: 'Thinking', timestamp: 1, sequence: 1, revision, offset: 0, text, nextOffset: null, ...extra });
it('reconciles older snapshots, duplicate live replacements and out-of-order revisions', () => {
  const live = [entry(3, 'latest')];
  expect(mergeActivity(live, [entry(2, 'old')])).toEqual(live);
  expect(mergeActivity(live, [entry(3, 'latest')], true)).toEqual(live);
  expect(mergeActivity(live, [entry(4, 'replacement')])[0].text).toBe('replacement');
});
it('expands Unicode fragments once, preserves expansion on duplicate previews and resets changed revisions', () => {
  const first = entry(1, '😀', { nextOffset: 4 });
  const expanded = mergeActivity([first], [entry(1, 'tail', { offset: 4 })]);
  expect(expanded[0].text).toBe('😀tail');
  expect(mergeActivity(expanded, [entry(1, 'tail', { offset: 4 }), first])).toEqual(expanded);
  expect(mergeActivity(expanded, [entry(2, 'new')])[0].text).toBe('new');
  expect(mergeActivity(expanded, [entry(2, 'stale fragment', { offset: 4 })])).toEqual(expanded);
});
it('preserves expanded text in overlapping entries when reconnect refreshes the bounded window', () => {
  const expanded = entry(2, 'expanded text', { nextOffset: 13, totalLength: 20 });
  const preview = entry(2, 'expanded', { nextOffset: 8, totalLength: 20 });
  expect(reconcileActivityPage([expanded], [preview], [expanded])[0]).toEqual(expanded);
});
it('restores completed/active history chronologically and preserves races while bounding a reconnect window', () => {
  const old = entry(1, 'old', { id: 'old', sequence: 1 });
  const newer = entry(1, 'new', { id: 'new', sequence: 2 });
  const live = entry(3, 'in flight', { id: 'live', sequence: 3 });
  expect(reconcileActivityPage([old, live], [newer, entry(2, 'snapshot', { id: 'live', sequence: 3 })], [old])).toEqual([newer, live]);
  expect(reconcileActivityPage([newer, live], [old, newer])).toEqual([old, newer, live]);
});
