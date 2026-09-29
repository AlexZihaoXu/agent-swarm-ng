import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { parseAnsi, type Style } from '@/lib/ansi';
import { createPortal } from 'react-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, m } from 'motion/react';
import { glide } from '@/lib/motion';
import {
  dropWindow,
  keepReachable,
  raiseWindow,
  resizeFrom,
  useWindowLayer,
  type Box,
  type Edge,
} from '@/lib/floating-windows';
import { AboveWindows } from '@/components/ui/above-windows';
import { ResizeEdges } from '@/components/ui/resize-edges';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  computerTerminal,
  terminalSessionsQuery,
  type TerminalRequest,
  type TerminalResult,
} from '@/lib/computer-terminals';
import { ChevronLeftIcon, PlusIcon } from '@/components/ui/icons';
import { NewTerminalDialog } from './new-terminal-dialog';
import { EdgeHandle } from '@/components/ui/edge-handle';
import { CloseLight } from '@/components/ui/close-light';
import type { Computer } from './computer-card';

const TerminalEmulator = lazy(() =>
  import('./terminal-emulator').then(module => ({ default: module.TerminalEmulator })),
);

type Shape = { width: number; height: number; chromeWidth: number; chromeHeight: number };
const MIN_WIDTH = 320;

/** Height that makes the window exactly wrap the grid at this width (no empty bands around the text). */
const fitted = (width: number, shape: Shape | null) =>
  shape ? shape.chromeHeight + ((width - shape.chromeWidth) * shape.height) / shape.width : width * 0.6;

/** The window's size at this width: the height always wraps the grid, and it all fits on the page. */
function fit(wantWidth: number, shape: Shape | null) {
  const room = { width: window.innerWidth, height: window.innerHeight };
  let width = Math.min(Math.max(wantWidth, MIN_WIDTH), room.width - 16);
  let height = fitted(width, shape);
  // Too tall for the page: narrow the window until its fitted height fits.
  if (height > room.height - 16 && shape) {
    width = shape.chromeWidth + ((room.height - 16 - shape.chromeHeight) * shape.width) / shape.height;
    height = room.height - 16;
  }
  return { width, height };
}

/** Sizes the window to the terminal's shape within the page, then keeps it reachable. */
const place = (box: Box, shape: Shape | null): Box => keepReachable({ ...box, ...fit(box.width, shape) });

/** Resizing keeps the grid's shape: side edges and corners set the width, top and bottom edges the height. */
const shapedSize = (shape: Shape | null) => (want: { width: number; height: number }, edge: Edge) =>
  fit(
    (edge === 'n' || edge === 's') && shape
      ? shape.chromeWidth + ((want.height - shape.chromeHeight) * shape.width) / shape.height
      : want.width,
    shape,
  );

type Session = NonNullable<TerminalResult['sessions']>[number];
type Rect = { left: number; top: number; width: number; height: number };

/**
 * The desktop's right-edge handle ("‹", "‹ Terminals" on hover) opens a drawer of this computer's terminals with
 * their current screens rendered. Choosing one floats it over the live desktop as its own window (several can be
 * out at once); its card leaves the drawer while it is out and returns when the window is closed. The drawer does
 * not block the page, so windows stay usable while it is open.
 */
