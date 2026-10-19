import { useCallback, useEffect, useRef, type RefObject } from 'react';

const NEAR = 80; // px from the bottom that counts as being at the latest message

/**
 * Keeps a chat at its latest message while the reader is there: whatever grows below it (a new message, an image or
 * file preview that loads, a ticket chip), or the chat area getting shorter (a to-do list above it, a taller
 * composer), keeps the latest message in view. Scrolling away from the bottom (the reader, or a jump to an older
 * message) stops following, except the app's own smooth follow while it is under way; coming back near the bottom,
 * or sending a message (`follow`), follows again. `key` names the conversation: a new one starts at the bottom.
 * It attaches to the viewport whenever that element appears or changes, whatever order the page renders in.
 */
export function useStickToBottom(viewport: RefObject<HTMLElement | null>, key: unknown) {
  const smoothUntil = useRef(0);
  const stuck = useRef(true);
  const attached = useRef<{ root: HTMLElement | null; key: unknown; detach?: () => void }>({ root: null, key });
  // No dependency list: the viewport may mount after the first render (or be replaced) without anything else
  // changing, so every commit checks whether it is still watching the right element.
  useEffect(() => {
    const root = viewport.current;
    const current = attached.current;
    if (root === current.root && key === current.key) return;
    current.detach?.();
    attached.current = { root, key };
    stuck.current = true;
    const content = root?.firstElementChild;
    if (!root || !content) return;
    const distance = () => root.scrollHeight - root.scrollTop - root.clientHeight;
    // All the way down: "near" only decides whether the reader is following, not where to stop.
    const toBottom = () => {
      if (stuck.current && distance() > 1) root.scrollTop = root.scrollHeight;
    };
    const onScroll = () => {
      if (distance() < NEAR) stuck.current = true;
      else if (performance.now() > smoothUntil.current) stuck.current = false;
    };
    let settle: ReturnType<typeof setTimeout> | undefined;
    let height = content.getBoundingClientRect().height;
    let view = root.clientHeight;
    let first = true;
    const observer = new ResizeObserver(() => {
      const next = content.getBoundingClientRect().height;
      const nextView = root.clientHeight;
      // A chat area that just appeared (a tab switched back, a window opened) starts at its latest message once it
      // has a size: the app's own scroll may have run while it was still laid out at zero height.
      if (first) {
        first = false;
        toBottom();
        height = next;
        view = nextView;
        return;
      }
      // Content growing below, or the chat getting shorter: the latest message would slip out of view. A shrinking
      // window (older messages dropped while reading) is neither.
      if ((next > height || nextView < view) && stuck.current) {
        const wait = smoothUntil.current - performance.now();
        clearTimeout(settle);
        // A smooth follow under way is left to finish, then checked: content may have grown past its target.
        if (wait > 0) settle = setTimeout(toBottom, wait);
        else toBottom();
      }
      height = next;
      view = nextView;
    });
    root.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(content);
    observer.observe(root);
    attached.current.detach = () => {
      clearTimeout(settle);
      observer.disconnect();
      root.removeEventListener('scroll', onScroll);
    };
  });
  useEffect(() => () => attached.current.detach?.(), []);
  /** The app scrolls smoothly to the bottom now (a new message, or one the reader sent): follow from here on. */
  const follow = useCallback((ms = 600) => {
    smoothUntil.current = performance.now() + ms;
    stuck.current = true;
  }, []);
  /** Whether the reader is at the latest messages (so a new one should come into view). */
  const following = useCallback(() => stuck.current, []);
  return { follow, following };
}
