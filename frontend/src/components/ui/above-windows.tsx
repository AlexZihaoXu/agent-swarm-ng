import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

/**
 * Covers the box of its positioned parent, but in a page-level layer above the floating windows (and below
 * dialogs), for controls that must stay reachable whatever is floating, like the viewer's edge handles.
 */
export function AboveWindows({ className, children }: { className?: string; children: ReactNode }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const element = anchor.current;
    if (!element) return;
    const update = () => {
      const box = element.getBoundingClientRect();
      setRect(current =>
        current &&
        current.left === box.left &&
        current.top === box.top &&
        current.width === box.width &&
        current.height === box.height
          ? current
          : { left: box.left, top: box.top, width: box.width, height: box.height },
      );
    };
    update();
    // Entrance animations move the parent without resizing it; follow them briefly.
    let frames = 0,
      frame = requestAnimationFrame(function follow() {
        update();
        if (++frames < 40) frame = requestAnimationFrame(follow);
      });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, []);
  return (
    <>
      <div ref={anchor} aria-hidden="true" className="pointer-events-none invisible absolute inset-0" />
      {/* Nothing while the parent is hidden (for example the desktop while the Terminal view shows). */}
      {rect &&
        rect.width > 0 &&
        createPortal(
          <div className={cn('pointer-events-none fixed z-[48]', className)} style={rect}>
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
