// Two-layer dissolve for the card preview thumbnails.
//
// The previous frame stays a fully opaque floor and the newest frame slides its
// own opacity from 0 to 1 on top of it. When that ramp completes the top frame
// becomes the new floor and the next frame starts again at 0.
//
// This is deliberately NOT a sum-to-one crossfade: fading the old layer out at
// the same time as the new one fades in dips the composite brightness halfway
// through every blend, which at 2 fps reads as a breathing light. Keeping the
// floor at opacity 1 means the brightest moment never drops.
export type PreviewLayer = { id: number; opacity: number };

/** Floor stays fully opaque; the incoming layer ramps 0 -> 1 over it. */
export function crossfade(t: number) {
  const progress = t < 0 ? 0 : t > 1 ? 1 : t;
  return { previous: 1, current: progress };
}

/** Progress the in-flight fade, or start a new one for an incoming frame. */
export function advanceFrames(layers: PreviewLayer[], id: number, t: number): PreviewLayer[] {
  const { previous, current } = crossfade(t);
  if (layers.some(layer => layer.id === id)) {
    // A lone frame has no floor beneath it, so it must stay fully opaque while
    // its own ramp ticks; returning `current` here faded the first thumbnail in
    // from black, which is the very dip this design exists to avoid.
    if (layers.length === 1) return [{ ...layers[0], opacity: 1 }];
    return layers.map(layer => ({ ...layer, opacity: layer.id === id ? current : previous }));
  }
  // Layers paint in array order, so the last one is the visible top. A frame
  // arriving mid-ramp promotes that newest frame to the opaque floor rather
  // than the older one beneath it; the fade is shorter than the poll interval,
  // so this is the uncommon case.
  const top = layers.at(-1) ?? null;
  // With nothing beneath it, the frame IS the floor: dissolving from black
  // would dim the very first paint of a card.
  if (!top) return [{ id, opacity: 1 }];
  return [
    { ...top, opacity: previous },
    { id, opacity: current },
  ];
}

/** Reduced motion snaps: a single opaque frame, nothing to dissolve. */
export function settleFrames(id: number): PreviewLayer[] {
  return [{ id, opacity: 1 }];
}
