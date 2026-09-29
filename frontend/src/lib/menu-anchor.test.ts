import { expect, it } from 'vitest';
import { menuAnchorX } from './menu-anchor';

it('opens a context menu at a point where it fits on one side of it', () => {
  expect(menuAnchorX(40, 390)).toBe(40); // room on the right
  expect(menuAnchorX(380, 390)).toBe(380); // flips left from near the right edge
  // From the middle of a phone neither side fits: move right until the flipped menu does.
  expect(menuAnchorX(195, 390)).toBe(296);
  expect(menuAnchorX(1200, 1440)).toBe(1200);
});
