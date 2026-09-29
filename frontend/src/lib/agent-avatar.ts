/** Original vector artwork. Identity geometry stays separate from runtime state. */
export const avatarShapes = [
  {
    id: 'pebble',
    label: 'Pebble',
    tilt: -7,
    path: 'M31 7 C47 4 59 18 57 36 C56 51 43 58 27 57 C12 56 5 46 7 30 C8 15 17 9 31 7 Z',
  },
  {
    id: 'squircle',
    label: 'Squircle',
    tilt: -5,
    path: 'M22 8 H42 C52 8 56 13 56 23 V41 C56 52 51 56 40 56 H23 C12 56 8 51 8 40 V24 C8 13 12 8 22 8 Z',
  },
  {
    id: 'gumdrop',
    label: 'Gumdrop',
    tilt: 5,
    path: 'M9 42 C9 22 18 7 31 7 C45 7 55 22 55 42 C55 51 51 55 43 55 H21 C13 55 9 51 9 42 Z',
  },
  { id: 'triangle', label: 'Triangle', tilt: -6, path: 'M26 11 Q32 2 38 11 L56 42 Q64 55 49 56 H15 Q1 55 8 42 Z' },
  {
    id: 'bean',
    label: 'Bean',
    tilt: 7,
    path: 'M39 7 C55 8 61 22 55 34 C50 43 42 43 39 49 C33 61 15 59 9 47 C2 33 8 15 22 9 C27 7 34 6 39 7 Z',
  },
  {
    id: 'pear',
    label: 'Pear',
    tilt: -4,
    path: 'M32 7 C44 7 43 20 50 29 C63 46 53 58 33 58 C13 58 3 47 13 30 C20 19 19 7 32 7 Z',
  },
  { id: 'capsule', label: 'Capsule', tilt: 5, path: 'M23 14 H41 C65 14 65 50 41 50 H23 C-1 50 -1 14 23 14 Z' },
  {
    id: 'diamond',
    label: 'Diamond',
    tilt: 0,
    path: 'M24 10 Q32 3 40 10 L54 24 Q61 32 54 40 L40 54 Q32 61 24 54 L10 40 Q3 32 10 24 Z',
  },
] as const;
export type AvatarShape = (typeof avatarShapes)[number]['id'];
export const avatarColors = [
  { label: 'Sea glass', value: '#55bea9' },
  { label: 'Apricot', value: '#f7ad51' },
  { label: 'Iris', value: '#a17af2' },
  { label: 'Cornflower', value: '#6795f8' },
  { label: 'Coral', value: '#f77d57' },
  { label: 'Rose', value: '#ee88b2' },
  // Added with the extended traits; the first six keep existing default avatars unchanged.
  { label: 'Lemon', value: '#eed35f' },
  { label: 'Mint', value: '#7fd3a3' },
  { label: 'Sky', value: '#61c1e6' },
  { label: 'Lilac', value: '#c69cf0' },
  { label: 'Cherry', value: '#e8656f' },
  { label: 'Sage', value: '#a3bf8c' },
] as const;
/** Colours that existed before the extended traits: default (unsaved) avatars keep choosing from these. */
const classicColors = avatarColors.slice(0, 6);
export type EyePose = readonly [readonly number[], readonly number[]];
export const eyePoses = {
  idle: [
    [25, 25, 25, 28.5, 25, 32],
    [38, 24, 38, 27.5, 38, 31],
  ],
  working: [
    [25, 24, 25, 28, 25, 32],
    [38, 23, 38, 27, 38, 31],
  ],
  typing: [
    [25, 23.5, 25, 28, 25, 32.5],
    [38, 22.5, 38, 27, 38, 31.5],
  ],
} as const satisfies Record<string, EyePose>;
export type AvatarState = keyof typeof eyePoses;
export const avatarStates: { value: AvatarState; label: string }[] = [
  { value: 'idle', label: 'Idle' },
  { value: 'working', label: 'Working' },
  { value: 'typing', label: 'Typing' },
];
export const avatarMouths = [
  { value: 'none', label: 'None' },
  { value: 'smile', label: 'Smile' },
  { value: 'flat', label: 'Flat' },
  { value: 'open', label: 'Open' },
  { value: 'cat', label: 'Cat' },
] as const;
export const avatarMarkings = [
  { value: 'none', label: 'None' },
  { value: 'cheeks', label: 'Cheeks' },
  { value: 'spots', label: 'Spots' },
  { value: 'belly', label: 'Belly' },
  { value: 'stripe', label: 'Stripe' },
] as const;
export const avatarAccessories = [
  { value: 'none', label: 'None' },
  { value: 'antenna', label: 'Antenna' },
  { value: 'sprout', label: 'Sprout' },
  { value: 'bow', label: 'Bow' },
  { value: 'halo', label: 'Halo' },
  { value: 'glasses', label: 'Glasses' },
] as const;
export type AvatarMouth = (typeof avatarMouths)[number]['value'];
export type AvatarMarking = (typeof avatarMarkings)[number]['value'];
export type AvatarAccessory = (typeof avatarAccessories)[number]['value'];
/** Continuous traits and their ranges; every one defaults to the plain shape (0, or 1 for eye size). */
export const avatarRanges = {
  stretch: { min: -1, max: 1, label: 'Wide ↔ tall' },
  taper: { min: -1, max: 1, label: 'Taper' },
  wobble: { min: 0, max: 1, label: 'Wobble' },
  eyeSize: { min: 0.75, max: 1.35, label: 'Eye size' },
  eyeGap: { min: -1, max: 1, label: 'Eye spacing' },
} as const;
export type AvatarRange = keyof typeof avatarRanges;

