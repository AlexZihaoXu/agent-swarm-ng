import type { components } from '../api/schema';
export type ActivityEntry = components['schemas']['AgentActivityEntry'];

/** Durable events are bounded replacements, not token deltas. Revisions win every race. */
export function mergeActivity(entries: ActivityEntry[], incoming: ActivityEntry[], append = false): ActivityEntry[] {
  const result = new Map(entries.map(entry => [entry.id, entry]));
  for (const entry of incoming) {
    const previous = result.get(entry.id);
    if (previous && entry.revision !== undefined && previous.revision !== undefined) {
      if (entry.revision < previous.revision) continue;
      if (entry.revision === previous.revision) {
        const length = new TextEncoder().encode(previous.text).length;
        if (entry.offset === length && entry.offset > 0)
          result.set(entry.id, { ...entry, offset: 0, text: previous.text + entry.text });
        continue; // duplicate event or stale preview must not discard an expanded fragment
      }
    }
    if ((entry.offset ?? 0) > 0) continue; // a changed revision must restart at the first fragment
    result.set(entry.id, {
      ...entry,
      text: append && entry.revision === undefined && previous ? previous.text + entry.text : entry.text,
    });
  }
  return [...result.values()].sort(
    (a, b) =>
      (a.sequence ?? Infinity) - (b.sequence ?? Infinity) || a.timestamp - b.timestamp || a.id.localeCompare(b.id),
  );
}

export function reconcileActivityPage(
  current: ActivityEntry[],
  page: ActivityEntry[],
  beforeRequest?: ActivityEntry[],
): ActivityEntry[] {
  if (!beforeRequest) return mergeActivity(current, page);
  const baseline = new Map(beforeRequest.map(entry => [entry.id, entry.revision]));
  // A reconnect starts a new bounded window, but retains all events received while it loaded.
  const live = current.filter(entry => !baseline.has(entry.id) || baseline.get(entry.id) !== entry.revision);
  // Keep already-expanded text for overlapping unchanged entries. Starting from the
  // new previews alone silently collapsed those entries on every reconnect.
  const revisions = new Map(page.map(entry => [entry.id, entry.revision]));
  const overlapping = current.filter(entry => revisions.has(entry.id) && revisions.get(entry.id) === entry.revision);
  return mergeActivity(mergeActivity(overlapping, page), live);
}
