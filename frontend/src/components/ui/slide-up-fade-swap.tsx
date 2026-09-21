import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Swaps a single line: old content exits upward, then new content enters from below. */
export function SlideUpFadeSwap({ text, prefix = '', className, renderText }: {
  text: string; prefix?: string; className?: string; renderText?: (text: string) => ReactNode;
}) {
  const [displayed, setDisplayed] = useState({ text, prefix });
  const current = useRef(displayed);
  const labelRef = useRef<HTMLSpanElement>(null);
  const animation = useRef<Animation | undefined>(undefined);
  const enter = useRef(false);

  useLayoutEffect(() => {
    const label = labelRef.current;
    enter.current = false;
    if (!label || (current.current.text === text && current.current.prefix === prefix)) return;
    let cancelled = false;
    const update = () => {
      current.current = { text, prefix };
      setDisplayed(current.current);
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      enter.current = false;
      update();
      return;
    }
    animation.current = label.animate([
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(-8px)' },
    ], { duration: 62.5, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' });
    void animation.current.finished.then(() => {
      if (cancelled) return;
      enter.current = true;
      update();
    }).catch(() => { /* Superseded update or unmount. */ });
    return () => { cancelled = true; animation.current?.cancel(); };
  }, [text, prefix]);

  useLayoutEffect(() => {
    if (!enter.current || !labelRef.current) return;
    enter.current = false;
    animation.current?.cancel();
    animation.current = labelRef.current.animate([
      { opacity: 0, transform: 'translateY(8px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 140, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }, [displayed]);

  return (
    <span className={cn('inline-block min-w-0 overflow-hidden align-top', className)}>
      <span className="sr-only">{prefix}{renderText ? renderText(text) : text}</span>
      {/* Accessible content updates immediately; React retains ownership of rendered markup. */}
      <span ref={labelRef} aria-hidden="true" data-slot="swap-text" data-prefix={displayed.prefix} className="block truncate before:font-medium before:content-[attr(data-prefix)]">
        {renderText ? renderText(displayed.text) : displayed.text}
      </span>
    </span>
  );
}
