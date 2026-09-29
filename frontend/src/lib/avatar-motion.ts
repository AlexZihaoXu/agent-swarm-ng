import { variation, type AvatarState } from './agent-avatar';
export type Point = { x: number; y: number };
export const contourSpeed: Record<AvatarState, number> = { idle: 1, working: 8, typing: 12 };
const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
const rounded = (n: number) => Number(n.toFixed(3));

/** Bounded, low-frequency contour drift preserves the selected silhouette. */
export function contourPoints(points: Point[], seed: number, seconds: number, activity = 0) {
  const phase = (salt: number) => variation(seed, salt) * Math.PI * 2;
  const squash = Math.sin(seconds * 0.65 + phase(5)) * 0.018;
  return points.map((point, i) => {
    const angle = (i / points.length) * Math.PI * 2;
    const drift =
      (Math.sin(angle * 2 + seconds * 0.7 + phase(6)) * 0.65 +
        Math.sin(angle * 3 - seconds * 0.43 + phase(7)) * 0.4 +
        Math.sin(angle + seconds * 0.31 + phase(8)) * 0.3) *
      (0.8 + activity * 0.35);
    const dx = point.x - 32,
      dy = point.y - 32,
      radius = Math.hypot(dx, dy) || 1;
    return { x: 32 + dx * (1 + squash) + (dx / radius) * drift, y: 32 + dy * (1 - squash) + (dy / radius) * drift };
  });
}
export function blendContour(from: Point[], to: Point[], amount: number) {
  const t = Math.max(0, Math.min(1, amount));
  return to.map((point, i) => ({ x: from[i].x + (point.x - from[i].x) * t, y: from[i].y + (point.y - from[i].y) * t }));
}
export function contourPath(points: Point[], seed: number, seconds: number, activity = 0) {
  return curvePath(contourPoints(points, seed, seconds, activity));
}
export function curvePath(vertices: Point[]) {
  const p = (i: number) => vertices[(i + vertices.length) % vertices.length];
  let path = `M${rounded(p(0).x)} ${rounded(p(0).y)}`;
  for (let i = 0; i < vertices.length; i++) {
    const a = p(i - 1),
      b = p(i),
      c = p(i + 1),
      d = p(i + 2);
    path += ` C${rounded(b.x + (c.x - a.x) / 6)} ${rounded(b.y + (c.y - a.y) / 6)} ${rounded(c.x - (d.x - b.x) / 6)} ${rounded(c.y - (d.y - b.y) / 6)} ${rounded(c.x)} ${rounded(c.y)}`;
  }
  return `${path} Z`;
}
/** Compress the eye along its local vertical axis; never rotate or shear its outline. */
export function eyelidTransform(eye: readonly number[], blink: number) {
  const x = (eye[0] + eye[4]) / 2,
    y = (eye[1] + eye[5]) / 2;
  const openness = rounded(1 - Math.max(0, Math.min(1, blink)) * 0.94);
  return `translate(${rounded(x)} ${rounded(y)}) scale(1 ${openness}) translate(${rounded(-x)} ${rounded(-y)})`;
}
export function faceMotion(seed: number, seconds: number, state: AvatarState) {
  const time = seconds + variation(seed, 10) * 8;
  const blinkCycle = Math.floor(time / 8),
    blinkPhase = time % 8;
  const blinkAt = 2 + variation(seed, 100 + blinkCycle * 3) * 3.5;
  const pulse = (start: number) => {
    const t = blinkPhase - start;
    return t < 0 || t > 0.28 ? 0 : t < 0.09 ? smooth(t / 0.09) : 1 - smooth((t - 0.12) / 0.16);
  };
  const blink = Math.max(pulse(blinkAt), variation(seed, 101 + blinkCycle * 3) < 0.22 ? pulse(blinkAt + 0.4) : 0);
  const interval = state === 'idle' ? 9 : 7;
  const cycle = Math.floor(time / interval),
    local = time % interval;
  const start = 1.5 + variation(seed, 500 + cycle * 4) * 2;
  const hold = 1.2 + variation(seed, 501 + cycle * 4) * 1.8;
  const envelope = smooth((local - start) / 0.6) * (1 - smooth((local - start - 0.6 - hold) / 0.7));
  return {
    blink,
    x: (variation(seed, 502 + cycle * 4) - 0.5) * 5 * envelope,
    y: (variation(seed, 503 + cycle * 4) - 0.5) * 2.6 * envelope,
  };
}

/**
 * The outline with the avatar's proportions applied: stretch (wide ↔ tall), taper (narrower top or bottom) and a
 * seeded wobble for lumpier silhouettes. The result is rescaled to fit the 64-unit box with a small margin.
 */
export function shapeOutline(
  points: Point[],
  { stretch = 0, taper = 0, wobble = 0 }: { stretch?: number; taper?: number; wobble?: number },
  seed: number,
) {
  if (!stretch && !taper && !wobble) return points;
  const phase = (salt: number) => variation(seed, salt) * Math.PI * 2;
  const shaped = points.map((point, i) => {
    const angle = (i / points.length) * Math.PI * 2;
    let dx = (point.x - 32) * (1 - 0.2 * stretch),
      dy = (point.y - 32) * (1 + 0.2 * stretch);
    // Positive taper narrows the top and widens the bottom; negative does the opposite.
    dx *= 1 + taper * 0.28 * (dy / 28);
    const radius = Math.hypot(dx, dy) || 1;
    const lump =
      wobble *
      (Math.sin(angle * 3 + phase(31)) * 2 + Math.sin(angle * 5 + phase(32)) * 1.2 + Math.sin(angle * 2 + phase(33)));
    return { x: 32 + dx + (dx / radius) * lump, y: 32 + dy + (dy / radius) * lump };
  });
  const extent = Math.max(...shaped.map(point => Math.max(Math.abs(point.x - 32), Math.abs(point.y - 32))));
  const fit = extent > 28.5 ? 28.5 / extent : 1;
  return shaped.map(point => ({ x: 32 + (point.x - 32) * fit, y: 32 + (point.y - 32) * fit }));
}

/**
 * Where a top accessory sits: a softly weighted centre of the highest part of the outline, on the outline itself.
 * The single highest point would flip between the shoulders of a flat-topped shape as it wobbles.
 */
export function crown(points: readonly { x: number; y: number }[]) {
  const highest = Math.min(...points.map(point => point.y));
  let weight = 0,
    sum = 0;
  for (const point of points) {
    const w = Math.exp(-(point.y - highest) / 1.5);
    weight += w;
    sum += w * point.x;
  }
  const x = sum / weight;
  // The outline's top edge at that x (the highest crossing of the vertical line through it).
  let y = Infinity;
  points.forEach((a, index) => {
    const b = points[(index + 1) % points.length];
    if ((a.x - x) * (b.x - x) > 0 || a.x === b.x) return;
    y = Math.min(y, a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y));
  });
  return { x, y: Number.isFinite(y) ? y : highest };
}
