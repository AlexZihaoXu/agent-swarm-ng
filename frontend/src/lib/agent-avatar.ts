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
] as const;
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
export type AvatarAppearance = { shape: AvatarShape; color: string; seed: number; eyeStyle?: 'pill' | 'round' };
export function appearanceFromSeed(seed: number): AvatarAppearance {
  return {
    shape: avatarShapes[Math.floor(variation(seed, 1) * avatarShapes.length)].id,
    color: avatarColors[Math.floor(variation(seed, 2) * avatarColors.length)].value,
    seed,
    eyeStyle: variation(seed, 3) < 0.5 ? 'pill' : 'round',
  };
}
export function defaultAvatar(id: string): AvatarAppearance {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return appearanceFromSeed(hash >>> 1);
}
export function randomizeAvatar(previous?: AvatarAppearance): AvatarAppearance {
  let next = appearanceFromSeed(crypto.getRandomValues(new Uint32Array(1))[0] >>> 1);
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
