import { useLayoutEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/** Swaps a single line of text: old text exits upward, then new text enters from below. */
export function SlideUpFadeSwap({ text, prefix = '', className }: { text: string; prefix?: string; className?: string }) {
  const initial = useRef({ text, prefix });
  const labelRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const label = labelRef.current;
    if (!label || (label.textContent === text && label.dataset.prefix === prefix)) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      label.textContent = text;
      label.dataset.prefix = prefix;
      return;
    }

    let cancelled = false;
    let animation = label.animate([
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(-8px)' },
    ], { duration: 62.5, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' });

    void animation.finished.then(() => {
      if (cancelled) return;
      label.textContent = text;
      label.dataset.prefix = prefix;
      animation.cancel();
      animation = label.animate([
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 140, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    }).catch(() => {
      // A newer value or unmount cancels the outgoing animation.
    });

    return () => {
      cancelled = true;
      animation.cancel();
    };
  }, [text, prefix]);

  return (
    <span className={cn('inline-block min-w-0 overflow-hidden align-top', className)}>
      <span className="sr-only">{prefix}{text}</span>
      {/* Only the visual text is animation-owned; accessible text updates immediately. */}
      <span ref={labelRef} aria-hidden="true" data-slot="swap-text" data-prefix={initial.current.prefix} className="block truncate before:font-medium before:content-[attr(data-prefix)]">{initial.current.text}</span>
    </span>
  );
}
