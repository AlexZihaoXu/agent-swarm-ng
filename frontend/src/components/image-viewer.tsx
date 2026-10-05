import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronLeftIcon, DownloadIcon } from '@/components/ui/icons';
import { dialogMotion, dialogOverlay } from '@/lib/styles';
import { cn } from '@/lib/utils';

export type ViewerImage = { id: string; name: string; src: string; download: string };

/** How far a tap zooms in. */
const ZOOM = 2.5;
/** A pointer that moves further than this is a drag (pan or swipe), never a tap. */
const TAP_SLOP = 8;
/** A horizontal swipe at least this long (and mostly sideways) moves to the next or previous image. */
const SWIPE = 50;

type Box = { left: number; top: number; width: number; height: number };
type Zoom = { x: number; y: number; base: Box; stage: Box };

/** Keeps a zoomed image over the stage: no gap at an edge it could cover, centred along a side it cannot fill. */
function clamp(x: number, y: number, { base, stage }: Pick<Zoom, 'base' | 'stage'>) {
  const axis = (offset: number, start: number, size: number, stageStart: number, stageSize: number) => {
    const half = (size * ZOOM) / 2;
    const centre = start + size / 2;
    if (half * 2 <= stageSize) return stageStart + stageSize / 2 - centre;
    return Math.min(Math.max(offset, stageStart + stageSize - half - centre), stageStart + half - centre);
  };
  return {
    x: axis(x, base.left, base.width, stage.left, stage.width),
    y: axis(y, base.top, base.height, stage.top, stage.height),
  };
}
const box = (element: Element): Box => {
  const { left, top, width, height } = element.getBoundingClientRect();
  return { left, top, width, height };
};

const control =
  'flex size-11 shrink-0 items-center justify-center rounded-full bg-black/45 text-white outline-none backdrop-blur-sm transition-colors hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-white/80';

/**
 * A chat image full screen (the app's Radix Dialog): a tap or click zooms in on that point, dragging or scrolling pans,
 * another tap zooms out. The ×, a tap beside the image, or Escape closes it; several images page with the arrows, ←/→
 * and (unzoomed) a swipe. Focus returns to the thumbnail of the image last shown.
 */
