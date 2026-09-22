import { useEffect, useRef } from 'react';
import { createLiquidContour, restingContour } from '@/lib/liquid-presence';

export function LiquidPresence({ working }: { working: boolean }) {
  const shape = useRef<SVGPathElement>(null);
  const contour = useRef<ReturnType<typeof createLiquidContour> | null>(null);
  const amount = useRef(0);
  const time = useRef(0);

  useEffect(() => {
    const element = shape.current!;
    const svg = element.ownerSVGElement!;
    const generate = contour.current ??= createLiquidContour();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    function start() {
      cancelAnimationFrame(frame);
      svg.dataset.animated = 'false';
      if (reduced.matches || (!working && amount.current === 0)) {
        amount.current = working ? 1 : 0;
        element.setAttribute('d', generate(0, amount.current));
        return;
      }
      if (document.hidden) return;
      svg.dataset.animated = 'true';
      const from = amount.current, target = working ? 1 : 0;
      const started = performance.now();
      let previous = started;
      function animate(now: number) {
        time.current += Math.min(64, now - previous);
        previous = now;
        const progress = Math.min(1, (now - started) / 260);
        const eased = progress * progress * (3 - 2 * progress);
        amount.current = from + (target - from) * eased;
        element.setAttribute('d', generate(time.current, amount.current));
        if (working || progress < 1) frame = requestAnimationFrame(animate);
        else svg.dataset.animated = 'false';
      }
      frame = requestAnimationFrame(animate);
    }
    start();
    reduced.addEventListener('change', start);
    document.addEventListener('visibilitychange', start);
    return () => {
      cancelAnimationFrame(frame);
      reduced.removeEventListener('change', start);
      document.removeEventListener('visibilitychange', start);
    };
  }, [working]);

  return <svg viewBox="2 2 20 20" className="presence-droplet size-full" data-working={working} fill="currentColor">
    <path ref={shape} className="presence-shape" d={restingContour} />
  </svg>;
}
