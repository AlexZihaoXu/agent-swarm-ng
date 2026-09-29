import { afterEach, expect, it, vi } from 'vitest';
import { recordScratchActivity, scratchRevision, scratchWriter } from './scratch-writers';

afterEach(() => vi.useRealTimers());

it('shows an agent writing its scratchpad, lingers briefly after, and bumps the revision on each change', () => {
  vi.useFakeTimers();
  recordScratchActivity({ agentId: 'a', path: 'drafts/plan.md', active: true });
  expect(scratchWriter('a')).toBe('drafts/plan.md');
  const before = scratchRevision('a');
  recordScratchActivity({ agentId: 'a', path: 'drafts/plan.md', active: false });
  expect(scratchRevision('a')).toBe(before + 1);
  expect(scratchWriter('a')).toBe('drafts/plan.md'); // still shown for a moment
  // A new change during the linger keeps it shown.
  vi.advanceTimersByTime(1500);
  recordScratchActivity({ agentId: 'a', path: 'notes.md', active: true });
  vi.advanceTimersByTime(2500);
  expect(scratchWriter('a')).toBe('notes.md');
  recordScratchActivity({ agentId: 'a', path: 'notes.md', active: false });
  vi.advanceTimersByTime(2000);
  expect(scratchWriter('a')).toBeUndefined();
  expect(scratchWriter('b')).toBeUndefined();
});
