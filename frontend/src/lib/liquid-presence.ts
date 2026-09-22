type Point = [number, number];
const count = 8;
const angle = (index: number) => index * Math.PI * 2 / count - Math.PI / 2;
const circle: Point[] = Array.from({ length: count }, (_, index) => [12 + 10 * Math.cos(angle(index)), 12 + 10 * Math.sin(angle(index))]);

function path(points: Point[]) {
  const format = (point: Point) => point.map(value => value.toFixed(3)).join(' ');
  let result = `M${format(points[0])}`;
  for (let index = 0; index < count; index++) {
    const previous = points[(index + count - 1) % count], current = points[index];
    const next = points[(index + 1) % count], after = points[(index + 2) % count];
    const first: Point = [current[0] + (next[0] - previous[0]) / 6, current[1] + (next[1] - previous[1]) / 6];
    const second: Point = [next[0] - (after[0] - current[0]) / 6, next[1] - (after[1] - current[1]) / 6];
    result += ` C${format(first)} ${format(second)} ${format(next)}`;
  }
  return `${result} Z`;
}

function random(seed: number, index: number) {
  let value = (seed ^ Math.imul(index, 0x45d9f3b)) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

// Smooth random samples with continuous velocity across segment boundaries.
function noise(seed: number, time: number) {
  const index = Math.floor(time), t = time - index;
  const [a, b, c, d] = [-1, 0, 1, 2].map(offset => random(seed, index + offset) * 2 - 1);
  return Math.max(-1, Math.min(1, 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t)));
}

export const restingContour = path(circle);
export function createLiquidContour(seed = Math.floor(Math.random() * 4294967296)) {
  return (milliseconds: number, amount = 1) => {
    if (amount <= 0) return restingContour;
    const time = milliseconds / 1000;
    const turn = noise(seed + 101, time * 0.4) * 0.24;
    const x = noise(seed + 102, time * 0.6) * 0.2, y = noise(seed + 103, time * 0.6) * 0.2;
    return path(circle.map((rest, index): Point => {
      const radius = 7.5 + noise(seed + index * 997, time * (0.8 + random(seed, index) * 0.6) + index * 10) * 1.7;
      const direction = angle(index) + turn;
      const mix = Math.min(1, amount);
      return [rest[0] + (12 + x + radius * Math.cos(direction) - rest[0]) * mix, rest[1] + (12 + y + radius * Math.sin(direction) - rest[1]) * mix];
    }));
  };
}
