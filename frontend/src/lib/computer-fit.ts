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
 * The iframe box in CSS pixels.
 *
 * Desktop viewports contain the desktop, so shrinking or widening the window
 * re-fits immediately instead of stretching the picture vertically. Phone
 * viewports keep the deliberate 1:1-width pan behaviour: the stream is as wide
 * as the desktop needs at the current height and the viewer pans to the rest.
 */
export function desktopStreamFit(containerWidth: number, containerHeight: number, isPhone: boolean) {
  const width = Math.max(1, Math.floor(containerWidth));
  const height = Math.max(1, Math.floor(containerHeight));
  if (isPhone) return { width: Math.max(width, Math.round(height * DESKTOP_ASPECT)), height };
  return containFit(width, height, DESKTOP_ASPECT);
}
