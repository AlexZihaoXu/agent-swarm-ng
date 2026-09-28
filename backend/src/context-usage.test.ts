import { expect, it } from 'vitest';
import { formatContextUsage } from './context-usage';
it('formats estimated main-session context against the configured window', () => {
  expect(formatContextUsage({ tokens: 8192, contextWindow: 32768, percent: 25 })).toContain(
    '≈ 8,192 / 32,768 tokens · 25.0%',
  );
  expect(formatContextUsage({ tokens: 8192, contextWindow: 32768, percent: 25 })).toContain('not cumulative billing');
});
it('does not invent zero usage for unknown data or clamp over-capacity context', () => {
  expect(formatContextUsage(undefined)).toContain('unavailable');
  expect(formatContextUsage({ tokens: null, contextWindow: 32768, percent: null })).toContain('unknown / 32,768');
  expect(formatContextUsage({ tokens: 110, contextWindow: 100, percent: 110 })).toContain('110.0%');
});
