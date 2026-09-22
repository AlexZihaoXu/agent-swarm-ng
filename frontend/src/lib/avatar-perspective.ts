import type { AvatarShape } from './agent-avatar';
export type Gaze = { x: number; y: number };
export const lookDirections = [
  { value: 'natural', label: 'Natural', gaze: undefined },
  { value: 'forward', label: 'Forward', gaze: { x: 0, y: 0 } },
  { value: 'up-left', label: 'Upper left', gaze: { x: -2.5, y: -1.3 } },
  { value: 'up-right', label: 'Upper right', gaze: { x: 2.5, y: -1.3 } },
  { value: 'left', label: 'Left', gaze: { x: -2.5, y: 0 } },
  { value: 'right', label: 'Right', gaze: { x: 2.5, y: 0 } },
  { value: 'down-left', label: 'Lower left', gaze: { x: -2.5, y: 1.3 } },
  { value: 'down-right', label: 'Lower right', gaze: { x: 2.5, y: 1.3 } },
] as const;
const clamp = (value: number) => Math.max(-1, Math.min(1, value));
const rounded = (value: number) => Number(value.toFixed(3));

/** Cartoon curved-surface projection, kept separate from the local eyelid closure transform. */
export function projectEye(eye: readonly number[], gaze: Gaze, shape: AvatarShape, narrowing?: number) {
  const nx = clamp(gaze.x / 2.5), ny = clamp(gaze.y / 1.3);
  const cx = (eye[0] + eye[4]) / 2, cy = (eye[1] + eye[5]) / 2;
  const narrow = narrowing ?? (shape === 'triangle' || shape === 'pear' ? 1 : 0);
  const angle = nx * ny * 28, radians = angle * Math.PI / 180;
  const horizontal = Math.cos(nx * 0.65), vertical = Math.cos(ny * 0.45);
  const dx = (cx - 31.5) * horizontal, dy = (cy - 28) * vertical;
  const x = 31.5 + nx * (5.5 - 2.5 * narrow) + dx * Math.cos(radians) - dy * Math.sin(radians);
  const y = 28 + ny * (3.5 - 1.5 * narrow) + dx * Math.sin(radians) + dy * Math.cos(radians);
  const depth = 1 - clamp((cx - 31.5) / 6.5) * nx * 0.12;
  const scaleX = horizontal * depth, scaleY = vertical * depth;
  return { x, y, angle, scaleX, scaleY,
    transform: `translate(${rounded(x)} ${rounded(y)}) rotate(${rounded(angle)}) scale(${rounded(scaleX)} ${rounded(scaleY)}) translate(${rounded(-cx)} ${rounded(-cy)})`,
  };
}
