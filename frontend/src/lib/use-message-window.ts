import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

const EDGE = 400; // px from an edge that counts as "near"
const FOLLOW = 80; // px from the bottom that counts as following the latest

/**
 * Renders a bounded window of a long chat history. Scrolling near the top reveals older messages (fetching more
 * when none are held) and drops the newest beyond `max`; scrolling near the bottom does the reverse. Messages stay
 * in memory, only the rendered page is bounded. The first visible message keeps its place on screen across every
 * change unless the reader is following the latest messages at the bottom.
 *
 * Rendered items carry `data-window-id`, which is how the anchor (its bottom edge) is found again.
 */
export function useMessageWindow<T>({
  items,
  idOf,
  viewport,
  max = 150,
  step = 50,
  canLoadOlder,
  loadOlder,
  reset,
}: {
  items: T[];
  idOf: (item: T) => string;
  viewport: RefObject<HTMLDivElement | null>;
  max?: number;
  step?: number;
  /** More history exists on the server and no request is in flight. */
  canLoadOlder: boolean;
  loadOlder: () => void;
  /** A different conversation: start again at the latest messages. */
  reset: unknown;
}) {
  const [bounds, setBounds] = useState<{ first?: string; last?: string }>({});
  const following = useRef(true);
  const anchor = useRef<{ id: string; offset: number } | null>(null);
  const wantOlder = useRef(false);
  const jump = useRef(false);
  const rendered = useRef<{ first?: string; last?: string }>({});
  const atNewest = useRef(true);
  const heldFirst = useRef<string | undefined>(undefined);

  useEffect(() => {
    setBounds({});
    following.current = true;
    anchor.current = null;
  }, [reset]);

  const ids = items.map(idOf);
  const length = ids.length;
  let end = bounds.last !== undefined && !following.current ? ids.indexOf(bounds.last) + 1 : length;
  // A window that already reached the newest message keeps taking new arrivals (up to its size) while the
  // reader is elsewhere; their place is kept by the anchor, and nothing already shown is dropped.
  if (end <= 0 || (atNewest.current && end < length)) end = length;
  let start = bounds.first !== undefined ? ids.indexOf(bounds.first) : -1;
  if (start < 0 || start >= end) start = Math.max(0, end - max);
  // Older messages that were fetched because the reader asked for them join the window straight away.
  if (wantOlder.current && heldFirst.current !== undefined && ids[0] !== heldFirst.current) {
    const held = ids.indexOf(heldFirst.current);
    if (held > 0) start = Math.max(0, held - step);
  }
  if (end - start > max) end = start + max;
  const visible = items.slice(start, end);
  atNewest.current = end === length;

  const measure = useCallback(() => {
    const root = viewport.current;
    if (!root) return;
    following.current = root.scrollHeight - root.scrollTop - root.clientHeight < FOLLOW;
    const top = root.getBoundingClientRect().top;
    for (const element of root.querySelectorAll<HTMLElement>('[data-window-id]')) {
      const rect = element.getBoundingClientRect();
      if (rect.bottom > top) {
        // The bottom edge: a label at the top of an item (like a time that disappears once earlier messages
        // arrive) must not move what the reader is looking at.
        anchor.current = { id: element.dataset.windowId!, offset: rect.bottom - top };
        return;
      }
    }
  }, [viewport]);

  // Keep the reading position: after any change, put the anchored message back where it was.
  const firstId = ids[start],
    lastId = ids[end - 1];
  useLayoutEffect(() => {
    const root = viewport.current;
    if (wantOlder.current && ids[0] !== heldFirst.current) wantOlder.current = false;
    setBounds(current =>
      current.first === firstId && current.last === lastId ? current : { first: firstId, last: lastId },
    );
    if (root && jump.current) {
      jump.current = false;
      root.scrollTop = root.scrollHeight;
      return;
    }
    const before = rendered.current;
    rendered.current = { first: firstId, last: lastId };
    // Following the latest and something arrived above (older history): stay at the bottom. New messages at the
    // bottom are left to the conversation's own smooth follow.
    if (root && following.current) {
      if (before.last === lastId && before.first !== firstId) root.scrollTop = root.scrollHeight;
      return;
    }
    if (!root || !anchor.current) return;
    const element = root.querySelector<HTMLElement>(`[data-window-id="${CSS.escape(anchor.current.id)}"]`);
    if (!element) return;
    root.scrollTop += element.getBoundingClientRect().bottom - root.getBoundingClientRect().top - anchor.current.offset;
  }, [firstId, lastId, length]);

  // A short history that cannot scroll never produces a scroll event: fetch older pages until it can.
  const filledAt = useRef(-1);
  useEffect(() => {
    const root = viewport.current;
    if (!root || !canLoadOlder || wantOlder.current || filledAt.current === length) return;
    if (root.scrollHeight <= root.clientHeight + 8) {
      filledAt.current = length;
      wantOlder.current = true;
      heldFirst.current = ids[0];
      loadOlder();
    }
  }, [canLoadOlder, length]);

  // A request that brought nothing (failure or no change) may be retried.
  useEffect(() => {
    if (canLoadOlder && wantOlder.current && ids[0] === heldFirst.current) wantOlder.current = false;
  }, [canLoadOlder]);

  const onScroll = () => {
    const root = viewport.current;
    if (!root) return;
    measure();
    if (root.scrollTop < EDGE) {
      if (start > 0) {
        const next = Math.max(0, start - step);
        setBounds({ first: ids[next], last: ids[Math.min(end, next + max) - 1] });
      } else if (canLoadOlder && !wantOlder.current) {
        wantOlder.current = true;
        heldFirst.current = ids[0];
        loadOlder();
      }
    } else if (root.scrollHeight - root.scrollTop - root.clientHeight < EDGE && end < length) {
      const next = Math.min(length, end + step);
      setBounds({ first: ids[Math.max(start, next - max)], last: ids[next - 1] });
    }
  };

  /** Back to the newest messages (Jump to latest). */
  const toLatest = useCallback(() => {
    jump.current = true;
    following.current = true;
    anchor.current = null;
    setBounds({});
  }, []);

  return {
    visible,
    olderHidden: start > 0,
    newerHidden: end < length,
    onScroll,
    toLatest,
    windowId: idOf,
  };
}
