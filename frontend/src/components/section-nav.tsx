import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { m } from 'motion/react';
import { glide } from '@/lib/motion';
import { cn } from '@/lib/utils';

type Item = { id: string; label: string; element: HTMLElement };

function scrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

/**
 * Jump links for a long settings page, listed down a side panel outside the scrolling page, with the side panels'
 * row highlight. Every section stays on the page, so these are links with `aria-current`, not tabs. The lit row
 * follows the reader's scroll position and glides between sections.
 */
export function SectionNav({
  container,
  label = 'Jump to section',
  className,
}: {
  /** The element whose direct `section[aria-label]` children (each with an h3) are listed. */
  container: RefObject<HTMLElement | null>;
  label?: string;
  className?: string;
}) {
  const group = useId();
  const [items, setItems] = useState<Item[]>([]);
  const [active, setActive] = useState('');
  const list = useRef<HTMLUListElement>(null);
  // The clicked target and when the hold ends; the page may bottom out before the target is computed.
  const jumping = useRef<{ id: string; until: number } | null>(null);

  // Sections can appear later (model settings wait for their data), so rebuild the list when children change.
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    const read = () => {
      const next = [...root.querySelectorAll<HTMLElement>(':scope > section[aria-label]')].map(element => ({
        id: element.getAttribute('aria-label')!,
        label: element.querySelector('h3')?.textContent?.trim() || element.getAttribute('aria-label')!,
        element,
      }));
      setItems(current =>
        current.length === next.length && current.every((item, i) => item.element === next[i].element) ? current : next,
      );
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { childList: true });
    return () => observer.disconnect();
  }, [container]);

  // Scroll spy: the active section is the last one whose top has passed a line a third of the way down.
  useEffect(() => {
    const scroller = scrollParent(container.current);
    if (!scroller || !items.length) return;
    let frame = 0;
    let recheck: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      frame = 0;
      const top = scroller.getBoundingClientRect().top;
      const line = top + scroller.clientHeight / 3;
      const atEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 4;
      let current = items[0].id;
      for (const item of items) if (item.element.getBoundingClientRect().top <= line) current = item.id;
      if (atEnd) current = items.at(-1)!.id;
      // While a clicked jump is gliding, keep its target lit instead of flickering through the ones passed.
      if (jumping.current) {
        const left = jumping.current.until - performance.now();
        if (current !== jumping.current.id && left > 0) {
          // Look again once the hold ends, even if no further scroll event arrives.
          clearTimeout(recheck);
          recheck = setTimeout(schedule, left + 20);
          return;
        }
        jumping.current = null;
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener('scroll', schedule, { passive: true });
    // Sections that load or expand change what is in view without any scrolling.
    const resize = new ResizeObserver(schedule);
    if (container.current) resize.observe(container.current);
    return () => {
      scroller.removeEventListener('scroll', schedule);
      resize.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(recheck);
    };
  }, [container, items]);

  // The panel may be shorter than the list: keep the lit item in it, scrolling only the panel (scrollIntoView would
  // also move the page and cancel a gliding jump).
  useEffect(() => {
    const item = list.current?.querySelector<HTMLElement>('[aria-current="location"]');
    const panel = scrollParent(item ?? null);
    if (!item || !panel) return;
    const top = item.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop;
    if (top < panel.scrollTop) panel.scrollTo({ top: top - 8, behavior: 'smooth' });
    else if (top + item.offsetHeight > panel.scrollTop + panel.clientHeight)
      panel.scrollTo({ top: top + item.offsetHeight - panel.clientHeight + 8, behavior: 'smooth' });
  }, [active]);

  const jump = (item: Item) => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    jumping.current = reduced ? null : { id: item.id, until: performance.now() + 900 };
    setActive(item.id);
    const scroller = scrollParent(item.element);
    if (scroller) {
      const top =
        scroller.scrollTop + item.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16;
      scroller.scrollTo({ top, behavior: reduced ? 'instant' : 'smooth' });
    }
    // Like a skip link, move focus to the section so the next Tab continues from there.
    item.element.tabIndex = -1;
    item.element.style.outline = 'none';
    item.element.focus({ preventScroll: true });
  };

  if (items.length < 2) return null;
  return (
    <nav
      aria-label={label}
      className={cn('motion-safe:animate-[view-in_180ms_cubic-bezier(0.22,1,0.36,1)]', className)}
    >
      <ul ref={list} className="space-y-0.5">
        {items.map(item => {
          const on = item.id === active;
          return (
            <li key={item.id}>
              <a
                href={`#${encodeURIComponent(item.id)}`}
                aria-current={on ? 'location' : undefined}
                onClick={event => {
                  event.preventDefault();
                  jump(item);
                }}
                className={cn(
                  'relative isolate flex min-h-9 items-center rounded-lg px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  on
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                )}
              >
                {on && (
                  <m.span
                    aria-hidden="true"
                    layoutId={`${group}-section`}
                    transition={glide}
                    className="absolute inset-0 -z-10 rounded-lg bg-foreground/10"
                  />
                )}
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
