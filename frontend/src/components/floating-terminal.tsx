import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { computerTerminal, terminalSessionsQuery } from '@/lib/computer-terminals';
import { ChevronLeftIcon, PlusIcon } from '@/components/ui/icons';
import type { Computer } from './computer-card';

const TerminalEmulator = lazy(() =>
  import('./terminal-emulator').then(module => ({ default: module.TerminalEmulator })),
);

type Box = { x: number; y: number; width: number; height: number };
const MIN = { width: 320, height: 220 };
const clamp = (box: Box, area: { width: number; height: number }): Box => {
  const width = Math.min(Math.max(box.width, MIN.width), area.width - 16);
  const height = Math.min(Math.max(box.height, MIN.height), area.height - 16);
  return {
    width,
    height,
    x: Math.min(Math.max(box.x, 8), area.width - width - 8),
    y: Math.min(Math.max(box.y, 8), area.height - height - 8),
  };
};

const windowButton =
  'flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:bg-white/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40';

/**
 * A handle on the desktop's right edge ("‹", "‹ Terminal" on hover) that pulls out a floating terminal window over
 * the live desktop. The window is dragged by its title bar, resized from its corner, and stays inside the viewer;
 * the desktop stays usable wherever the window does not cover it.
 */
export function FloatingTerminal({
  computer,
  onExpand,
}: {
  computer: Computer;
  /** Open the same session in the full Terminal view. */
  onExpand: (session: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  const [session, setSession] = useState<string | null>(null);
  const [error, setError] = useState('');
  const area = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ kind: 'move' | 'resize'; x: number; y: number; start: Box } | null>(null);
  const client = useQueryClient();
  const query = useQuery({ ...terminalSessionsQuery(computer.id), enabled: open, refetchInterval: 4000 });
  const sessions = query.data?.sessions ?? [];
  const current = sessions.find(item => item.id === session);

  useEffect(() => {
    if (open && !current && sessions.length) setSession((sessions.find(item => item.alive) ?? sessions[0]).id);
  }, [open, current, sessions]);

  const bounds = () => {
    const element = area.current?.parentElement;
    return { width: element?.clientWidth ?? 800, height: element?.clientHeight ?? 600 };
  };
  const show = () => {
    const room = bounds();
    // First open: docked to the right, a comfortable size; later opens keep where the operator put it.
    setBox(
      current =>
        current ??
        clamp(
          {
            width: Math.min(760, room.width * 0.55),
            height: Math.min(480, room.height * 0.62),
            x: room.width,
            y: room.height * 0.12,
          },
          room,
        ),
    );
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const refit = () => setBox(current => (current ? clamp(current, bounds()) : current));
    window.addEventListener('resize', refit);
    return () => window.removeEventListener('resize', refit);
  }, [open]);

  const start = (kind: 'move' | 'resize') => (event: ReactPointerEvent<HTMLElement>) => {
    if (!box || event.button !== 0) return;
    // Buttons and the picker in the title bar keep their own clicks.
    if (kind === 'move' && (event.target as Element).closest('button, select')) return;
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
      clamp(
        drag.kind === 'move'
          ? { ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy }
          : { ...drag.start, width: drag.start.width + dx, height: drag.start.height + dy },
        bounds(),
      ),
    );
  };
  const end = () => {
    gesture.current = null;
  };

  async function newTerminal() {
    setError('');
    const taken = new Set(sessions.map(item => item.name.toLowerCase()));
    let n = 1;
    while (taken.has(`shell-${n}`)) n++;
    try {
      const result = await computerTerminal(computer.id, { operation: 'create', name: `shell-${n}` });
      if (result.session) setSession(result.session.id);
      await client.invalidateQueries({ queryKey: ['computer-terminals', computer.id] });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not start a terminal.');
    }
  }

  return (
    <div ref={area} className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {!open && (
        <div className="absolute inset-y-0 right-2 flex items-center">
          <button
            type="button"
            aria-label="Floating terminal"
            onClick={show}
            className="group pointer-events-auto flex h-7 items-center gap-1 rounded-full border border-white/15 bg-black/55 px-2 text-xs font-medium text-white/70 shadow-lg backdrop-blur outline-none transition-[opacity,background-color,color,padding] duration-200 hover:bg-black/80 hover:px-3 hover:text-white focus-visible:px-3 focus-visible:text-white focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)]:opacity-60 [@media(hover:hover)]:hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
          >
            <ChevronLeftIcon className="size-4" />
            <span className="max-w-40 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 [@media(hover:hover)]:max-w-0 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:max-w-40 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-visible:max-w-40 [@media(hover:hover)]:group-focus-visible:opacity-100">
              Terminal
            </span>
          </button>
        </div>
      )}
      {open && box && (
        <section
          aria-label="Floating terminal"
          className="float-window-enter pointer-events-auto absolute flex flex-col"
          style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          {current ? (
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
                onTitlePointerDown={start('move')}
                titleContent={
                  <>
                    <select
                      aria-label="Terminal session"
                      value={current.id}
                      onChange={event => setSession(event.target.value)}
                      className="min-w-0 max-w-40 flex-1 cursor-pointer truncate rounded bg-transparent font-mono text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&>option]:bg-background"
                    >
                      {sessions.map(item => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                          {item.alive ? '' : ' (exited)'}
                        </option>
                      ))}
                    </select>
                    <span className="flex-1" />
                    <button
                      type="button"
                      aria-label="New terminal"
                      title="New terminal"
                      onClick={() => void newTerminal()}
                      className={windowButton}
                    >
                      <PlusIcon className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Open in Terminal view"
                      title="Open in Terminal view"
                      onClick={() => onExpand(current.id)}
                      className={windowButton}
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className="size-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      >
                        <path
                          d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      aria-label="Close floating terminal"
                      title="Close"
                      onClick={() => setOpen(false)}
                      className={windowButton}
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className="size-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      >
                        <path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" />
                      </svg>
                    </button>
                  </>
                }
              />
            </Suspense>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-white/15 bg-[#141414] p-4 text-center shadow-2xl shadow-black/60">
              <p className="text-sm text-muted-foreground">
                {query.isPending
                  ? 'Loading terminals…'
                  : query.isError
                    ? query.error.message
                    : 'No terminals on this computer yet.'}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void newTerminal()}
                  className="flex min-h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <PlusIcon className="size-3.5" />
                  Start a terminal
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex min-h-9 items-center rounded-md px-3 text-xs text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Close
                </button>
              </div>
              {error && (
                <p role="alert" className="text-xs text-red-400">
                  {error}
                </p>
              )}
            </div>
          )}
          <div
            role="presentation"
            title="Resize"
            onPointerDown={start('resize')}
            className="absolute -bottom-1 -right-1 z-10 size-4 cursor-nwse-resize touch-none"
          />
        </section>
      )}
    </div>
  );
}
