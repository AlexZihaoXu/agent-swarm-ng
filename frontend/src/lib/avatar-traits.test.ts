import { describe, expect, it } from 'vitest';
import {
  accentColor,
  appearanceFromSeed,
  avatarAccessories,
  avatarColors,
  avatarMarkings,
  avatarMouths,
  avatarRanges,
  defaultAvatar,
  mutateAvatar,
  sameAvatar,
  richAppearanceFromSeed,
  type AvatarAppearance,
  type AvatarRange,
} from './agent-avatar';
import { shapeOutline, type Point } from './avatar-motion';

const seeds = Array.from({ length: 400 }, (_, i) => (i * 2654435761) >>> 1);
const ranges = Object.keys(avatarRanges) as AvatarRange[];
const inRange = (avatar: AvatarAppearance) =>
  ranges.every(trait => {
    const value = avatar[trait];
    return value === undefined || (value >= avatarRanges[trait].min && value <= avatarRanges[trait].max);
  });

describe('extended avatar traits', () => {
  it('leaves default (unsaved) avatars exactly as they were', () => {
    // The original generator: classic six colours and no extended traits, so no existing agent changes look.
    for (const seed of seeds) {
      const avatar = appearanceFromSeed(seed);
      expect(Object.keys(avatar).sort()).toEqual(['color', 'eyeStyle', 'seed', 'shape']);
      expect(avatarColors.slice(0, 6).map(item => item.value)).toContain(avatar.color);
    }
    expect(defaultAvatar('agent-1')).toEqual(defaultAvatar('agent-1'));
  });

  it('randomizes across every trait, repeatably and within range, keeping most avatars simple', () => {
    const avatars = seeds.map(richAppearanceFromSeed);
    expect(richAppearanceFromSeed(seeds[3])).toEqual(avatars[3]);
    expect(avatars.every(inRange)).toBe(true);
    for (const [key, options] of [
      ['mouth', avatarMouths],
      ['marking', avatarMarkings],
      ['accessory', avatarAccessories],
    ] as const)
      expect(new Set(avatars.map(avatar => avatar[key]))).toEqual(new Set(options.map(option => option.value)));
    const plain = avatars.filter(avatar => avatar.accessory === 'none').length / avatars.length;
    expect(plain).toBeGreaterThan(0.55);
    expect(new Set(avatars.map(avatar => JSON.stringify({ ...avatar, seed: 0 }))).size).toBeGreaterThan(390);
  });

  it('variations make two visible changes, stay in range, and a grid of them differs from each other', () => {
    for (const seed of seeds.slice(0, 20)) {
      const base = richAppearanceFromSeed(seed);
      const grid = Array.from({ length: 8 }, (_, i) => mutateAvatar(base, i + 1));
      for (const next of grid) {
        expect(inRange(next)).toBe(true);
        const changed = (Object.keys({ ...base, ...next }) as (keyof AvatarAppearance)[]).filter(
          key => key !== 'seed' && base[key] !== next[key],
        );
        // Two kinds of change; eyes and proportions each move three traits.
        expect(changed.length).toBeGreaterThanOrEqual(2);
        expect(changed.length).toBeLessThanOrEqual(6);
        expect(sameAvatar(base, next)).toBe(false);
      }
      // No two tiles in a grid look alike.
      expect(new Set(grid.map(next => JSON.stringify({ ...next, seed: 0 }))).size).toBe(8);
    }
  });

  it('treats unset traits as their defaults and colours without case when comparing looks', () => {
    const saved = { shape: 'pebble' as const, color: '#6795F8', seed: 4 };
    expect(sameAvatar(saved, { ...saved, color: '#6795f8', mouth: 'none', stretch: 0, eyeStyle: 'pill' })).toBe(true);
    // A change to any single trait is a change (the settings page must offer to save it).
    for (const change of [{ mouth: 'smile' }, { accessory: 'sprout' }, { accent: '#ffffff' }, { taper: 0.4 }] as const)
      expect(sameAvatar(saved, { ...saved, ...change })).toBe(false);
  });

  it('variation moves are clear but not always to an extreme, and reach both directions', () => {
    const base = { shape: 'pebble' as const, color: '#6795f8', seed: 11 };
    const stretches = Array.from({ length: 200 }, (_, i) => mutateAvatar(base, i * 7 + 6).stretch).filter(
      (value): value is number => value !== undefined,
    );
    expect(stretches.some(value => value > 0.2)).toBe(true);
    expect(stretches.some(value => value < -0.2)).toBe(true);
    expect(stretches.every(value => Math.abs(value) >= 0.3)).toBe(true); // a visible move from the default 0
    expect(stretches.some(value => Math.abs(value) < 0.9)).toBe(true); // not only the ends
  });

  it('derives a lighter accent from the body unless one is chosen', () => {
    expect(accentColor({ color: '#000000' })).toBe('#737373');
    expect(accentColor({ color: '#6795f8', accent: '#e8656f' })).toBe('#e8656f');
  });

  it('keeps every proportioned outline inside the 64-unit box', () => {
    const circle: Point[] = Array.from({ length: 32 }, (_, i) => ({
      x: 32 + Math.cos((i / 32) * Math.PI * 2) * 26,
      y: 32 + Math.sin((i / 32) * Math.PI * 2) * 26,
    }));
    for (const seed of seeds.slice(0, 50))
      for (const stretch of [-1, 1])
        for (const taper of [-1, 1]) {
          const points = shapeOutline(circle, { stretch, taper, wobble: 1 }, seed);
          for (const point of points) {
            expect(point.x).toBeGreaterThanOrEqual(3);
            expect(point.x).toBeLessThanOrEqual(61);
            expect(point.y).toBeGreaterThanOrEqual(3);
            expect(point.y).toBeLessThanOrEqual(61);
          }
        }
    expect(shapeOutline(circle, {}, 1)).toBe(circle);
  });
});
