import { describe, expect, it } from 'vitest';
import { containFit, desktopStreamFit } from './computer-fit';

describe('containFit', () => {
  it('letterboxes a 16:9 desktop inside a taller box instead of stretching it', () => {
    // The old viewer filled the height, squashing 1920x1080 into 1100x439.
    expect(containFit(1100, 439, 16 / 9)).toEqual({ width: 780, height: 439 });
  });

  it('fills the width when the box is taller than the aspect allows', () => {
    // 1440x839 is the real iframe box at a 1440x900 viewport: 16:9 fits exactly.
    expect(containFit(1440, 839, 16 / 9)).toEqual({ width: 1440, height: 810 });
  });

  it('is exact for a box that already matches the aspect', () => {
    expect(containFit(1920, 1080, 16 / 9)).toEqual({ width: 1920, height: 1080 });
  });

  it('never returns a zero or negative box for collapsed containers', () => {
    expect(containFit(0, 0, 16 / 9)).toEqual({ width: 1, height: 1 });
    expect(containFit(-5, 300, 16 / 9)).toEqual({ width: 1, height: 1 });
  });
});

describe('desktopStreamFit', () => {
  it('contains the desktop on desktop viewports so resizing needs no reload', () => {
    expect(desktopStreamFit(1100, 439, false)).toEqual({ width: 780, height: 439, rotated: false });
    expect(desktopStreamFit(900, 639, false)).toEqual({ width: 900, height: 506, rotated: false });
  });

  it('never pans on phones: landscape contains, upright turns the picture to use the long side', () => {
    expect(desktopStreamFit(740, 300, true)).toEqual({ width: 533, height: 300, rotated: false });
    expect(desktopStreamFit(320, 700, true)).toEqual({ width: 568, height: 320, rotated: true });
  });
});