/**
 * An agent's look. Only shape, colour and seed are required: every later trait is optional and its absence draws
 * the original look, so avatars saved before a trait existed never change.
 */
export type AvatarAppearance = {
  shape: AvatarShape;
  color: string;
  seed: number;
  eyeStyle?: 'pill' | 'round';
  stretch?: number;
  taper?: number;
  wobble?: number;
  eyeSize?: number;
  eyeGap?: number;
  mouth?: AvatarMouth;
  marking?: AvatarMarking;
  /** Markings and accessories; a lighter tint of the body colour when not set. */
  accent?: string;
  accessory?: AvatarAccessory;
};
/** The original look from a seed; default avatars of agents that never saved one use it, so they never change. */
export function appearanceFromSeed(seed: number): AvatarAppearance {
  return {
    shape: avatarShapes[Math.floor(variation(seed, 1) * avatarShapes.length)].id,
    color: classicColors[Math.floor(variation(seed, 2) * classicColors.length)].value,
    seed,
    eyeStyle: variation(seed, 3) < 0.5 ? 'pill' : 'round',
  };
}
const round2 = (value: number) => Math.round(value * 100) / 100;
const pick = <T>(items: readonly T[], amount: number) =>
  items[Math.min(items.length - 1, Math.floor(amount * items.length))];
/** Keeps a continuous trait inside its range, rounded to what the editor shows. */
export const clampTrait = (trait: AvatarRange, value: number) =>
  round2(Math.min(avatarRanges[trait].max, Math.max(avatarRanges[trait].min, value)));
/**
 * The full range of looks from a seed: shape, palette, proportions and, with moderate odds so most avatars stay
 * simple, a mouth, markings and one accessory.
 */
export function richAppearanceFromSeed(seed: number): AvatarAppearance {
  const v = (salt: number) => variation(seed, salt);
  const color = pick(avatarColors, v(2)).value;
  const accent =
    v(20) < 0.5
      ? pick(
          avatarColors.filter(item => item.value !== color),
          v(21),
        ).value
      : undefined;
  return {
    shape: pick(avatarShapes, v(1)).id,
    color,
    seed,
    eyeStyle: v(3) < 0.5 ? 'pill' : 'round',
    stretch: round2((v(11) - 0.5) * 1.2),
    taper: round2((v(12) - 0.5) * 1),
    wobble: v(13) < 0.35 ? round2(v(14) * 0.8) : 0,
    eyeSize: round2(0.85 + v(15) * 0.35),
    eyeGap: round2((v(16) - 0.5) * 1.2),
    mouth: v(17) < 0.45 ? 'none' : pick(avatarMouths.slice(1), v(18)).value,
    marking: v(19) < 0.5 ? 'none' : pick(avatarMarkings.slice(1), v(22)).value,
    ...(accent ? { accent } : {}),
    accessory: v(23) < 0.7 ? 'none' : pick(avatarAccessories.slice(1), v(24)).value,
  };
}
/** What an unset trait draws as (saved avatars from before a trait existed leave it out). */
export const traitDefaults = {
  eyeStyle: 'pill',
  stretch: 0,
  taper: 0,
  wobble: 0,
  eyeSize: 1,
  eyeGap: 0,
  mouth: 'none',
  marking: 'none',
  accessory: 'none',
} as const;
/** Whether two avatars look the same (unset traits count as their defaults; colours ignore case). */
export function sameAvatar(a: AvatarAppearance, b: AvatarAppearance) {
  const normal = (avatar: AvatarAppearance) =>
    JSON.stringify({
      ...traitDefaults,
      ...Object.fromEntries(Object.entries(avatar).filter(([, value]) => value !== undefined)),
      color: avatar.color.toLowerCase(),
      accent: avatar.accent?.toLowerCase() ?? null,
    });
  return normal(a) === normal(b);
}
const mutations = ['shape', 'color', 'mouth', 'marking', 'accessory', 'eyes', 'proportions'] as const;
/**
 * A variation of an avatar: two different, clearly visible changes. The first kind cycles with the salt, so a grid
 * of consecutive salts shows every kind of change; each change picks a value other than the current one, and
 * proportions move by a third of their range or more (a small nudge is invisible at tile size), either way.
 */
