import { describe, expect, it } from 'vitest';
import { createLiquidContour, restingContour } from './liquid-presence';

const coordinates = (path: string) => path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
describe('liquid presence contour', () => {
  it('settles exactly into the resting circle', () => {
    expect(createLiquidContour(123)(8000, 0)).toBe(restingContour);
  });
  it('is deterministic per seed but not a repeating star or rotation loop', () => {
    const contour = createLiquidContour(123);
    expect(contour(500)).toBe(createLiquidContour(123)(500));
    expect(contour(500)).not.toBe(createLiquidContour(456)(500));
    const paths = [0, 600, 1200, 2400, 4800, 9600].map(time => contour(time));
    expect(new Set(paths).size).toBe(paths.length);
  });
  it('changes continuously and stays inside the badge bounds', () => {
    for (const seed of [1, 123, 456, 98765]) {
      const contour = createLiquidContour(seed);
      for (let time = 0; time < 20000; time += 137) {
        const before = coordinates(contour(time));
        const after = coordinates(contour(time + 1));
        expect(before.every(value => value >= 2 && value <= 22)).toBe(true);
        expect(Math.max(...before.map((value, index) => Math.abs(value - after[index])))).toBeLessThan(0.08);
      }
    }
  });
});
