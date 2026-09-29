import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Button } from '@/components/ui/button';
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const ctrl = (letter: string) => String.fromCharCode(letter.charCodeAt(0) & 0x1f);

/**
 * Keys a browser or phone keyboard cannot send (or keeps for itself, like Ctrl+W), as the bytes a real
 * terminal would produce. They travel over the same live stream as typing, so they act instantly.
 */
const keyBar: { label: string; name: string; reserved?: true; bytes: (appCursor: boolean) => string }[] = [
  { label: 'Esc', name: 'Escape', bytes: () => '\x1b' },
  { label: 'Tab', name: 'Tab', bytes: () => '\t' },
  { label: '⌃C', name: 'Control C (interrupt)', bytes: () => ctrl('c') },
  { label: '⌃D', name: 'Control D', bytes: () => ctrl('d') },
  { label: '⌃Z', name: 'Control Z', bytes: () => ctrl('z') },
  { label: '⌃L', name: 'Control L', bytes: () => ctrl('l') },
  { label: '⌃R', name: 'Control R', bytes: () => ctrl('r') },
  // Chrome, Edge and Firefox keep these for tabs/windows; a page can never receive them from the keyboard.
  { label: '⌃W', name: 'Control W', reserved: true, bytes: () => ctrl('w') },
  { label: '⌃T', name: 'Control T', reserved: true, bytes: () => ctrl('t') },
  { label: '⌃N', name: 'Control N', reserved: true, bytes: () => ctrl('n') },
  { label: '↑', name: 'Up arrow', bytes: app => (app ? '\x1bOA' : '\x1b[A') },
  { label: '↓', name: 'Down arrow', bytes: app => (app ? '\x1bOB' : '\x1b[B') },
  { label: '←', name: 'Left arrow', bytes: app => (app ? '\x1bOD' : '\x1b[D') },
  { label: '→', name: 'Right arrow', bytes: app => (app ? '\x1bOC' : '\x1b[C') },
  { label: 'PgUp', name: 'Page Up', bytes: () => '\x1b[5~' },
  { label: 'PgDn', name: 'Page Down', bytes: () => '\x1b[6~' },
];

