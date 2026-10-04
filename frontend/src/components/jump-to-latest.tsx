import { useEffect, useRef, useState, type RefObject } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { surface } from '@/lib/motion';

/**
 * A pill that appears when the reader has scrolled away from the newest messages, and brings them back.
 * It says "New messages" only when something newer arrived while they were away; older history loading in
 * above them never counts.
 */
export function JumpToLatest({
  viewport,
  newest,
  onJump,
}: {
  viewport: RefObject<HTMLDivElement | null>;
  /** The newest message's ID: it changes only when a message arrives after it. */
  newest: string | undefined;
  /** Runs first, e.g. to bring a windowed history back to its newest messages. */
  onJump?: () => void;
}) {
  const [away, setAway] = useState(false);
  const latest = useRef(newest);
  const seen = useRef(newest);
  latest.current = newest;
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const update = () => {
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
      const isAway = distance > 320;
      if (!isAway) seen.current = latest.current;
      setAway(isAway);
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    return () => element.removeEventListener('scroll', update);
  });
  if (!away) seen.current = newest;
  const fresh = away && newest !== seen.current;
  return (
    <AnimatePresence>
      {away && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
          <m.button
            type="button"
            initial={{ opacity: 0, y: 10, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.92 }}
            transition={surface}
            onClick={() => {
              onJump?.();
              const element = viewport.current;
              if (!element) return;
              const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
              const bottom = element.scrollHeight - element.clientHeight;
              // A long way back would take seconds to glide; cut to one screen away, then glide the last stretch.
              if (!reduced && bottom - element.scrollTop > element.clientHeight * 1.5)
                element.scrollTop = bottom - element.clientHeight;
              element.scrollTo({ top: element.scrollHeight, behavior: reduced ? 'instant' : 'smooth' });
            }}
            className="pointer-events-auto flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-background/90 px-3.5 text-xs font-medium text-foreground ao-top shadow-lg shadow-black/30 backdrop-blur outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            {fresh && <span aria-hidden="true" className="size-1.5 rounded-full bg-teal-400" />}
            {fresh ? 'New messages' : 'Jump to latest'}
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </m.button>
        </div>
      )}
    </AnimatePresence>
  );
}
