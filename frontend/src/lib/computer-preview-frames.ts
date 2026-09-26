// Two-layer linear crossfade for the card preview thumbnails.
//
// When a new frame is ready, a single progress value `t` runs 0 -> 1: the old
// layer's opacity is `1 - t` and the new layer's is `t`, so the two always sum
// to exactly 1 (no additive glow, no dip to black). At most two layers exist.
// A frame that arrives mid-fade retires the then-topmost layer and restarts the
// blend from it, which is why the fade is kept shorter than the poll interval.
export type PreviewLayer = { id: number; opacity: number };

export function crossfade(t: number) {
  const progress = t < 0 ? 0 : t > 1 ? 1 : t;
  return { previous: 1 - progress, current: progress };
}

/** Progress the in-flight fade, or start a new one for an incoming frame. */
export function advanceFrames(layers: PreviewLayer[], id: number, t: number): PreviewLayer[] {
  const { previous, current } = crossfade(t);
  if (layers.some(layer => layer.id === id)) {
    return layers.map(layer => ({ ...layer, opacity: layer.id === id ? current : previous }));
  }
  // Keep the most visible existing layer as the outgoing one; drop the rest so
  // a slow decode can never pile up layers.
  const top = layers.reduce<PreviewLayer | null>((best, layer) =>
    !best || layer.opacity > best.opacity ? layer : best, null);
  const outgoing = top ? [{ ...top, opacity: previous }] : [];
  return [...outgoing, { id, opacity: current }];
}

/** Reduced motion snaps: the new frame is fully opaque at once. */
export function settleFrames(id: number): PreviewLayer[] {
  return [{ id, opacity: 1 }];
}
