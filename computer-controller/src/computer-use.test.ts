import { describe, expect, it } from 'vitest';
import { captureGeometry, validateCombo } from './computer-use';
const screen = { width: 1920, height: 1080, x: 0, y: 0 };
describe('computer-use pure preflight', () => {
  it('counts codepoints and only between-action pauses', () => {
    const result = validateCombo({ actions: [{ type: 'mouse.left_click' }, { type: 'keyboard.type', text: 'hello world' } ] }, screen);
    expect(result.actionSeconds).toBeCloseTo(.845);
    expect(result.totalSeconds).toBeCloseTo(1.045);
    expect(validateCombo({ actions: [{ type: 'keyboard.type', text: '😀', cpm: 800 }] }, screen).totalSeconds).toBe(.075);
  });
  it('uses physical straight endpoint distance before trajectory sampling', () => {
    expect(validateCombo({ actions: [{ type: 'mouse.move_to', x: 999, y: 999 }] }, screen).actionSeconds).toBeCloseTo(Math.hypot(1919, 1079) / 8000);
  });
  it.each([
    { actions: [{ type: 'mouse.move_to', x: 1, y: 1, speed: 24001 }] },
    { actions: [{ type: 'keyboard.type', text: 'x', cpm: 3201 }] },
    { actions: [{ type: 'keyboard.type', text: 'x'.repeat(67) }] },
    { actions: [{ type: 'keyboard.down', key: 'a' }] },
    { actions: [{ type: 'keyboard.up', key: 'a' }] },
    { actions: [{ type: 'mouse.down', button: 'left' }, { type: 'mouse.down', button: 'left' }] },
    { actions: [{ type: 'mouse.up', button: 'middle' }] },
    { actions: [{ type: 'keyboard.type', text: '\ud800' }] },
    { actions: [{ type: 'mouse.scroll', direction: 'up', amount: 0 }] },
    { actions: Array.from({ length: 17 }, () => ({ type: 'mouse.left_click' })) },
    { actions: [{ type: 'mouse.left_click' }, { type: 'mouse.right_click' }], per_action_pause: 10 },
    { actions: [{ type: 'mouse.left_click', command: 'sh' }] },
  ])('rejects whole invalid combo %j', input => expect(() => validateCombo(input, screen)).toThrow());
  it('admits exact time boundaries but rejects any overrun and held-key typing', () => {
    const actions = [{ type: 'keyboard.type', text: 'x'.repeat(200), cpm: 2400 }, { type: 'keyboard.type', text: '' }];
    expect(validateCombo({ actions, per_action_pause: 5 }, screen)).toMatchObject({ actionSeconds: 5, totalSeconds: 10 });
    expect(() => validateCombo({ actions, per_action_pause: 5.000001 }, screen)).toThrow('<=5s / <=10s');
    expect(() => validateCombo({ actions: [{ type: 'keyboard.down', key: 'Shift_L' }, { type: 'keyboard.type', text: 'x' }, { type: 'keyboard.up', key: 'Shift_L' }] }, screen)).toThrow('Release keys');
  });
  it('accepts balanced chords and mouse drag', () => {
    expect(validateCombo({ actions: [{ type: 'keyboard.down', key: 'Control_L' }, { type: 'keyboard.down', key: 'a' }, { type: 'keyboard.up', key: 'a' }, { type: 'keyboard.up', key: 'Control_L' }] }, screen).totalSeconds).toBeCloseTo(.6);
  });
});
describe('captureGeometry', () => {
  it('scales the full boundary rather than cropping glance', () => {
    expect(captureGeometry({ kind: 'glance' }, 1920, 1080)).toEqual({ bounds: [0, 0, 999, 999], pixels: [0, 0, 1920, 1080], width: 634, height: 356 });
  });
  it.each([['low', 634, 356], ['medium', 960, 540], ['high', 1440, 810], ['full', 1920, 1080]])('supports %s detail without changing the full boundary', (quality, width, height) => {
    expect(captureGeometry({ kind: 'glance', quality }, 1920, 1080)).toEqual({ bounds: [0,0,999,999], pixels: [0,0,1920,1080], width, height });
  });
  it('shifts axes independently and returns rounded actual bounds', () => {
    const crop = captureGeometry({ kind: 'look_at', x: 0, y: 500, size: 100 }, 999, 999);
    expect(crop.bounds).toEqual([0, 400, 200, 600]);
    expect(crop.width).toBe(200);
    expect(captureGeometry({ kind: 'look_at', x: 999, y: 0, size: 499.5 }, 1920, 1080).bounds).toEqual([0, 0, 999, 999]);
  });
  it('keeps tiny crops nonempty and rejects malformed requests', () => {
    expect(captureGeometry({ kind: 'look_at', x: 999, y: 999, size: .0001 }, 1920, 1080).width).toBe(1);
    expect(captureGeometry({ kind: 'look_at', x: 0, y: 0, size: Number.MIN_VALUE }, 1, 1).pixels).toEqual([0, 0, 1, 1]);
    for (const input of [{ kind: 'look_at', x: -1, y: 0, size: 1 }, { kind: 'look_at', x: 0, y: 0, size: 0 }, { kind: 'glance', quality: 'native' }, { kind: 'glance', quality: ['full'] }]) expect(() => captureGeometry(input, 1920, 1080)).toThrow();
  });
});
