import { useCallback, useEffect, useRef, type RefObject } from 'react';

const NEAR = 80; // px from the bottom that counts as being at the latest message

/**
 * Keeps a chat at its latest message while the reader is there: whatever grows below it (a new message, an image or
 * file preview that loads, a ticket chip) scrolls into view. Scrolling away from the bottom (the reader, or a jump to
 * an older message) stops following, except the app's own smooth follow while it is under way; coming back near the
 * bottom, or sending a message (`follow`), follows again. `key` names the conversation: a new one starts at the bottom.
 */
export function useStickToBottom(viewport: RefObject<HTMLElement | null>, key: unknown) {
  const smoothUntil = useRef(0);
  const stuck = useRef(true);
  useEffect(() => {
    const root = viewport.current;
    const content = root?.firstElementChild;
    if (!root || !content) return;
    stuck.current = true;
    const near = () => root.scrollHeight - root.scrollTop - root.clientHeight < NEAR;
    const toBottom = () => {
      if (stuck.current && !near()) root.scrollTop = root.scrollHeight;
    };
    const onScroll = () => {
      if (near()) stuck.current = true;
      else if (performance.now() > smoothUntil.current) stuck.current = false;
    };
    let settle: ReturnType<typeof setTimeout> | undefined;
    let height = content.getBoundingClientRect().height;
    const observer = new ResizeObserver(() => {
      const next = content.getBoundingClientRect().height;
      // Only growth: a shrinking window (older messages dropped while reading) is not new content below.
      if (next > height && stuck.current) {
        const wait = smoothUntil.current - performance.now();
        clearTimeout(settle);
        // A smooth follow under way is left to finish, then checked: content may have grown past its target.
        if (wait > 0) settle = setTimeout(toBottom, wait);
        else root.scrollTop = root.scrollHeight;
      }
      height = next;
    });
    root.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(content);
    return () => {
      clearTimeout(settle);
      observer.disconnect();
      root.removeEventListener('scroll', onScroll);
    };
  }, [viewport, key]);
  /** The app scrolls smoothly to the bottom now (a new message, or one the reader sent): follow from here on. */
  return useCallback((ms = 600) => {
    smoothUntil.current = performance.now() + ms;
    stuck.current = true;
  }, []);
}
