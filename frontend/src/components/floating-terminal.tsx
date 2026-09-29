import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, m } from 'motion/react';
import { glide } from '@/lib/motion';
import { keepReachable, raiseWindow, resizeFrom, useWindowLayer, type Box, type Edge } from '@/lib/floating-windows';
import { ResizeEdges } from '@/components/ui/resize-edges';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { computerTerminal, terminalSessionsQuery, type TerminalRequest } from '@/lib/computer-terminals';
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

/**
 * The desktop's right-edge handle ("‹", "‹ Terminals" on hover) opens a drawer of this computer's terminals with
 * their current screens rendered; choosing one brings it up as a floating window over the live desktop. The window
 * keeps the terminal's own shape, is dragged by its title bar (anywhere on the page, 64px always on screen) and
 * resized from its corner, comes to the front when touched, and its one traffic light (red ×) closes it back into the drawer.
 */
export function FloatingTerminal({
  computer,
  onExpand,
}: {
  computer: Computer;
  /** Open the Terminal view (where terminals are created). */
  onExpand: (session: string | null) => void;
}) {
  const client = useQueryClient();
  const [drawer, setDrawer] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const [session, setSession] = useState<string | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [shape, setShape] = useState<Shape | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ kind: 'move' | Edge; x: number; y: number; start: Box } | null>(null);
  const sessions = useQuery({
    ...terminalSessionsQuery(computer.id),
    enabled: drawer || session !== null,
    refetchInterval: session ? 4000 : false,
  });
  const list = sessions.data?.sessions ?? [];
  const current = list.find(item => item.id === session);
  // The computer admits one operation at a time, so the drawer reads each screen in turn, in one request.
  const previews = useQuery({
    queryKey: ['terminal-previews', computer.id, list.map(item => item.id).join()],
    enabled: drawer && list.length > 0,
    staleTime: 0,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const texts: Record<string, string> = {};
      for (const item of list) {
        try {
          const screen = await computerTerminal(computer.id, { operation: 'view', session: item.id }, signal);
          texts[item.id] = screen.text ?? '';
        } catch {
          texts[item.id] = '';
        }
      }
      return texts;
    },
  });

  const layer = useWindowLayer('terminal');
  /** The viewer's box on the page: where the window first opens and where it grows from and shrinks back to. */
  const viewer = () =>
    area.current?.getBoundingClientRect() ?? { left: 0, top: 0, right: 800, width: 800, height: 600 };
  const bringUp = (id: string) => {
    const room = viewer();
    setSession(id);
    setDrawer(false);
    setShape(null);
    raiseWindow('terminal');
    // Opens at the viewer's right side, where the drawer was; later opens keep where the operator put it.
    setBox(current => {
      if (current) return current;
      const width = Math.min(760, room.width * 0.55);
      return place({ width, height: 0, x: room.right - width - 56, y: room.top + room.height * 0.1 }, null);
    });
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
  const minimize = () => {
    setSession(null);
    setDrawer(true);
  };
  // Once the console reports its grid, wrap the window around that shape.
  useEffect(() => {
    if (shape) setBox(current => (current ? place(current, shape) : current));
  }, [shape]);
  useEffect(() => {
    if (!session) return;
    const refit = () => setBox(current => (current ? place(current, shape) : current));
    window.addEventListener('resize', refit);
    return () => window.removeEventListener('resize', refit);
  }, [session, shape]);

  const start = (kind: 'move' | Edge) => (event: ReactPointerEvent<HTMLElement>) => {
    if (!box || event.button !== 0) return;
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
    <div ref={area} className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <Dialog.Root open={drawer} onOpenChange={setDrawer}>
        {!current && (
          <div className="absolute inset-y-0 right-2 flex items-center">
            <Dialog.Trigger asChild>
              <EdgeHandle label="Terminals" icon={<ChevronLeftIcon className="size-4" />} />
            </Dialog.Trigger>
          </div>
        )}
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 motion-safe:data-[state=open]:animate-[fade-in_200ms_ease-out] motion-safe:data-[state=closed]:animate-[fade-out_160ms_ease-in]" />
          <Dialog.Content className="sheet-right fixed inset-y-0 right-0 z-50 flex w-[min(26rem,100vw)] flex-col border-l border-border bg-background pt-[env(safe-area-inset-top)] shadow-2xl outline-none">
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
            <Dialog.Description className="sr-only">Choose a terminal to float over the desktop.</Dialog.Description>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-5">
              {sessions.isPending && <p className="py-6 text-sm text-muted-foreground">Loading terminals…</p>}
              {sessions.isError && (
                <p role="alert" className="py-6 text-sm text-red-400">
                  {sessions.error.message}
                </p>
              )}
              {sessions.isSuccess && !list.length && (
                <div className="space-y-3 py-6 text-sm text-muted-foreground">
                  <p>No terminals on this computer yet.</p>
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
              {list.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={`Float ${item.name}`}
                  onClick={() => bringUp(item.id)}
                  className="card-enter block w-full overflow-hidden rounded-lg border border-border bg-sidebar text-left outline-none transition-colors hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
                >
                  {/* The session's current screen, drawn as text at the terminal's own proportions. */}
                  <span
                    className="relative block overflow-hidden bg-[#141414] [container-type:inline-size]"
                    style={{ aspectRatio: `${item.columns * 0.6} / ${item.rows * 1.15}` }}
                  >
                    {previews.data?.[item.id] ? (
                      <pre
                        data-testid="terminal-preview"
                        aria-hidden="true"
                        className="absolute inset-x-0 bottom-0 m-0 whitespace-pre p-[2cqw] font-mono text-[#d4d4d4]"
                        style={{ fontSize: `calc(96cqw / ${item.columns * 0.6})`, lineHeight: 1.15 }}
                      >
                        {previews.data[item.id].split('\n').slice(-item.rows).join('\n')}
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
              ))}
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
          {current && box && (
            // Grows out of the viewer's right edge, where the Terminals drawer lives, and shrinks back into it.
            <m.section
              key="floating-terminal"
              aria-label="Floating terminal"
              initial={{ opacity: 0, scale: 0.12 }}
              animate={{ opacity: 1, scale: 1, transition: { ...glide, opacity: { duration: 0.16 } } }}
              exit={{ opacity: 0, scale: 0.12, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
              data-floating-window
              data-focused={layer.focused ? '' : undefined}
              className="fixed flex flex-col"
              onPointerDownCapture={() => raiseWindow('terminal')}
              style={{
                left: box.x,
                top: box.y,
                width: box.width,
                height: box.height,
                zIndex: layer.zIndex,
                transformOrigin: `${viewer().right - box.x}px ${viewer().top + viewer().height / 2 - box.y}px`,
              }}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
            >
              <Suspense fallback={<div className="flex-1 rounded-xl border border-white/15 bg-[#141414]" />}>
                <TerminalEmulator
                  key={`${current.id}:${current.columns}x${current.rows}`}
                  computerId={computer.id}
                  sessionId={current.id}
                  interactive={current.alive}
                  title={current.name}
                  columns={current.columns}
                  rows={current.rows}
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
                  titleLeading={
                    // One traffic light: close the window back into the Terminals drawer.
                    <CloseLight label="Close to Terminals" onClick={minimize} dim={!layer.focused} />
                  }
                />
              </Suspense>
              <ResizeEdges onStart={start} />
            </m.section>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