export function FloatingTerminal({
  computer,
  onExpand,
}: {
  computer: Computer;
  /** Open the Terminal view. */
  onExpand: (session: string | null) => void;
}) {
  const client = useQueryClient();
  const [drawer, setDrawer] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  // Sessions out on the desktop, in the order they were brought out, with where each grew from.
  const [floating, setFloating] = useState<{ id: string; from: Rect | null }[]>([]);
  const area = useRef<HTMLDivElement>(null);
  const sessions = useQuery({
    ...terminalSessionsQuery(computer.id),
    enabled: drawer || floating.length > 0,
    refetchInterval: floating.length ? 4000 : false,
  });
  const list = sessions.data?.sessions ?? [];
  const docked = list.filter(item => !floating.some(out => out.id === item.id));
  // A session deleted elsewhere closes its window.
  useEffect(() => {
    if (sessions.isSuccess) setFloating(current => current.filter(out => list.some(item => item.id === out.id)));
  }, [sessions.data]);
  // Live previews: every screen, with its colours, in one request about twice a second while the drawer is open.
  const previews = useQuery({
    queryKey: ['terminal-screens', computer.id],
    enabled: drawer && docked.length > 0,
    refetchInterval: 500,
    refetchIntervalInBackground: false,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const result = await computerTerminal(computer.id, { operation: 'screens' }, signal);
      return Object.fromEntries((result.screens ?? []).map(screen => [screen.id, screen.ansi]));
    },
  });

  /** The viewer's box on the page: where windows first open and where they shrink back to. */
  const viewer = (): Rect & { right: number } =>
    area.current?.getBoundingClientRect() ?? { left: 0, top: 0, right: 800, width: 800, height: 600 };
  const bringUp = (id: string, from: Rect | null = null) => {
    setFloating(current => (current.some(out => out.id === id) ? current : [...current, { id, from }]));
    raiseWindow(`terminal:${id}`);
  };
  // Closing puts the terminal back in the drawer: the drawer opens, then the window shrinks into it as its card
  // slides back into the list.
  const close = (id: string) => {
    const remove = () => setFloating(current => current.filter(out => out.id !== id));
    if (drawer) return remove();
    setDrawer(true);
    window.setTimeout(remove, 180);
  };
  // A terminal made from the drawer floats up straight away.
  const create = async (body: TerminalRequest) => {
    setCreateBusy(true);
    setCreateError('');
    try {
      const result = await computerTerminal(computer.id, body);
      await client.invalidateQueries({ queryKey: terminalSessionsQuery(computer.id).queryKey });
      setCreating(false);
      if (result.session) bringUp(result.session.id);
      return true;
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Could not create the terminal.');
      return false;
    } finally {
      setCreateBusy(false);
    }
  };
  const newTerminal = () => {
    setCreateError('');
    setCreating(true);
  };

  return (
    <div ref={area} className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <Dialog.Root open={drawer} onOpenChange={setDrawer} modal={false}>
        {/* Always reachable, above any floating window. */}
        <AboveWindows>
          <div className="absolute inset-y-0 right-2 flex items-center">
            <Dialog.Trigger asChild>
              <EdgeHandle label="Terminals" icon={<ChevronLeftIcon className="size-4" />} />
            </Dialog.Trigger>
          </div>
        </AboveWindows>
        <Dialog.Portal>
          <Dialog.Content
            // Windows stay usable while the drawer is open; touching one keeps the drawer open.
            onInteractOutside={event => {
              if ((event.target as Element | null)?.closest?.('[data-floating-window], [role="dialog"]'))
                event.preventDefault();
            }}
            className="sheet-right fixed inset-y-0 right-0 z-50 flex w-[min(26rem,100vw)] flex-col border-l border-border bg-background pt-[env(safe-area-inset-top)] shadow-2xl outline-none"
          >
            <div className="flex items-center gap-1 px-4 pb-2 pt-4">
              <Dialog.Title className="text-base font-semibold">Terminals</Dialog.Title>
              <button
                type="button"
                aria-label="New terminal"
                title="New terminal"
                onClick={newTerminal}
                className="ml-auto flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <PlusIcon />
              </button>
              <Dialog.Close className="flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                <span className="sr-only">Close</span>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" />
                </svg>
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">Choose terminals to float over the desktop.</Dialog.Description>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
              {sessions.isPending && <p className="py-6 text-sm text-muted-foreground">Loading terminals…</p>}
              {sessions.isError && (
                <p role="alert" className="py-6 text-sm text-red-400">
                  {sessions.error.message}
                </p>
              )}
              {sessions.isSuccess && !docked.length && (
                <div className="space-y-3 py-6 text-sm text-muted-foreground">
                  <p>{list.length ? 'Every terminal is out on the desktop.' : 'No terminals on this computer yet.'}</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={newTerminal}
                      className="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background outline-none hover:bg-foreground/90 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <PlusIcon className="size-3.5" />
                      New terminal
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDrawer(false);
                        onExpand(null);
                      }}
                      className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Open the Terminal view
                    </button>
                  </div>
                </div>
              )}
              {/* A card collapses out of the list as its terminal floats up, and comes back when it is closed. */}
              <AnimatePresence initial={false}>
                {docked.map(item => (
                  <m.div
                    key={item.id}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="pb-3">
                      <DrawerCard
                        item={item}
                        preview={previews.data?.[item.id]}
                        onFloat={from => bringUp(item.id, from)}
                      />
                    </div>
                  </m.div>
                ))}
              </AnimatePresence>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <NewTerminalDialog
        open={creating}
        onOpenChange={setCreating}
        busy={createBusy}
        error={createError}
        onSubmit={create}
      />
      {createPortal(
        <AnimatePresence>
          {floating.map((out, index) => {
            const session = list.find(item => item.id === out.id);
            return session ? (
              <TerminalWindow
                key={out.id}
                computerId={computer.id}
                session={session}
                from={out.from}
                cascade={index}
                viewer={viewer}
                onClose={() => close(out.id)}
              />
            ) : null;
          })}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

/** Inline style for a run, drawn on the terminal's own background and foreground. */
const runStyle = (style: Style): CSSProperties => {
  const fg = style.inverse ? (style.bg ?? '#141414') : style.fg;
  const bg = style.inverse ? (style.fg ?? '#ededed') : style.bg;
  return {
    color: fg,
    backgroundColor: bg,
    fontWeight: style.bold ? 700 : undefined,
    fontStyle: style.italic ? 'italic' : undefined,
    textDecoration: style.underline ? 'underline' : undefined,
    opacity: style.dim ? 0.6 : undefined,
  };
};

function DrawerCard({ item, preview, onFloat }: { item: Session; preview?: string; onFloat: (from: Rect) => void }) {
  return (
    <button
      type="button"
      aria-label={`Float ${item.name}`}
      onClick={event => onFloat(event.currentTarget.getBoundingClientRect())}
      className="block w-full overflow-hidden rounded-lg border border-border bg-sidebar text-left outline-none transition-colors hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* The session's current screen, drawn as text at the terminal's own proportions. */}
      <span
        className="relative block overflow-hidden bg-[#141414] [container-type:inline-size]"
        style={{ aspectRatio: `${item.columns * 0.6} / ${item.rows * 1.15}` }}
      >
        {preview !== undefined ? (
          <pre
            data-testid="terminal-preview"
            aria-hidden="true"
            className="absolute inset-0 m-0 overflow-hidden whitespace-pre p-[2cqw] font-mono text-[#ededed]"
            style={{ fontSize: `calc(96cqw / ${item.columns * 0.6})`, lineHeight: 1.15 }}
          >
            {parseAnsi(preview)
              .slice(0, item.rows)
              .map((line, row) => (
                <div key={row} className="h-[1.15em]">
                  {line.map((run, index) => (
                    <span key={index} style={runStyle(run.style)}>
                      {run.text}
                    </span>
                  ))}
                </div>
              ))}
          </pre>
        ) : (
          <span className="skeleton absolute inset-2 rounded" />
        )}
      </span>
      <span className="flex items-center gap-2 px-3 py-2">
        <span
          aria-hidden="true"
          className={`size-1.5 rounded-full ${item.alive ? 'bg-teal-400' : 'bg-muted-foreground/60'}`}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{item.name}</span>
        <span className="text-[11px] text-muted-foreground">
          {item.alive ? (item.currentCommand ?? 'running') : 'exited'} · {item.columns}×{item.rows}
        </span>
      </span>
    </button>
  );
}

/**
 * One floating terminal window: it keeps the terminal's own shape, is dragged by its title bar (anywhere on the
 * page, 64px always on screen) and resized from any edge, comes to the front and takes focus when touched, and its
 * red close light shrinks it back into the viewer's right edge, where the Terminals drawer lives.
 */
function TerminalWindow({
  computerId,
  session,
  from,
  cascade,
  viewer,
  onClose,
}: {
  computerId: string;
  session: Session;
  /** The drawer card it was chosen from, which it grows out of. */
  from: Rect | null;
  /** Its place among the open windows, so new ones step down instead of landing on top of each other. */
  cascade: number;
  viewer: () => Rect & { right: number };
  onClose: () => void;
}) {
  const id = `terminal:${session.id}`;
  const layer = useWindowLayer(id);
  const [shape, setShape] = useState<Shape | null>(null);
  const [box, setBox] = useState<Box>(() => {
    const room = viewer();
    const width = Math.min(760, room.width * 0.55);
    const step = (cascade % 6) * 28;
    // Chosen from the open drawer, it opens just left of it, so it can be seen growing out of its card.
    const right = Math.min(room.right - 56, from ? from.left - 32 : Infinity);
    return place({ width, height: 0, x: right - width - step, y: room.top + room.height * 0.1 + step }, null);
  });
  // It grows out of its drawer card; once open, it closes toward the right edge instead.
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(
    from ? { x: from.left + from.width / 2, y: from.top + from.height / 2 } : null,
  );
  const edge = () => {
    const room = viewer();
    return { x: room.right, y: room.top + room.height / 2 };
  };
  const point = origin ?? edge();
  const gesture = useRef<{ kind: 'move' | Edge; x: number; y: number; start: Box } | null>(null);
  useEffect(() => {
    raiseWindow(id);
    return () => dropWindow(id);
  }, [id]);
  // Once the console reports its grid, wrap the window around that shape.
  useEffect(() => {
    if (shape) setBox(current => place(current, shape));
  }, [shape]);
  useEffect(() => {
    const refit = () => setBox(current => place(current, shape));
    window.addEventListener('resize', refit);
    return () => window.removeEventListener('resize', refit);
  }, [shape]);

  const start = (kind: 'move' | Edge) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (kind === 'move' && (event.target as Element).closest('button')) return;
    event.preventDefault();
    // Capture keeps the drag going while the pointer passes over the desktop stream's iframe.
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { kind, x: event.clientX, y: event.clientY, start: box };
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = gesture.current;
    if (!drag) return;
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    setBox(
      drag.kind === 'move'
        ? place({ ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy }, shape)
        : resizeFrom(drag.start, drag.kind, dx, dy, shapedSize(shape)),
    );
  };
  const end = () => {
    gesture.current = null;
  };

  return (
    <m.section
      aria-label={`Floating terminal ${session.name}`}
      initial={{ opacity: 0, scale: 0.12 }}
      animate={{ opacity: 1, scale: 1, transition: { ...glide, opacity: { duration: 0.16 } } }}
      exit={{ opacity: 0, scale: 0.12, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
      onAnimationComplete={() => setOrigin(null)}
      data-floating-window
      data-focused={layer.focused ? '' : undefined}
      className="fixed flex flex-col"
      onPointerDownCapture={() => raiseWindow(id)}
      style={{
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        zIndex: layer.zIndex,
        transformOrigin: `${point.x - box.x}px ${point.y - box.y}px`,
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <Suspense fallback={<div className="flex-1 rounded-xl border border-white/15 bg-[#141414]" />}>
        <TerminalEmulator
          key={`${session.id}:${session.columns}x${session.rows}`}
          computerId={computerId}
          sessionId={session.id}
          interactive={session.alive}
          title={session.name}
          columns={session.columns}
          rows={session.rows}
          fill
          inactive={!layer.focused}
          onMeasure={next =>
            setShape(previous =>
              previous &&
              previous.width === next.width &&
              previous.height === next.height &&
              previous.chromeHeight === next.chromeHeight
                ? previous
                : next,
            )
          }
          onTitlePointerDown={start('move')}
          titleLeading={<CloseLight label={`Close ${session.name}`} onClick={onClose} dim={!layer.focused} />}
        />
      </Suspense>
      <ResizeEdges onStart={start} />
    </m.section>
  );
}
