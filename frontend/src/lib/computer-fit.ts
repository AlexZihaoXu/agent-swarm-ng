// Viewer sizing for the fixed 1920x1080 guest desktop.
//
// The desktop resolution is operator-locked (Selkies runs with
// `--enable-resize=false`), so the only thing that may change when the browser
// window changes is how that picture is *displayed*. Containing it keeps the
// 16:9 proportions at any window size, exactly like `object-fit: contain`,
// without reloading the page or asking the guest to change resolution.
export function containFit(containerWidth: number, containerHeight: number, aspect: number) {
  const width = Math.max(1, Math.floor(containerWidth));
  const height = Math.max(1, Math.floor(containerHeight));
  const fittedWidth = Math.min(width, Math.floor(height * aspect));
  // Both floors can round a 16:9 box a pixel or two off; recompute the height
  // from the chosen width so the picture never distorts.
  return { width: Math.max(1, fittedWidth), height: Math.max(1, Math.round(fittedWidth / aspect)) };
}

const DESKTOP_ASPECT = 16 / 9;

/**
 * The iframe box in CSS pixels. The desktop is always contained, never cropped or panned. On an upright phone the
 * picture is turned a quarter turn (`rotated`) so it can use the screen's long side; `width`/`height` are then the
 * unrotated box, which the viewer turns to fit.
 */
export function desktopStreamFit(containerWidth: number, containerHeight: number, isPhone: boolean) {
  const rotated = isPhone && containerHeight > containerWidth;
  return {
    ...(rotated
      ? containFit(containerHeight, containerWidth, DESKTOP_ASPECT)
      : containFit(containerWidth, containerHeight, DESKTOP_ASPECT)),
    rotated,
  };
}
