/** Fairly high from 75% (yellow), nearly full from 90% (red); below that the dial's own colour (none: the default). */
export const USAGE_HIGH = 0.75,
  USAGE_FULL = 0.9;
export function usageColor(ratio: number, color?: string) {
  return ratio >= USAGE_FULL ? 'var(--usage-full)' : ratio >= USAGE_HIGH ? 'var(--usage-high)' : color;
}
