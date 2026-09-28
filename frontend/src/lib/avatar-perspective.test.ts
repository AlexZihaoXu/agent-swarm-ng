import { expect, it } from 'vitest';
import { eyePoses, avatarShapes } from './agent-avatar';
import { projectEye, lookDirections } from './avatar-perspective';
import { eyelidTransform } from './avatar-motion';
it('leaves a forward-facing eye unchanged', () => {
  expect(projectEye(eyePoses.idle[0], { x: 0, y: 0 }, 'pebble')).toMatchObject({
    x: 25,
    y: 28.5,
    angle: 0,
    scaleX: 1,
    scaleY: 1,
  });
});
it('foreshortens the pair and makes the far eye smaller on a turn', () => {
  const left = projectEye(eyePoses.idle[0], { x: 2.5, y: 0 }, 'pebble');
  const right = projectEye(eyePoses.idle[1], { x: 2.5, y: 0 }, 'pebble');
  expect(right.x - left.x).toBeLessThan(13);
  expect(right.scaleX).toBeLessThan(left.scaleX);
  expect(right.scaleY).toBeLessThan(left.scaleY);
  expect(left.x).toBeGreaterThan(25);
});
it('tilts diagonal looks in opposite directions, independently of blinking', () => {
  expect(projectEye(eyePoses.idle[0], { x: -2.5, y: -1.3 }, 'pebble').angle).toBe(28);
  expect(projectEye(eyePoses.idle[0], { x: 2.5, y: -1.3 }, 'pebble').angle).toBe(-28);
  expect(eyelidTransform(eyePoses.idle[0], 1)).toContain('scale(1 0.06)');
  expect(eyelidTransform(eyePoses.idle[0], 1)).not.toMatch(/rotate|skew/);
});
it('bounds all preview directions, with smaller excursions for narrow silhouettes', () => {
  for (const shape of avatarShapes)
    for (const direction of lookDirections)
      for (const eye of eyePoses.idle) {
        const result = projectEye(eye, direction.gaze ?? { x: 0, y: 0 }, shape.id);
        expect(result.x).toBeGreaterThan(12);
        expect(result.x).toBeLessThan(50);
        expect(result.y).toBeGreaterThan(18);
        expect(result.y).toBeLessThan(40);
        expect(result.scaleX).toBeGreaterThan(0.65);
        expect(result.scaleY).toBeLessThanOrEqual(1.12);
      }
  expect(projectEye(eyePoses.idle[0], { x: 2.5, y: 0 }, 'triangle').x).toBeLessThan(
    projectEye(eyePoses.idle[0], { x: 2.5, y: 0 }, 'pebble').x,
  );
});
