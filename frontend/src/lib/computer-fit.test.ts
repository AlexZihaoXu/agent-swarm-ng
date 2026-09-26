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
    expect(desktopStreamFit(1100, 439, false)).toEqual({ width: 780, height: 439 });
    expect(desktopStreamFit(900, 639, false)).toEqual({ width: 900, height: 506 });
  });

  it('keeps the existing phone behaviour: a full-height stream that pans', () => {
    // Phones deliberately render the desktop at 1:1 width and pan to the rest;
    // this change must not alter that, so the assertion records today's rule.
    expect(desktopStreamFit(320, 700, true)).toEqual({ width: 1244, height: 700 });
    expect(desktopStreamFit(1100, 439, true)).toEqual({ width: 1100, height: 439 });
  });
});
