import { useEffect, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '@/lib/utils';

type Bounds = { min: number; max: number; initial: number };
/** The Chat and Agents lists share one width; the activity panel has its own. */
export const SIDEBAR_WIDTH: Bounds = { min: 224, max: 480, initial: 288 };
export const ACTIVITY_WIDTH: Bounds = { min: 320, max: 760, initial: 384 };

/** A side panel's width, remembered in this browser (a convenience: none stored still works). */
export function usePanelWidth(
  key: string,
  bounds: Bounds,
  /** Also publish the width as this CSS variable on the page (for what makes room for the panel). */
  pageVariable?: string,
) {
  const clamp = (value: number) => Math.round(Math.min(bounds.max, Math.max(bounds.min, value)));
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(`panel-width:${key}`));
      return saved ? clamp(saved) : bounds.initial;
    } catch {
      return bounds.initial;
    }
  });
  const set = (value: number) => {
    const next = clamp(value);
    setWidth(next);
    try {
      localStorage.setItem(`panel-width:${key}`, String(next));
    } catch {}
  };
  useEffect(() => {
    if (pageVariable) document.documentElement.style.setProperty(pageVariable, `${width}px`);
  }, [pageVariable, width]);
  return { width, set, bounds, style: { '--panel-width': `${width}px` } as CSSProperties };
}

/**
 * The draggable edge of a side panel (wide screens only): drag it, use ←/→ when it has focus, or double-click it to
 * go back to the default width. `side` is the panel's edge it sits on.
 */
export function PanelResizeHandle({
  panel,
  side,
  label,
}: {
  panel: ReturnType<typeof usePanelWidth>;
  side: 'left' | 'right';
  label: string;
}) {
  const [dragging, setDragging] = useState(false);
  const direction = side === 'right' ? 1 : -1;
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const from = event.clientX,
      initial = panel.width,
      pointer = event.pointerId;
    setDragging(true);
    const move = (moved: globalThis.PointerEvent) => {
      if (moved.pointerId === pointer) panel.set(initial + (moved.clientX - from) * direction);
    };
    const end = (ended: globalThis.PointerEvent) => {
      if (ended.pointerId !== pointer) return;
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16;
    if (event.key === 'ArrowRight') panel.set(panel.width + step * direction);
    else if (event.key === 'ArrowLeft') panel.set(panel.width - step * direction);
    else if (event.key === 'Home') panel.set(panel.bounds.min);
    else if (event.key === 'End') panel.set(panel.bounds.max);
    else return;
    event.preventDefault();
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={panel.width}
      aria-valuemin={panel.bounds.min}
      aria-valuemax={panel.bounds.max}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={start}
      onKeyDown={keys}
      onDoubleClick={() => panel.set(panel.bounds.initial)}
      className={cn(
        'group absolute inset-y-0 z-20 hidden w-2 cursor-col-resize touch-none outline-none md:block',
        side === 'right' ? '-right-1' : '-left-1',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-150 group-hover:bg-ring group-focus-visible:bg-ring motion-reduce:transition-none',
          dragging && 'bg-ring',
        )}
      />
    </div>
  );
}
