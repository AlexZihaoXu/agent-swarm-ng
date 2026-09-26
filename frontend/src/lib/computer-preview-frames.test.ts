import { describe, expect, it } from 'vitest';
import { advanceFrames, crossfade, settleFrames } from './computer-preview-frames';

describe('crossfade', () => {
  it('keeps the previous frame fully opaque while the new one ramps in', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const { previous, current } = crossfade(t);
      // The whole point: the floor never fades, so brightness never dips.
      expect(previous).toBe(1);
      expect(current).toBeCloseTo(t, 10);
    }
  });

  it('clamps out-of-range progress', () => {
    expect(crossfade(-0.5)).toEqual({ previous: 1, current: 0 });
    expect(crossfade(1.5)).toEqual({ previous: 1, current: 1 });
  });
});

describe('advanceFrames', () => {
  it('starts a fade with the old frame opaque and the new one invisible', () => {
    expect(advanceFrames([{ id: 1, opacity: 1 }], 2, 0)).toEqual([{ id: 1, opacity: 1 }, { id: 2, opacity: 0 }]);
  });

  it('slides only the new layer, leaving the floor at 1 (no breathing dip)', () => {
    const mid = advanceFrames([{ id: 1, opacity: 1 }, { id: 2, opacity: 0 }], 2, 0.4);
    expect(mid).toEqual([{ id: 1, opacity: 1 }, { id: 2, opacity: 0.4 }]);
    // At least one layer is always fully opaque, so the composite never dims.
    expect(Math.max(...mid.map(layer => layer.opacity))).toBe(1);
  });

  it('finishes by holding the new frame at full opacity', () => {
    const done = advanceFrames([{ id: 1, opacity: 1 }, { id: 2, opacity: 0.8 }], 2, 1);
    expect(done).toEqual([{ id: 1, opacity: 1 }, { id: 2, opacity: 1 }]);
  });

  it('promotes the top frame to the floor when a frame arrives mid-ramp', () => {
    const arrived = advanceFrames([{ id: 1, opacity: 1 }, { id: 2, opacity: 0.6 }], 3, 0);
    // Frame 2 (the newest, topmost) becomes the opaque floor; frame 1 is dropped.
    expect(arrived).toEqual([{ id: 2, opacity: 1 }, { id: 3, opacity: 0 }]);
    expect(Math.max(...arrived.map(layer => layer.opacity))).toBe(1);
  });

  it('never holds more than two layers', () => {
    let layers = advanceFrames([], 1, 1);
    for (const id of [2, 3, 4, 5]) layers = advanceFrames(layers, id, 0);
    expect(layers).toHaveLength(2);
    expect(layers.map(layer => layer.id)).toEqual([4, 5]);
  });

  it('paints the first frame opaque instead of dissolving from black', () => {
    // No floor beneath it yet, so a 0-opacity start would dim the card.
    expect(advanceFrames([], 1, 0)).toEqual([{ id: 1, opacity: 1 }]);
    expect(advanceFrames([], 1, 1)).toEqual([{ id: 1, opacity: 1 }]);
  });

  it('keeps a lone frame opaque on every ramp tick', () => {
    // Regression: re-animating the single existing layer faded the very first
    // thumbnail in from black (measured 0.14 -> 0.53 -> 1 in the browser).
    let layers = advanceFrames([], 1, 0);
    for (const t of [0, 0.14, 0.5, 0.86, 1]) {
      layers = advanceFrames(layers, 1, t);
      expect(layers, `ramp tick t=${t} dimmed the lone frame`).toEqual([{ id: 1, opacity: 1 }]);
    }
  });
});

describe('settleFrames', () => {
  it('snaps to a single opaque frame for reduced motion', () => {
    expect(settleFrames(7)).toEqual([{ id: 7, opacity: 1 }]);
  });
});
