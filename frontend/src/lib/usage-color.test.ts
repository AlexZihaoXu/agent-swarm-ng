import { expect, it } from 'vitest';
import { usageColor } from './usage-color';

it('keeps the dial colour until fairly high, then yellow, then red when nearly full', () => {
  expect(usageColor(0.5, 'var(--usage-cpu)')).toBe('var(--usage-cpu)');
  expect(usageColor(0.74, undefined)).toBeUndefined();
  expect(usageColor(0.75, 'var(--usage-cpu)')).toBe('var(--usage-high)');
  expect(usageColor(0.9, 'var(--usage-cpu)')).toBe('var(--usage-full)');
});
