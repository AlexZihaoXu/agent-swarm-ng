import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { m, useReducedMotion } from 'motion/react';
import { glide } from '@/lib/motion';
import { keepReachable, raiseWindow, resizeFrom, useWindowLayer, type Box, type Edge } from '@/lib/floating-windows';
import { ResizeEdges } from './ui/resize-edges';
import { LockIcon, UnlockIcon } from './ui/icons';

const TITLE = 32;
/** The desktop is 16:9: the window keeps that shape below its title bar, from 320 px wide up to the page. */
const fit = (width: number) => {
  const w = Math.min(Math.max(width, 320), window.innerWidth - 16, ((window.innerHeight - 16 - TITLE) * 16) / 9);
  return { width: Math.round(w), height: Math.round((w * 9) / 16) + TITLE };
};
const place = (box: Box): Box => keepReachable({ ...box, ...fit(box.width) });

/**
 * A computer's live desktop in a floating window (Portal). Input starts locked, like the full viewer: the lock in the
 * title bar lets the human type and click into it, and then keys (Ctrl/⌘+K too) go to the computer. The stream
 * connects at the window's first size; later resizes scale it, as the full viewer does.
 */
export function FloatingComputer({
  computerId,
  name,
  running,
  windowId,
  from,
  lights,
  initial,
  onBox,
  onExpand,
}: {
  computerId: string;
  name: string;
  running: boolean;
  windowId: string;
  from: { x: number; y: number } | null;
  lights: ReactNode;
  initial?: Box | null;
  onBox?: (box: Box) => void;
  /** Open the full viewer. */
  onExpand: () => void;
}) {
  const layer = useWindowLayer(windowId);
  const reduced = useReducedMotion();
  const [box, setBox] = useState<Box>(() =>
    place(initial ?? { x: window.innerWidth - 640 - 48, y: 72, width: 640, height: 0 }),
  );
  const [input, setInput] = useState(false);
  const [dragging, setDragging] = useState(false);
  const connected = useRef(box.width);
  const frame = useRef<HTMLIFrameElement>(null);
  const gesture = useRef<{ kind: 'move' | Edge; x: number; y: number; start: Box } | null>(null);
  useEffect(() => raiseWindow(windowId), [windowId]);
  useEffect(() => {
    const refit = () => setBox(current => place(current));
    window.addEventListener('resize', refit);
    return () => window.removeEventListener('resize', refit);
  }, []);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: 'swarm:desktop-input', enabled: input }, window.location.origin);
    if (!input) frame.current?.blur();
  }, [input]);

  const start = (kind: 'move' | Edge) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (kind === 'move' && (event.target as Element).closest('button')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { kind, x: event.clientX, y: event.clientY, start: box };
    setDragging(true);
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = gesture.current;
    if (!drag) return;
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    setBox(
      drag.kind === 'move'
        ? place({ ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy })
        : resizeFrom(drag.start, drag.kind, dx, dy, want =>
            fit(drag.kind === 'n' || drag.kind === 's' ? ((want.height - TITLE) * 16) / 9 : want.width),
          ),
    );
  };
  const end = () => {
    if (gesture.current) onBox?.(box);
    gesture.current = null;
    setDragging(false);
  };
  const scale = box.width / connected.current;
  const origin = from ? `${from.x - box.x}px ${from.y - box.y}px` : 'center';

  return (
    <m.section
      aria-label={`Floating desktop ${name}`}
      initial={{ opacity: 0, scale: 0.12 }}
      animate={{ opacity: 1, scale: 1, transition: { ...glide, opacity: { duration: 0.16 } } }}
      exit={{ opacity: 0, scale: 0.12, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
      data-floating-window
      data-focused={layer.focused ? '' : undefined}
      className={`portal-glass fixed flex flex-col overflow-hidden rounded-xl border transition-[border-color,box-shadow] duration-200 ${layer.focused ? 'border-white/15 shadow-2xl shadow-black/60' : 'border-white/[0.08] ao-top shadow-lg shadow-black/40'}`}
      onPointerDownCapture={() => raiseWindow(windowId)}
      style={{
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        zIndex: layer.zIndex,
        transformOrigin: origin,
        transition: dragging || reduced ? 'none' : undefined,
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <header
        onPointerDown={start('move')}
        className="flex h-8 shrink-0 cursor-grab touch-none select-none items-center gap-2 border-b border-white/10 px-3 active:cursor-grabbing"
      >
        {lights}
        <span
          className={`min-w-0 flex-1 truncate text-center text-xs font-medium ${layer.focused ? '' : 'text-muted-foreground'}`}
        >
          {name}
        </span>
        {running && (
          <button
            type="button"
            aria-pressed={input}
            aria-label={input ? `Input live on ${name}; lock it` : `Input locked on ${name}; let me use it`}
            title={input ? 'Lock input' : 'Use this desktop'}
            onClick={() => setInput(value => !value)}
            className={`flex size-6 shrink-0 cursor-pointer items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-ring ${input ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {input ? <UnlockIcon className="size-3.5" /> : <LockIcon className="size-3.5" />}
          </button>
        )}
        <button
          type="button"
          onClick={onExpand}
          className="shrink-0 cursor-pointer rounded px-1 text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Open viewer
        </button>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
        {running ? (
          <>
            <iframe
              ref={frame}
              title={`${name} desktop`}
              src={`/computers/${encodeURIComponent(computerId)}/desktop/?viewer=streamed-cursor-v2`}
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-downloads"
              inert={!input}
              tabIndex={input ? 0 : -1}
              onLoad={() =>
                frame.current?.contentWindow?.postMessage(
                  { type: 'swarm:desktop-input', enabled: input },
                  window.location.origin,
                )
              }
              className={`absolute left-0 top-0 origin-top-left border-0 ${input ? '' : 'pointer-events-none'}`}
              style={{
                width: connected.current,
                height: (connected.current * 9) / 16,
                transform: scale !== 1 ? `scale(${scale})` : undefined,
              }}
            />
            {!input && <div aria-hidden="true" className="absolute inset-0" />}
          </>
        ) : (
          <p className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
            {name} is off. Start it from Computers.
          </p>
        )}
      </div>
      <ResizeEdges onStart={start} />
    </m.section>
  );
}
