import { describe, expect, it } from 'vitest';
import { advanceFrames, crossfade, settleFrames } from './computer-preview-frames';

describe('crossfade', () => {
  it('keeps the two layers summing to exactly 1 across the whole fade', () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const { previous, current } = crossfade(t);
      expect(previous + current).toBeCloseTo(1, 10);
      expect(previous).toBeCloseTo(1 - t, 10);
      expect(current).toBeCloseTo(t, 10);
    }
  });

  it('clamps out-of-range progress instead of going transparent or additive', () => {
    expect(crossfade(-0.5)).toMatchObject({ previous: 1, current: 0 });
    expect(crossfade(1.5)).toMatchObject({ previous: 0, current: 1 });
  });
});

describe('advanceFrames', () => {
  it('starts a fade with the old frame fully visible and the new one hidden', () => {
    const layers = advanceFrames([{ id: 1, opacity: 1 }], 2, 0);
    expect(layers).toEqual([{ id: 1, opacity: 1 }, { id: 2, opacity: 0 }]);
  });

  it('progresses the in-flight fade while the opacities still sum to 1', () => {
    const fading = advanceFrames([{ id: 1, opacity: 1 }, { id: 2, opacity: 0 }], 2, 0.4);
    expect(fading).toEqual([{ id: 1, opacity: 0.6 }, { id: 2, opacity: 0.4 }]);
    expect(fading[0].opacity + fading[1].opacity).toBeCloseTo(1, 10);
  });

  it('finishes by retiring the old frame', () => {
    const done = advanceFrames([{ id: 1, opacity: 0.2 }, { id: 2, opacity: 0.8 }], 2, 1);
    expect(done.map(layer => layer.opacity)).toEqual([0, 1]);
  });

  it('never holds more than two layers when a frame arrives mid-fade', () => {
    const interrupted = advanceFrames([{ id: 1, opacity: 0.4 }, { id: 2, opacity: 0.6 }], 3, 0);
    expect(interrupted).toHaveLength(2);
    // The then-topmost frame (id 2) becomes the outgoing layer at full opacity.
    expect(interrupted).toEqual([{ id: 2, opacity: 1 }, { id: 3, opacity: 0 }]);
    expect(interrupted[0].opacity + interrupted[1].opacity).toBeCloseTo(1, 10);
  });

  it('handles the first frame with nothing to fade out', () => {
    expect(advanceFrames([], 1, 1)).toEqual([{ id: 1, opacity: 1 }]);
  });
});

describe('settleFrames', () => {
  it('snaps to a single opaque layer for reduced motion', () => {
    expect(settleFrames(7)).toEqual([{ id: 7, opacity: 1 }]);
  });
});
