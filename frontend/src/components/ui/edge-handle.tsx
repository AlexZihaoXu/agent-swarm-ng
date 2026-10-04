import { useEffect, useRef, useState, type ComponentProps, type ReactNode, type Ref } from 'react';
import { cn } from '@/lib/utils';

type Level = 'far' | 'near' | 'close' | 'touch';

/** How close the mouse is to an element: `near` shows its glyph, `close` its button. Touch screens report `touch`. */
function usePointerProximity(target: { current: HTMLElement | null }, near = 180, close = 90): Level {
  const [level, setLevel] = useState<Level>(() => (window.matchMedia('(hover: hover)').matches ? 'far' : 'touch'));
  useEffect(() => {
    if (level === 'touch') return;
    let frame = 0,
      x = -1e4,
      y = -1e4;
    const update = () => {
      frame = 0;
      const box = target.current?.getBoundingClientRect();
      if (!box) return;
      const distance = Math.hypot(Math.max(box.left - x, 0, x - box.right), Math.max(box.top - y, 0, y - box.bottom));
      const next = distance <= close ? 'close' : distance <= near ? 'near' : 'far';
      setLevel(current => (current === next ? current : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const move = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;
      schedule();
    };
    // Leaving the page, or entering the live desktop's frame (which keeps its pointer events): treat as far away.
    const out = (event: PointerEvent) => {
      const into = event.relatedTarget;
      if (into && !(into instanceof HTMLIFrameElement)) return;
      x = y = -1e4;
      schedule();
    };
    window.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerout', out);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      document.removeEventListener('pointerout', out);
    };
  }, [level === 'touch', near, close]);
  return level;
}

/**
 * A handle on the viewer's edge (All computers below, Terminals on the right). With a mouse it stays out of the way:
 * invisible until the pointer comes near, then just its glyph, then a round button, and it unfolds its label on
 * hover or keyboard focus. Touch screens always show the labelled pill. Props and ref pass to the button, so it can
 * sit under a Radix `asChild` trigger.
 */
export function EdgeHandle({
  icon,
  label,
  ref,
  className,
  ...props
}: ComponentProps<'button'> & { icon: ReactNode; label: string }) {
  const own = useRef<HTMLButtonElement | null>(null);
  const level = usePointerProximity(own);
  const setRef = (element: HTMLButtonElement | null) => {
    own.current = element;
    if (typeof ref === 'function') ref(element);
    else if (ref) (ref as { current: HTMLButtonElement | null }).current = element;
  };
  return (
    <button
      type="button"
      aria-label={label}
      data-near={level}
      {...props}
      ref={setRef as Ref<HTMLButtonElement>}
      className={cn(
        'group pointer-events-auto flex h-7 min-w-7 items-center justify-center rounded-full border text-xs font-medium outline-none transition-[opacity,background-color,border-color,color,padding,box-shadow] duration-200 hover:px-3 focus-visible:px-3 focus-visible:ring-2 focus-visible:ring-ring',
        level === 'far' && 'border-transparent bg-transparent text-white/70 opacity-0 focus-visible:opacity-100',
        level === 'near' && 'border-transparent bg-transparent text-white/80 drop-shadow-[0_1px_2px_rgb(0_0_0/0.8)]',
        (level === 'close' || level === 'touch') &&
          'border-white/15 bg-black/55 text-white/80 ao-top shadow-lg backdrop-blur hover:bg-black/80 hover:text-white',
        level === 'touch' && 'px-3',
        className,
      )}
    >
      {icon}
      {/* The label unfolds on hover or focus; touch screens show it all the time. */}
      <span
        className={cn(
          'overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin] duration-200',
          level === 'touch'
            ? 'ml-1 max-w-40'
            : 'max-w-0 opacity-0 group-hover:ml-1 group-hover:max-w-40 group-hover:opacity-100 group-focus-visible:ml-1 group-focus-visible:max-w-40 group-focus-visible:opacity-100',
        )}
      >
        {label}
      </span>
    </button>
  );
}
