import { describe, expect, it } from 'vitest';
import { avatarShapes, avatarColors, avatarStates, eyePoses, interpolateEyes, eyePath, defaultAvatar, appearanceFromSeed, randomizeAvatar } from './agent-avatar';
import { blendContour, curvePath, contourPath, contourSpeed, eyelidTransform, faceMotion } from './avatar-motion';

describe('agent avatar identity and motion', () => {
  it('provides eight distinct silhouettes, named colors and only three runtime states', () => {
    expect(avatarShapes).toHaveLength(8);
    expect(new Set(avatarShapes.map(shape => shape.path)).size).toBe(8);
    expect(avatarStates.map(state => state.value)).toEqual(['idle', 'working', 'typing']);
    for (const shape of avatarShapes) expect(shape.path).toMatch(/^M.*Z$/);
    for (const color of avatarColors) expect(color.value).toMatch(/^#[a-f\d]{6}$/i);
  });
  it('keeps compatible eye geometry and interpolates without mutating presets', () => {
    const original = JSON.stringify(eyePoses);
    for (const pose of Object.values(eyePoses)) for (const eye of pose) {
      expect(eye).toHaveLength(6); expect(eye.every(Number.isFinite)).toBe(true); expect(eyePath(eye)).toMatch(/^M.*Q/);
    }
    expect(interpolateEyes(eyePoses.idle, eyePoses.working, 0)).toEqual(eyePoses.idle);
    expect(interpolateEyes(eyePoses.idle, eyePoses.working, 2)).toEqual(eyePoses.working);
    expect(JSON.stringify(eyePoses)).toBe(original);
  });
  it('assigns stable identities and randomizes independently of preview state', () => {
    expect(defaultAvatar('agent-a')).toEqual(defaultAvatar('agent-a'));
    expect(defaultAvatar('agent-a')).not.toEqual(defaultAvatar('agent-b'));
    expect(appearanceFromSeed(123)).toEqual(appearanceFromSeed(123));
    const before = appearanceFromSeed(123), next = randomizeAvatar(before);
    expect([next.shape, next.color]).not.toEqual([before.shape, before.color]);
    expect(next.seed).toBeGreaterThanOrEqual(0); expect(next.seed).toBeLessThanOrEqual(2147483647);
    expect(next).not.toHaveProperty('state');
  });
  it('morphs corresponding contour points without snapping or mutating endpoints', () => {
    const from = [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 20, y: 40 }];
    const to = [{ x: 20, y: 5 }, { x: 40, y: 20 }, { x: 10, y: 50 }];
    expect(blendContour(from, to, 0)).toEqual(from);
    expect(blendContour(from, to, 1)).toEqual(to);
    expect(blendContour(from, to, 0.5)[0]).toEqual({ x: 15, y: 7.5 });
    expect(curvePath(blendContour(from, to, 0.5))).not.toMatch(/NaN|Infinity/);
    expect(from[0]).toEqual({ x: 10, y: 10 });
  });
  it('produces smoothly changing, deterministic bounded contours', () => {
    const points = Array.from({ length: 32 }, (_, i) => ({ x: 32 + Math.cos(i / 32 * Math.PI * 2) * 24, y: 32 + Math.sin(i / 32 * Math.PI * 2) * 24 }));
    const first = contourPath(points, 123, 0);
    expect(first).toBe(contourPath(points, 123, 0));
    expect(first).not.toBe(contourPath(points, 123, 2));
    expect(first).not.toBe(contourPath(points, 456, 0));
    expect(first).not.toMatch(/NaN|Infinity/);
    for (const coordinate of first.match(/-?\d+(?:\.\d+)?/g)!.map(Number)) { expect(coordinate).toBeGreaterThan(4); expect(coordinate).toBeLessThan(60); }
  });
  it('speeds up active contours and closes eyelids without rotating or narrowing their width', () => {
    expect(contourSpeed).toEqual({ idle: 1, working: 8, typing: 12 });
    expect(eyelidTransform(eyePoses.idle[0], 0)).toBe('translate(25 28.5) scale(1 1) translate(-25 -28.5)');
    expect(eyelidTransform(eyePoses.idle[0], 1)).toBe('translate(25 28.5) scale(1 0.06) translate(-25 -28.5)');
    expect(eyelidTransform([25, 28, 25, 28, 25, 28], 1)).toContain('scale(1 0.06)');
    expect(eyelidTransform(eyePoses.idle[0], 0.5)).not.toMatch(/rotate|skew/);
  });
  it('blinks, rests and glances with bounded motion that differs across seeds', () => {
    const frames = Array.from({ length: 1600 }, (_, i) => faceMotion(123, i / 50, 'idle'));
    expect(frames.some(frame => frame.blink > 0.95)).toBe(true);
    expect(frames.some(frame => frame.blink === 0 && frame.x === 0)).toBe(true);
    expect(frames.some(frame => Math.abs(frame.x) > 0.5)).toBe(true);
    expect(frames.every(frame => frame.blink >= 0 && frame.blink <= 1 && Math.abs(frame.x) <= 2.5 && Math.abs(frame.y) <= 1.3)).toBe(true);
    expect(faceMotion(123, 4, 'idle')).toEqual(faceMotion(123, 4, 'idle'));
    expect(Array.from({ length: 20 }, (_, i) => faceMotion(123, i, 'idle'))).not.toEqual(Array.from({ length: 20 }, (_, i) => faceMotion(456, i, 'idle')));
  });
});
