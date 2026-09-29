import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Edge } from '@/lib/floating-windows';

// Hit zones straddle the window's border; corners are larger so they are easy to catch.
const zones: { edge: Edge; zone: string; cursor: string; line: string }[] = [
  { edge: 'n', zone: '-top-1 inset-x-3 h-2', cursor: 'cursor-ns-resize', line: 'inset-x-2 top-1 h-0.5' },
  { edge: 's', zone: '-bottom-1 inset-x-3 h-2', cursor: 'cursor-ns-resize', line: 'inset-x-2 bottom-1 h-0.5' },
  { edge: 'w', zone: '-left-1 inset-y-3 w-2', cursor: 'cursor-ew-resize', line: 'inset-y-2 left-1 w-0.5' },
  { edge: 'e', zone: '-right-1 inset-y-3 w-2', cursor: 'cursor-ew-resize', line: 'inset-y-2 right-1 w-0.5' },
  {
    edge: 'nw',
    zone: '-left-1 -top-1 size-4',
    cursor: 'cursor-nwse-resize',
    line: 'left-1 top-1 size-3 rounded-tl-xl border-l-2 border-t-2',
  },
  {
    edge: 'ne',
    zone: '-right-1 -top-1 size-4',
    cursor: 'cursor-nesw-resize',
    line: 'right-1 top-1 size-3 rounded-tr-xl border-r-2 border-t-2',
  },
  {
    edge: 'sw',
    zone: '-bottom-1 -left-1 size-4',
    cursor: 'cursor-nesw-resize',
    line: 'bottom-1 left-1 size-3 rounded-bl-xl border-b-2 border-l-2',
  },
  {
    edge: 'se',
    zone: '-bottom-1 -right-1 size-4',
    cursor: 'cursor-nwse-resize',
    line: 'bottom-1 right-1 size-3 rounded-br-xl border-b-2 border-r-2',
  },
];

/**
 * Resize zones on every edge and corner of a floating window, with the matching resize cursor. Hovering or
 * dragging one lights up that part of the window's border.
 */
export function ResizeEdges({ onStart }: { onStart: (edge: Edge) => (event: ReactPointerEvent<HTMLElement>) => void }) {
  return (
    <>
      {zones.map(({ edge, zone, cursor, line }) => (
        <div
          key={edge}
          role="presentation"
          data-resize-edge={edge}
          onPointerDown={onStart(edge)}
          className={`group/edge absolute z-20 touch-none ${zone} ${cursor}`}
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute opacity-0 transition-opacity duration-150 group-hover/edge:opacity-100 group-active/edge:opacity-100 ${
              edge.length === 2 ? `border-white/60 ${line}` : `rounded-full bg-white/60 ${line}`
            }`}
          />
        </div>
      ))}
    </>
  );
}
