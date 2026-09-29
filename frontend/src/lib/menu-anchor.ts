/** A context menu's usual width, with room for phone-sized items. */
const MENU_WIDTH = 288;
const EDGE = 8;

/**
 * Where to open a context menu at a point so that it fits on screen. The menu opens to the right of the point,
 * or flips to its left when the right has no room, but is never moved sideways: from a point near the middle of
 * a phone it would run off the left edge. Such a point moves right until the flipped menu fits.
 */
export function menuAnchorX(x: number, viewport = window.innerWidth, width = MENU_WIDTH) {
  if (viewport - x >= width + EDGE) return x;
  return Math.max(x, Math.min(viewport - EDGE, width + EDGE));
}
