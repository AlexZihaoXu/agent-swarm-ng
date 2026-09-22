import { expect, it } from 'vitest';
import { agentBubbleStyle } from './bubble-color';
it('derives subtle sender tints while retaining the theme foreground', () => {
  for (const color of ['#ffffff', '#000000', '#f7ad51', '#112233']) {
    const style = agentBubbleStyle(color);
    expect(style.backgroundColor).toBe(`color-mix(in srgb, ${color} 18%, var(--background))`);
    expect(style.color).toBe('var(--foreground)');
    expect(style.boxShadow).toContain(`${color} 28%`);
  }
});