export function ImageViewer({
  images,
  index,
  onIndexChange,
  onClose,
  returnFocus,
}: {
  images: ViewerImage[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  returnFocus: (index: number) => HTMLElement | null | undefined;
}) {
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const [dragging, setDragging] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const last = useRef(0);
  const gesture = useRef<{
    id: number;
    startX: number;
    startY: number;
    from: { x: number; y: number } | null;
    onImage: boolean;
    moved: boolean;
  } | null>(null);
  if (index !== null) last.current = index;
  // The last image stays while the viewer fades out.
  const image = images[index ?? last.current] ?? null;
  const several = images.length > 1;

  // Each image opens fitted, and a resized window refits (the zoom was measured for the old layout).
  useEffect(() => {
    setZoom(null);
    const refit = () => setZoom(null);
    window.addEventListener('resize', refit);
    return () => window.removeEventListener('resize', refit);
  }, [index]);

  const go = (step: number) => {
    if (index === null || !several) return;
    onIndexChange((index + step + images.length) % images.length);
  };
  const zoomAt = (clientX: number, clientY: number) => {
    if (!picture.current || !stage.current) return;
    const base = box(picture.current),
      area = box(stage.current);
    const centreX = base.left + base.width / 2,
      centreY = base.top + base.height / 2;
    // Move the tapped point to the middle of the screen.
    const x = area.left + area.width / 2 - centreX - ZOOM * (clientX - centreX);
    const y = area.top + area.height / 2 - centreY - ZOOM * (clientY - centreY);
    setZoom({ ...clamp(x, y, { base, stage: area }), base, stage: area });
  };
  const toggleZoom = (clientX?: number, clientY?: number) => {
    if (zoom) return setZoom(null);
    const rect = picture.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAt(clientX ?? rect.left + rect.width / 2, clientY ?? rect.top + rect.height / 2);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gesture.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const target = event.target as Element;
    if (target.closest('button, a')) return;
    gesture.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      from: zoom && { x: zoom.x, y: zoom.y },
      onImage: target === picture.current,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.startX,
      dy = event.clientY - current.startY;
    if (!current.moved && Math.hypot(dx, dy) > TAP_SLOP) {
      current.moved = true;
      if (zoom) setDragging(true);
    }
    if (current.moved && zoom && current.from)
      setZoom({ ...zoom, ...clamp(current.from.x + dx, current.from.y + dy, zoom) });
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    setDragging(false);
    if (event.type === 'pointercancel') return;
    const dx = event.clientX - current.startX,
      dy = event.clientY - current.startY;
    if (current.moved) {
      if (!zoom && Math.abs(dx) >= SWIPE && Math.abs(dx) > Math.abs(dy) * 1.2) go(dx < 0 ? 1 : -1);
      return;
    }
    if (current.onImage) toggleZoom(event.clientX, event.clientY);
    else onClose();
  };

  return (
    <Dialog.Root open={index !== null && image !== null} onOpenChange={open => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn(dialogOverlay, 'bg-black/85')} />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={event => {
            const thumbnail = returnFocus(last.current);
            if (!thumbnail) return;
            event.preventDefault();
            thumbnail.focus();
          }}
          onKeyDown={event => {
            if (event.key === 'ArrowRight') go(1);
            else if (event.key === 'ArrowLeft') go(-1);
            else return;
            event.preventDefault();
          }}
          className={cn('fixed inset-0 z-50 text-white outline-none', dialogMotion)}
        >
          {image && (
            <>
              <div
                ref={stage}
                data-testid="image-viewer-stage"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerEnd}
                onPointerCancel={onPointerEnd}
                onWheel={event => {
                  if (zoom) setZoom({ ...zoom, ...clamp(zoom.x - event.deltaX, zoom.y - event.deltaY, zoom) });
                }}
                className="absolute inset-0 flex touch-none items-center justify-center overflow-hidden px-[max(1rem,env(safe-area-inset-left))] pt-[max(4rem,calc(env(safe-area-inset-top)+3.5rem))] pb-[max(1rem,env(safe-area-inset-bottom))] select-none sm:px-16 sm:pb-6"
              >
                <img
                  key={image.id}
                  ref={picture}
                  src={image.src}
                  alt={image.name}
                  draggable={false}
                  style={zoom ? { transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${ZOOM})` } : undefined}
                  className={cn(
                    'block max-h-full max-w-full object-contain motion-safe:animate-[fade-in_160ms_ease-out]',
                    !dragging && 'motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out',
                    zoom ? (dragging ? 'cursor-grabbing' : 'cursor-zoom-out') : 'cursor-zoom-in',
                  )}
                />
              </div>
              <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-6 pl-[max(1rem,env(safe-area-inset-left))]">
                <div className="min-w-0 flex-1">
                  <Dialog.Title className="truncate text-sm font-medium" title={image.name}>
                    {image.name}
                  </Dialog.Title>
                  {several && (
                    <p
                      className="text-xs text-white/70 tabular-nums"
                      aria-label={`Image ${last.current + 1} of ${images.length}`}
                    >
                      {last.current + 1} / {images.length}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => toggleZoom()}
                  aria-label={zoom ? 'Zoom out' : 'Zoom in'}
                  title={zoom ? 'Zoom out' : 'Zoom in'}
                  className={cn(control, 'pointer-events-auto')}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    className="size-5"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d={zoom ? 'm20 20-3.5-3.5M8 11h6' : 'm20 20-3.5-3.5M8 11h6M11 8v6'} />
                  </svg>
                </button>
                <a
                  href={image.download}
                  download={image.name}
                  aria-label={`Download ${image.name}`}
                  title="Download"
                  className={cn(control, 'pointer-events-auto')}
                >
                  <DownloadIcon className="size-5" />
                </a>
                <Dialog.Close
                  aria-label="Close image viewer"
                  title="Close"
                  className={cn(control, 'pointer-events-auto text-2xl leading-none')}
                >
                  <span aria-hidden="true">×</span>
                </Dialog.Close>
              </div>
              {several && (
                <>
                  <button
                    type="button"
                    aria-label="Previous image"
                    onClick={() => go(-1)}
                    className={cn(
                      control,
                      'absolute top-1/2 left-[max(0.5rem,env(safe-area-inset-left))] -translate-y-1/2',
                    )}
                  >
                    <ChevronLeftIcon className="size-6" />
                  </button>
                  <button
                    type="button"
                    aria-label="Next image"
                    onClick={() => go(1)}
                    className={cn(
                      control,
                      'absolute top-1/2 right-[max(0.5rem,env(safe-area-inset-right))] -translate-y-1/2',
                    )}
                  >
                    <ChevronLeftIcon className="size-6 rotate-180" />
                  </button>
                </>
              )}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