export function mutateAvatar(avatar: AvatarAppearance, salt: number): AvatarAppearance {
  const v = (n: number) => variation(Math.imul(avatar.seed, 31) ^ Math.imul(salt, 0x9e3779b1), n);
  const next: AvatarAppearance = { ...avatar, seed: Math.floor(v(1) * 2147483647) };
  const same = <T>(a: T, b: T | undefined) =>
    typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b;
  const other = <T>(values: readonly T[], current: T | undefined, r: number) => {
    const choices = values.filter(value => !same(value, current));
    return choices[Math.floor(r * choices.length) % choices.length];
  };
  // A clear move from the current value (a third of the range or more), in whichever direction has room.
  const far = (trait: AvatarRange, r: number) => {
    const { min, max } = avatarRanges[trait];
    const span = max - min,
      current = next[trait] ?? traitDefaults[trait];
    const distance = span * (0.34 + 0.3 * ((r * 7) % 1));
    const up = current + distance <= max,
      down = current - distance >= min;
    const direction = up && down ? (r < 0.5 ? 1 : -1) : up ? 1 : -1;
    return clampTrait(trait, current + direction * distance);
  };

  const first = mutations[((salt % mutations.length) + mutations.length) % mutations.length];
  const rest = mutations.filter(kind => kind !== first);
  const second = rest[Math.floor(v(2) * rest.length) % rest.length];
  [first, second].forEach((kind, i) => {
    const r = v(20 + i);
    if (kind === 'shape')
      next.shape = other(
        avatarShapes.map(item => item.id),
        next.shape,
        r,
      );
    else if (kind === 'color')
      next.color = other(
        avatarColors.map(item => item.value),
        next.color,
        r,
      );
    else if (kind === 'mouth')
      next.mouth = other(
        avatarMouths.map(item => item.value),
        next.mouth ?? avatarMouths[0].value,
        r,
      );
    else if (kind === 'marking')
      next.marking = other(
        avatarMarkings.map(item => item.value),
        next.marking ?? avatarMarkings[0].value,
        r,
      );
    else if (kind === 'accessory')
      next.accessory = other(
        avatarAccessories.map(item => item.value),
        next.accessory ?? avatarAccessories[0].value,
        r,
      );
    else if (kind === 'eyes') {
      next.eyeStyle = next.eyeStyle === 'round' ? 'pill' : 'round';
      next.eyeSize = far('eyeSize', r);
      next.eyeGap = far('eyeGap', v(40 + i));
    } else {
      next.stretch = far('stretch', r);
      next.taper = far('taper', v(30 + i));
      next.wobble = far('wobble', v(50 + i));
    }
  });
  return next;
}
/** The accent colour to draw: the saved one, or a lighter tint of the body. */
export function accentColor(avatar: Pick<AvatarAppearance, 'color' | 'accent'>) {
  if (avatar.accent) return avatar.accent;
  const channel = (offset: number) => {
    const value = parseInt(avatar.color.slice(offset, offset + 2), 16);
    return Math.round(value + (255 - value) * 0.45)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}
export function defaultAvatar(id: string): AvatarAppearance {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return appearanceFromSeed(hash >>> 1);
}
export function randomizeAvatar(previous?: AvatarAppearance): AvatarAppearance {
  let next = richAppearanceFromSeed(crypto.getRandomValues(new Uint32Array(1))[0] >>> 1);
  if (previous && next.shape === previous.shape && next.color === previous.color) {
    next = {
      ...next,
      shape: avatarShapes[(avatarShapes.findIndex(item => item.id === previous.shape) + 1) % avatarShapes.length].id,
    };
  }
  return next;
}
/** Repeatable variation; does not read time or change on a React render. */
export function variation(seed: number, salt: number) {
  let value = Math.imul(seed ^ salt, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}
export function interpolateEyes(from: EyePose, to: EyePose, amount: number): EyePose {
  const t = Math.max(0, Math.min(1, amount));
  const eye = (index: 0 | 1) => from[index].map((value, coordinate) => value + (to[index][coordinate] - value) * t);
  return [eye(0), eye(1)];
}
export function eyePath(points: readonly number[]) {
  const [x, y, cx, cy, ex, ey] = points.map(value => Number(value.toFixed(2)));
  return `M${x} ${y} Q${cx} ${cy} ${ex} ${ey}`;
}