/** A touch screen means an on-screen keyboard without Esc, Tab, Ctrl or arrows; a physical keyboard has them all. */
function useTouchKeyboard() {
  const query = '(any-pointer: coarse)';
  const [touch, setTouch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const change = () => setTouch(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return touch;
}

/** Fixed geometry. No fit/resize, links, clipboard, image or attach addons. */
export function TerminalEmulator({
  computerId,
  sessionId,
  interactive,
  title,
  columns = 120,
  rows = 36,
  fill = false,
  titleContent,
  onTitlePointerDown,
  onMeasure,
  titleLeading,
  inactive = false,
  onClosed,
}: {
  computerId: string;
  sessionId: string;
  interactive: boolean;
  /** The session's own grid (default 120 × 36); the operator can resize a session, viewers never do. */
  columns?: number;
  rows?: number;
  /** Fill the parent instead of sizing the window to the grid (a floating window supplies its own size). */
  fill?: boolean;
  /** Replaces the title text (e.g. a session picker and window buttons in a floating window). */
  titleContent?: ReactNode;
  /** Lets a floating window be dragged by its title bar. */
  onTitlePointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  /** Reports the grid's natural size and the window chrome around it, so a floating window can match its shape. */
  /** Replaces the decorative window dots (a floating window puts its own control there). */
  titleLeading?: ReactNode;
  /** A floating window that is not the focused one: a quieter edge, shadow and title. */
  inactive?: boolean;
  /** The stream closed on its own (the session may have been resized elsewhere): time to re-read the session. */
  onClosed?: () => void;
  onMeasure?: (size: { width: number; height: number; chromeWidth: number; chromeHeight: number }) => void;
  /** Shown in the window's title bar, like a desktop terminal app. */
  title: string;
}) {
  const host = useRef<HTMLDivElement>(null),
    terminal = useRef<Terminal | null>(null),
    connected = useRef(false);
  const [attempt, setAttempt] = useState(0),
    [visible, setVisible] = useState(() => !document.hidden);
  const [status, setStatus] = useState('Connecting…');
  // Sends bytes over the live stream (set while connected); the key bar and the Ctrl latch use it.
  const send = useRef<((value: string) => void) | null>(null);
  const [ctrlLatched, setCtrlLatched] = useState(false);
  const touch = useTouchKeyboard();
  const latched = useRef(false);
  latched.current = ctrlLatched;
  // The grid keeps the session's size; it is scaled to fill the space like the desktop viewer, never resized.
  const measured = useRef(onMeasure);
  measured.current = onMeasure;
  const frame = useRef<HTMLDivElement>(null),
    stage = useRef<HTMLDivElement>(null),
    titleBar = useRef<HTMLDivElement>(null),
    keysBar = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, width: 0, height: 0, pan: false });
  const inputAllowed = useRef(interactive);
  const closed = useRef(onClosed);
  closed.current = onClosed;
  inputAllowed.current = interactive;
  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  useEffect(() => {
    if (terminal.current) terminal.current.options.disableStdin = !(interactive && connected.current);
  }, [interactive]);
  useEffect(() => {
    if (!host.current || !visible) {
      setStatus('Paused while hidden.');
      return;
    }
    const term = new Terminal({
      cols: columns,
      rows,
      fontSize: 13,
      lineHeight: 1.15,
      fontFamily: 'Consolas, "Liberation Mono", monospace',
      cursorBlink: true,
      scrollback: 2000,
      disableStdin: true,
      screenReaderMode: true,
      windowOptions: {},
      linkHandler: { activate: () => {} },
      theme: { background: '#141414', foreground: '#ededed', cursor: '#ededed' },
    });
    terminal.current = term;
    term.open(host.current);
    // Remote OSC52 must never read/write the browser clipboard, and no terminal title drives UI.
    const clipboard = term.parser.registerOscHandler(52, () => true);
    term.attachCustomKeyEventHandler(event => {
      event.stopPropagation();
      return true;
    });
    // Mouse is local focus/scroll only. Even a guest enabling mouse reporting or alternate-scroll
    // cannot turn clicks/wheel/touches into guest input. onBinary (legacy mouse) is never attached.
    const stopMouse = (event: Event) => {
      // The grid is not itself focusable, so the browser's default mousedown would blur the terminal right after
      // we focus it. Keep the default from running, then focus.
      if (event.type === 'mousedown' && (event as MouseEvent).button === 0) {
        event.preventDefault();
        term.focus();
      }
      event.stopPropagation();
    };
    const mouseEvents = [
      'mousedown',
      'mouseup',
      'mousemove',
      'wheel',
      'pointerdown',
      'pointerup',
      'pointermove',
      'touchstart',
      'touchmove',
      'touchend',
    ];
    const element = host.current;
    for (const name of mouseEvents) element.addEventListener(name, stopMouse, { capture: true });
    const url = new URL(
      `/api/computers/${encodeURIComponent(computerId)}/terminals/${encodeURIComponent(sessionId)}/stream`,
      location.href,
    );
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    let ready = false,
      disposed = false,
      pending = 0,
      queue: Uint8Array[] = [],
      renderBytes = 0;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => socket.close(), 12000);
    const end = () => {
      if (disposed) return;
      ready = false;
      connected.current = false;
      queue = [];
      pending = 0;
      clearTimeout(flushTimer);
      clearTimeout(timeout);
      term.options.disableStdin = true;
      setStatus('Disconnected. Input may have been applied; inspect before repeating it.');
      socket.close();
      closed.current?.();
    };
    const flush = () => {
      flushTimer = undefined;
      if (!ready || disposed) return;
      try {
        const batch = new Uint8Array(pending);
        let offset = 0;
        for (const bytes of queue) {
          batch.set(bytes, offset);
          offset += bytes.length;
        }
        for (let i = 0; i < batch.length; i += 4096) {
          if (socket.bufferedAmount > 65536) throw Error();
          socket.send(JSON.stringify({ type: 'input', data: encode(batch.subarray(i, i + 4096)) }));
        }
        queue = [];
        pending = 0;
      } catch {
        end();
      }
    };
    const queueInput = (value: string) => {
      if (!ready || disposed) return;
      // Focus reports are not keyboard input. Defence in depth for mouse protocols as well.
      if (/^\x1b\[(?:I|O)$/.test(value) || /^\x1b\[(?:<\d+;\d+;\d+[Mm]|M[\s\S]{3}|\d+;\d+;\d+M)$/.test(value)) return;
      const bytes = new TextEncoder().encode(value);
      pending += bytes.length;
      if (pending > 65536) {
        end();
        return;
      }
      for (let i = 0; i < bytes.length; i += 4096) queue.push(bytes.slice(i, i + 4096));
      if (flushTimer === undefined) flushTimer = setTimeout(flush, 10);
    };
    const data = term.onData(value => {
      // A latched on-screen Ctrl turns the next typed letter into its control character (phone keyboards).
      if (latched.current && /^[a-z]$/i.test(value)) {
        value = ctrl(value.toLowerCase());
        setCtrlLatched(false);
      }
      queueInput(value);
    });
    send.current = value => {
      if (!term.options.disableStdin) queueInput(value);
    };
    const heartbeat = setInterval(() => {
      if (ready && socket.readyState === WebSocket.OPEN) socket.send('{"type":"ping"}');
    }, 5000);
    socket.onmessage = event => {
      if (disposed) return;
      try {
        if (typeof event.data !== 'string' || event.data.length > 16384) throw Error();
        const frame = JSON.parse(event.data);
        if (frame.type === 'ready' && frame.columns === columns && frame.rows === rows) {
          ready = true;
          connected.current = true;
          clearTimeout(timeout);
          term.options.disableStdin = !inputAllowed.current;
          setStatus(`Connected · ${columns} × ${rows} · Keyboard only`);
          term.focus();
          return;
        }
        if (frame.type !== 'output' || !ready || typeof frame.data !== 'string' || frame.data.length > 12000)
          throw Error();
        const bytes = Uint8Array.from(atob(frame.data), c => c.charCodeAt(0));
        renderBytes += bytes.length;
        if (renderBytes > 262144) throw Error();
        term.write(bytes, () => {
          renderBytes -= bytes.length;
        });
      } catch {
        end();
      }
    };
    socket.onerror = end;
    socket.onclose = end;
    setStatus('Connecting…');
    return () => {
      disposed = true;
      ready = false;
      connected.current = false;
      queue = [];
      clearTimeout(timeout);
      clearTimeout(flushTimer);
      clearInterval(heartbeat);
      socket.close();
      data.dispose();
      send.current = null;
      clipboard.dispose();
      for (const name of mouseEvents) element.removeEventListener(name, stopMouse, true);
      term.dispose();
      terminal.current = null;
    };
  }, [computerId, sessionId, attempt, visible, columns, rows]);
  useEffect(() => {
    const area = stage.current,
      inner = host.current;
    if (!area || !inner) return;
    const measure = () => {
      const width = inner.offsetWidth,
        height = inner.offsetHeight;
      if (!width || !height) return;
      const style = getComputedStyle(area);
      // Room for the grid: the stage minus its padding, the window border, title bar, key bar and the grid's inset.
      const roomWidth = area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2 - 16;
      const roomHeight =
        area.clientHeight -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom) -
        2 -
        16 -
        (titleBar.current?.offsetHeight ?? 0) -
        (keysBar.current?.offsetHeight ?? 0);
      const fitWidth = roomWidth / width,
        fitHeight = roomHeight / height;
      // Fill the space, but not beyond 1.35× so a wide screen does not turn the text into a poster. When fitting
      // the width would make text unreadable (phones), fit the rows instead and pan sideways inside the window.
      const pan = fitWidth < (fill ? 0.45 : 0.6);
      // A floating window is sized to the grid's shape, so it may scale further than a docked console.
      const scale = pan ? Math.min(1, Math.max(0.6, fitHeight)) : Math.min(fill ? 2.5 : 1.35, fitWidth, fitHeight);
      setFit({ scale, width, height, pan });
      measured.current?.({
        width,
        height,
        chromeWidth: 2 + 16,
        chromeHeight: 2 + 16 + (titleBar.current?.offsetHeight ?? 0) + (keysBar.current?.offsetHeight ?? 0),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [area, inner, titleBar.current, keysBar.current]) if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [attempt, visible, fill, columns, rows]);
  const connectedNow = status.startsWith('Connected');
  const press = (value: string) => {
    send.current?.(value);
    terminal.current?.focus();
  };
  const focusTerminal = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    terminal.current?.focus();
  };
  const gridWidth = fit.width * fit.scale + 16,
    gridHeight = fit.height * fit.scale + 16;
  return (
    // The console is a centered app window: a clear edge, a title bar with the session and its state, the grid,
    // and the key bar along the bottom. Clicking anywhere on it focuses the terminal.
    <div
      ref={stage}
      data-terminal-emulator
      // Filling a floating window, nothing may clip the window's own shadow and rounded corners.
      className={`flex min-h-0 min-w-0 flex-1 ${fill ? '' : 'items-center justify-center overflow-hidden p-2 sm:p-4'}`}
    >
      <div
        className={`flex max-h-full min-h-0 max-w-full flex-col overflow-hidden rounded-xl border bg-[#141414] transition-[border-color,box-shadow] duration-200 ${inactive ? 'border-white/[0.08] shadow-lg shadow-black/40' : 'border-white/15 shadow-2xl shadow-black/60'}`}
        style={fill || fit.pan ? { width: '100%', height: '100%' } : undefined}
      >
        <div
          ref={titleBar}
          onMouseDown={titleContent ? undefined : focusTerminal}
          onPointerDown={onTitlePointerDown}
          className={`flex h-8 shrink-0 items-center gap-3 border-b border-white/10 bg-[#1d1d1d] px-3 ${onTitlePointerDown ? 'cursor-grab touch-none select-none active:cursor-grabbing' : ''}`}
        >
          {titleLeading ?? (
            <span aria-hidden="true" className="flex shrink-0 gap-1.5">
              <span className="size-2.5 rounded-full bg-white/15" />
              <span className="size-2.5 rounded-full bg-white/15" />
              <span className="size-2.5 rounded-full bg-white/15" />
            </span>
          )}
          {titleContent ?? (
            <span
              className={`min-w-0 flex-1 truncate text-center font-mono text-[11px] transition-colors ${inactive ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}
            >
              {title}
            </span>
          )}
          <span role="status" className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${connectedNow ? 'bg-teal-400' : status.startsWith('Disconnected') ? 'bg-red-400' : 'bg-muted-foreground'}`}
            />
            <span className="sr-only md:not-sr-only">{status}</span>
          </span>
        </div>
        <div
          ref={frame}
          onMouseDown={focusTerminal}
          // A new session size (from any client or an agent) eases to its new box rather than jumping.
          className={`relative ${fit.pan ? 'min-h-0 flex-1 overflow-auto' : fill ? 'flex min-h-0 flex-1 items-center justify-center overflow-hidden' : 'shrink-0 overflow-hidden transition-[width,height] duration-300 ease-out motion-reduce:transition-none'}`}
          style={fit.width && !fit.pan && !fill ? { width: gridWidth, height: gridHeight } : undefined}
          aria-label="Interactive terminal"
          data-testid="terminal-viewport"
        >
          <div
            className="p-2"
            style={fit.width ? { width: gridWidth, height: gridHeight, boxSizing: 'border-box' } : undefined}
          >
            <div
              ref={host}
              className="w-max origin-top-left"
              style={{ transform: fit.scale === 1 ? undefined : `scale(${fit.scale})` }}
            />
          </div>
        </div>
        <div
          ref={keysBar}
          className="flex min-w-0 shrink-0 items-center gap-2 border-t border-white/10 bg-[#1a1a1a] px-2 py-1.5"
        >
          {/* Buttons keep focus in the terminal (no focus steal on press), so typing continues after a tap. */}
          <div
            role="toolbar"
            aria-label="Terminal keys"
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
          >
            {touch ? (
              <button
                type="button"
                aria-pressed={ctrlLatched}
                aria-label="Control (applies to the next letter)"
                title="Ctrl: applies to the next letter you type"
                disabled={!connectedNow}
                onPointerDown={event => event.preventDefault()}
                onClick={() => {
                  setCtrlLatched(value => !value);
                  terminal.current?.focus();
                }}
                className={keyClass(ctrlLatched)}
              >
                Ctrl
              </button>
            ) : (
              <span className="shrink-0 px-1 text-[11px] text-muted-foreground">Keys the browser keeps:</span>
            )}
            {keyBar
              .filter(key => touch || key.reserved)
              .map(key => (
                <button
                  key={key.name}
                  type="button"
                  aria-label={key.name}
                  title={key.name}
                  disabled={!connectedNow}
                  onPointerDown={event => event.preventDefault()}
                  onClick={() => press(key.bytes(Boolean(terminal.current?.modes.applicationCursorKeysMode)))}
                  className={keyClass(false)}
                >
                  {key.label}
                </button>
              ))}
          </div>
          {status.startsWith('Disconnected') && (
            <Button
              size="sm"
              variant="outline"
              className="min-h-9 shrink-0"
              onClick={() => setAttempt(value => value + 1)}
            >
              Reconnect
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

const keyClass = (on: boolean) =>
  `flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-md border px-2 font-mono text-xs outline-none transition-[background-color,border-color,transform] duration-100 focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:opacity-40 motion-reduce:active:scale-100 sm:min-h-7 ${
    on ? 'border-teal-400/60 bg-teal-400/15 text-teal-200' : 'border-border bg-background hover:bg-muted'
  }`;
