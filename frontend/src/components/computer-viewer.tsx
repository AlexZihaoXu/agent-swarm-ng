import { useEffect, useRef, useState, type MouseEvent, type KeyboardEvent, type PointerEvent } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { desktopStreamFit } from '@/lib/computer-fit';
import type { Computer } from './computer-card';
import { ComputerControl, type ComputerAgentState } from './computer-control';
import { TerminalWorkspace } from './computer-terminals';
import { ComputerSwitcher } from './computer-switcher';
import { FloatingTerminal } from './floating-terminal';
import { FloatingChat } from './floating-chat';
import type { ChatAgent } from '@/use-chat';
import {
  ChevronDownIcon,
  ComputerIcon,
  KeyboardIcon,
  LockIcon,
  SoundOffIcon,
  SoundOnIcon,
  TerminalIcon,
  UnlockIcon,
} from '@/components/ui/icons';
import { AnimatePresence, m } from 'motion/react';
import { glide } from '@/lib/motion';
import { computerPath, computerTerminalPath } from '@/lib/dashboard-location';

/** Only GNOME/X11 computers bypass portal consent; Wayland ones keep their normal gate. The controller reports which each is;
 * the build-time flag is only the fallback for a controller that does not say. */
const portalFreeFor = (computer: Computer) =>
  computer.portalFree ?? import.meta.env.VITE_COMPUTER_PORTAL_FREE === 'true';

function initialSetup(id: string, portalFree: boolean) {
  if (portalFree) return false;
  try {
    return localStorage.getItem(`computer-consent:${id}`) !== 'yes';
  } catch {
    return true;
  }
}

/** iPhone/iPad Safari (iPadOS reports a Mac with touch points). */
const isAppleTouch = () =>
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export function ComputerViewer({
  computer,
  canManage,
  onBack,
  agentState,
  onOpenComputer,
  view = 'desktop',
  terminalId = null,
  onRoute,
}: {
  computer: Computer;
  canManage: boolean;
  onBack: () => void;
  agentState?: ComputerAgentState;
  /** Switch the viewer to another computer (from the All computers drawer). */
  onOpenComputer?: (id: string) => void;
  /** Desktop or Terminal, from the URL (`/computers/:id` or `/computers/:id/terminal[/:session]`). */
  view?: 'desktop' | 'terminal';
  terminalId?: string | null;
  /** Replace the address when the mode or terminal session changes, so a refresh returns here. */
  onRoute?: (path: string) => void;
}) {
  const id = computer.id;
  const running = computer.state === 'running' && canManage;
  const portalFree = portalFreeFor(computer);
  const [setupOpen, setSetupOpen] = useState(() => initialSetup(id, portalFree));
  // Desktop and Terminal share this page; the URL owns the mode. The stream stays connected while Terminal is shown,
  // so switching back is instant.
  const setView = (next: 'desktop' | 'terminal') =>
    onRoute?.(next === 'terminal' ? computerTerminalPath(id, terminalId) : computerPath(id));
  // Leaving the desktop (by button, refresh or Back) always locks human desktop input.
  useEffect(() => {
    if (view === 'terminal') setInputEnabled(false);
  }, [view]);
  const [inputEnabled, setInputEnabled] = useState(false);
  // The floating chat with the agent on this computer, opened from the header.
  const [chatAgent, setChatAgent] = useState<ChatAgent | null>(null);
  // Where the chat was opened from in the header: the window grows out of it and shrinks back into it.
  const [chatFrom, setChatFrom] = useState<DOMRect | null>(null);
  useEffect(() => setChatAgent(null), [id]);
  const [frame, setFrame] = useState(Date.now());
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [clickBusy, setClickBusy] = useState(false);
  const [clickError, setClickError] = useState('');
  const [available, setAvailable] = useState<'checking' | 'online' | 'offline'>('checking');
  const [viewerKey, setViewerKey] = useState(0);
  const [cursor, setCursor] = useState({ x: 0.5, y: 0.5 });
  const [keyboardTargetVisible, setKeyboardTargetVisible] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(0);
  const [stream, setStream] = useState({ width: 0, height: 0, rotated: false });
  // The frame keeps the size it connected at: Selkies fixes its video and input overlay to the window size when the
  // stream starts and never follows later changes. Resizing the viewer scales the frame instead, which the browser
  // maps input through, so the picture always fits and clicks land where they should.
  // iOS Safari shows the stream black inside a transformed frame, so there it is never scaled or turned: the frame
  // takes the fitted size directly and reconnects when that size changes.
  const untransformed = useRef(isAppleTouch()).current;
  const connectedAt = useRef<{ key: string; width: number; height: number } | null>(null);
  const frameKey = `${id}:${viewerKey}:${stream.rotated}`;
  if (stream.width && connectedAt.current?.key !== frameKey)
    connectedAt.current = { key: frameKey, width: stream.width, height: stream.height };
  const frameSize = untransformed ? stream : connectedAt.current?.key === frameKey ? connectedAt.current : null;
  const frameScale = frameSize?.width ? stream.width / frameSize.width : 1;
  const transformed = Boolean(frameSize && (frameScale !== 1 || stream.rotated));
  useEffect(() => {
    const connected = connectedAt.current;
    if (!untransformed || !connected || connected.key !== frameKey) return;
    if (Math.abs(connected.width - stream.width) < 2 && Math.abs(connected.height - stream.height) < 2) return;
    // Selkies keeps the size it connected at, so reconnect once the new size settles.
    const timer = window.setTimeout(() => setViewerKey(key => key + 1), 500);
    return () => window.clearTimeout(timer);
  }, [untransformed, frameKey, stream.width, stream.height]);
  const imageRef = useRef<HTMLImageElement>(null);
  const previewPointerStart = useRef<{ x: number; y: number } | null>(null);
  const previewDragged = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const url = `/computers/${encodeURIComponent(id)}/desktop/`;
  const inputToggleRef = useRef<HTMLButtonElement>(null);
  // Desktop sound starts off every time (the guest captures nothing until asked). Browsers decode the stream's
  // audio only on secure (HTTPS) pages, so on a plain-HTTP dashboard the toggle explains instead of failing silently.
  const [soundOn, setSoundOn] = useState(false);
  const soundAvailable = typeof window !== 'undefined' && window.isSecureContext;
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'swarm:desktop-audio', enabled: soundOn },
      window.location.origin,
    );
  }, [soundOn]);
  useEffect(() => {
    if (view === 'terminal') setSoundOn(false);
  }, [view]);
  // An upright phone shows the desktop turned a quarter turn: a view only, since touches would land rotated.
  useEffect(() => {
    setInputEnabled(false);
  }, [id, viewerKey, stream.rotated]);
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'swarm:desktop-input', enabled: inputEnabled },
      window.location.origin,
    );
    if (!inputEnabled) iframeRef.current?.blur();
  }, [inputEnabled, id]);

  useEffect(() => {
    if (!running || !setupOpen) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') setFrame(Date.now());
    };
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, [running, setupOpen, id]);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!setupOpen || !scroller) return;
    const resize = () =>
      setFitWidth(Math.max(1, Math.min(scroller.clientWidth, ((scroller.clientHeight - 24) * 16) / 9)));
    const observer = new ResizeObserver(resize);
    observer.observe(scroller);
    resize();
    return () => observer.disconnect();
  }, [setupOpen]);
  useEffect(() => {
    const scroller = streamRef.current;
    if (!running || !scroller) return;
    // Contain the fixed 1920x1080 desktop in the available box so resizing the
    // browser window re-fits instantly instead of stretching or cropping the picture.
    const resize = () =>
      setStream(
        desktopStreamFit(
          scroller.clientWidth,
          scroller.clientHeight,
          window.matchMedia('(max-width: 767px)').matches && !isAppleTouch(),
        ),
      );
    const observer = new ResizeObserver(resize);
    observer.observe(scroller);
    resize();
    return () => observer.disconnect();
  }, [running]);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!setupOpen || !scroller) return;
    const frame = requestAnimationFrame(() => {
      scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
      scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) / 2;
    });
    return () => cancelAnimationFrame(frame);
  }, [zoom, fitWidth, setupOpen]);
  useEffect(() => {
    if (!running) return;
    let active = true;
    const check = async () => {
      try {
        const response = await fetch(`${url}api/health`, { cache: 'no-store' });
        if (active) setAvailable(response.ok ? 'online' : 'offline');
      } catch {
        if (active) setAvailable('offline');
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [running, url, viewerKey]);

  const click = async (x: number, y: number) => {
    if (!inputEnabled || clickBusy || !running || !previewLoaded || available === 'offline') return;
    setClickBusy(true);
    setClickError('');
    try {
      const result = await api.POST('/api/computers/{id}/desktop/input', { params: { path: { id } }, body: { x, y } });
      if (!result.data || result.error)
        throw new Error(result.error?.message ?? 'Could not click the computer desktop.');
      setFrame(Date.now());
    } catch (error) {
      setClickError(error instanceof Error ? error.message : 'Could not click the computer desktop.');
    } finally {
      setClickBusy(false);
    }
  };
  const movePreviewPointer = (event: PointerEvent<HTMLButtonElement>) => {
    const start = previewPointerStart.current;
    if (start && (event.clientX - start.x) ** 2 + (event.clientY - start.y) ** 2 > 64) previewDragged.current = true;
  };
  const clickPreview = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0) {
      void click(cursor.x, cursor.y);
      return;
    }
    if (previewDragged.current) {
      previewDragged.current = false;
      return;
    }
    const image = imageRef.current;
    if (!image || !image.naturalWidth || !image.naturalHeight) return;
    const box = image.getBoundingClientRect();
    const imageRatio = image.naturalWidth / image.naturalHeight;
    const width = Math.min(box.width, box.height * imageRatio);
    const height = Math.min(box.height, box.width / imageRatio);
    const x = (event.clientX - box.left - (box.width - width) / 2) / width;
    const y = (event.clientY - box.top - (box.height - height) / 2) / height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    setCursor({ x, y });
    void click(x, y);
  };
  const moveCursor = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const delta = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[event.key];
    if (!delta) return;
    event.preventDefault();
    setKeyboardTargetVisible(true);
    setCursor(previous => ({
      x: Math.max(0, Math.min(1, previous.x + delta[0])),
      y: Math.max(0, Math.min(1, previous.y + delta[1])),
    }));
  };
  const finishSetup = () => {
    try {
      localStorage.setItem(`computer-consent:${id}`, 'yes');
    } catch {
      /* Private browsing still works. */
    }
    setSetupOpen(false);
  };
  const sendShortcut = (name: string) => {
    if (!inputEnabled || !running || setupOpen || available === 'offline') return;
    iframeRef.current?.contentWindow?.postMessage({ type: 'swarm:desktop-shortcut', name }, window.location.origin);
  };

  return (
    <section
      data-testid="computer-viewer"
      aria-label={`${computer.name} desktop`}
      className="computer-viewer-enter flex min-h-0 w-full flex-1 flex-col"
    >
      <header className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-6">
        {/* Kibo Breadcrumb with Slash Separator, adapted to a real back action.
          The breadcrumb claims a full row on phones so the action buttons wrap
          below it instead of painting over the back control. */}
        {/* Location and the Desktop/Terminal switch read together on the left; controls stay on the right. */}
        <div className="flex min-w-0 basis-full items-center gap-3 md:flex-1 md:basis-auto">
          <nav aria-label="Computer location" className="min-w-0">
            <ol className="flex min-w-0 items-center gap-2 text-sm">
              <li>
                <button
                  type="button"
                  aria-label="Back to computers"
                  onClick={onBack}
                  className="min-h-11 cursor-pointer rounded-md text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
                >
                  Computers
                </button>
              </li>
              <li aria-hidden="true" className="text-muted-foreground">
                /
              </li>
              <li aria-current="page" className="min-w-0 truncate font-semibold" title={computer.name}>
                {computer.name}
              </li>
            </ol>
          </nav>
          {running && (
            <div
              role="tablist"
              aria-label="Computer view"
              className="flex shrink-0 items-center rounded-lg bg-muted p-1"
            >
              {(['desktop', 'terminal'] as const).map(value => {
                const on = view === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => {
                      if (value === 'terminal') setInputEnabled(false);
                      setView(value);
                    }}
                    className={`relative isolate flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring md:min-h-7 ${on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {on && (
                      <m.span
                        aria-hidden="true"
                        layoutId={`viewer-view-${id}`}
                        transition={glide}
                        className="absolute inset-0 -z-10 rounded-md bg-background shadow-sm"
                      />
                    )}
                    {value === 'desktop' ? (
                      <ComputerIcon className="size-3.5" />
                    ) : (
                      <TerminalIcon className="size-3.5" />
                    )}
                    <span className="max-sm:sr-only">{value === 'desktop' ? 'Desktop' : 'Terminal'}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <ComputerControl
          key={id}
          computerId={id}
          agentState={agentState}
          onOpenChat={
            agentState?.chat && view === 'desktop'
              ? (agent, from) => {
                  setChatFrom(from);
                  setChatAgent(agent);
                }
              : undefined
          }
        />
        {running && view === 'desktop' && (
          <Button
            ref={inputToggleRef}
            type="button"
            variant={inputEnabled ? 'default' : 'outline'}
            size="sm"
            aria-pressed={inputEnabled}
            aria-label={`${inputEnabled ? 'Input live' : 'Input locked'}, human desktop input`}
            disabled={stream.rotated}
            title={
              stream.rotated
                ? 'Turn your phone sideways to control the desktop'
                : inputEnabled
                  ? 'Input live: lock the desktop'
                  : 'Input locked: control the desktop'
            }
            onClick={() => setInputEnabled(enabled => !enabled)}
            className="size-11 shrink-0 p-0 md:size-8"
          >
            {inputEnabled ? <UnlockIcon /> : <LockIcon />}
          </Button>
        )}
        {running && view === 'desktop' && (
          <Button
            type="button"
            variant={soundOn ? 'default' : 'outline'}
            size="sm"
            aria-pressed={soundOn}
            aria-disabled={!soundAvailable}
            aria-label={soundOn ? 'Sound on' : 'Sound off'}
            title={
              soundAvailable
                ? soundOn
                  ? 'Mute desktop sound'
                  : 'Play desktop sound'
                : 'Desktop sound needs a secure (HTTPS) dashboard address'
            }
            onClick={() => soundAvailable && setSoundOn(on => !on)}
            className={`size-11 shrink-0 p-0 md:size-8 ${soundAvailable ? '' : 'opacity-50'}`}
          >
            {soundOn ? <SoundOnIcon /> : <SoundOffIcon />}
          </Button>
        )}
        {running && view === 'desktop' && !setupOpen && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Remote shortcuts"
                title="Send keys"
                disabled={!inputEnabled || available === 'offline'}
                className="ml-auto h-11 shrink-0 gap-1 px-2.5 md:h-8"
              >
                <KeyboardIcon />
                <ChevronDownIcon className="size-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={5}
                collisionPadding={12}
                aria-label="Remote shortcuts"
                className="z-50 w-56 rounded-lg border border-border bg-background p-1 text-sm shadow-lg motion-safe:data-[state=open]:animate-[dialog-in_160ms_ease-out] motion-safe:data-[state=closed]:animate-[dialog-out_120ms_ease-in]"
              >
                {(
                  [
                    ['new-tab', 'New tab', 'Ctrl+T', '+'],
                    ['close-tab', 'Close tab', 'Ctrl+W', '×'],
                    ['address-bar', 'Address bar', 'Ctrl+L', '⌕'],
                    ['reload', 'Reload', 'Ctrl+R', '↻'],
                    ['new-window', 'New window', 'Ctrl+N', '▣'],
                  ] as const
                ).map(([name, label, keys, symbol]) => (
                  <DropdownMenu.Item
                    key={name}
                    onSelect={() => sendShortcut(name)}
                    className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 outline-none focus:bg-muted focus:text-foreground data-[disabled]:opacity-50"
                  >
                    <span aria-hidden="true" className="w-4 text-center text-muted-foreground">
                      {symbol}
                    </span>
                    <span className="flex-1">{label}</span>
                    <kbd className="text-xs text-muted-foreground">{keys}</kbd>
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
        {running && view === 'desktop' && !portalFree && !setupOpen && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-10 shrink-0"
            onClick={() => {
              setSetupOpen(true);
              setClickError('');
            }}
          >
            Grant screen access
          </Button>
        )}
      </header>
      {view === 'terminal' && running && (
        <div className="view-enter relative flex min-h-0 flex-1 flex-col pb-9">
          <TerminalWorkspace
            computer={computer}
            connected={canManage}
            active
            initialSession={terminalId}
            onSessionChange={session => {
              if (session !== terminalId) onRoute?.(computerTerminalPath(id, session));
            }}
          />
          {onOpenComputer && <ComputerSwitcher currentId={id} onOpen={onOpenComputer} />}
        </div>
      )}
      <div
        className={`relative min-h-0 flex-1 flex-col bg-black pb-[env(safe-area-inset-bottom)] md:pb-0 ${view === 'terminal' && running ? 'hidden' : 'flex'}`}
      >
        {!running ? (
          <p role="status" className="m-auto px-5 text-center text-sm text-muted-foreground">
            Desktop unavailable. Its saved files remain until confirmed deletion.
          </p>
        ) : (
          <>
            <div
              ref={streamRef}
              data-slot="desktop-stream"
              className="relative flex min-h-0 flex-1 overflow-hidden bg-black"
            >
              <iframe
                ref={iframeRef}
                key={`${id}:${viewerKey}`}
                inert={!inputEnabled}
                tabIndex={inputEnabled ? 0 : -1}
                onLoad={() => {
                  setInputEnabled(false);
                  setSoundOn(false);
                  iframeRef.current?.contentWindow?.postMessage(
                    { type: 'swarm:desktop-input', enabled: false },
                    window.location.origin,
                  );
                }}
                title={`${computer.name} desktop`}
                src={`${url}?viewer=streamed-cursor-v2`}
                referrerPolicy="no-referrer"
                sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-downloads"
                allow="fullscreen"
                style={{
                  width: frameSize ? `${frameSize.width}px` : '100%',
                  height: frameSize ? `${frameSize.height}px` : '100%',
                  // Transformed only to scale or turn it (centered by the transform then); otherwise centered by its insets.
                  transform: transformed
                    ? `translate(-50%, -50%) scale(${frameScale})${stream.rotated ? ' rotate(90deg)' : ''}`
                    : undefined,
                }}
                data-rotated={stream.rotated ? '' : undefined}
                className={`absolute min-h-0 shrink-0 border-0 bg-black ${transformed ? 'left-1/2 top-1/2' : 'inset-0 m-auto'} ${inputEnabled ? '' : 'pointer-events-none'}`}
              />
              {!inputEnabled && !setupOpen && (
                <div
                  aria-label="Desktop input locked"
                  className="absolute inset-0 z-[1]"
                  onPointerDown={event => {
                    event.preventDefault();
                    inputToggleRef.current?.focus();
                  }}
                  onWheel={event => event.stopPropagation()}
                />
              )}
            </div>
            {available === 'offline' && !setupOpen && (
              <div
                role="alert"
                className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/95 p-5 text-center text-sm"
              >
                <p>Desktop stream unavailable. Your computer and files have not been deleted.</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setAvailable('checking');
                    setViewerKey(key => key + 1);
                  }}
                >
                  Retry connection
                </Button>
              </div>
            )}
            {setupOpen && (
              <div className="absolute inset-x-0 top-0 bottom-[env(safe-area-inset-bottom)] z-10 flex min-h-0 flex-col bg-background p-3 md:bottom-0 md:p-5">
                <h3 className="shrink-0 text-base font-semibold">Grant screen access</h3>
                <p className="mt-1 shrink-0 text-xs leading-relaxed text-muted-foreground">
                  <strong>Permission preview: clicks only.</strong> Wait for Ubuntu’s dialog, turn on “Allow Remote
                  Interaction”, then click “Share”. Arrow keys move the marker; Enter clicks it. To drag windows or
                  type, choose <strong>Show live desktop</strong> after granting access.
                </p>
                <div className="mt-2 flex shrink-0 items-center justify-end gap-2 text-xs text-muted-foreground">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label="Zoom out desktop preview"
                    disabled={zoom <= 1}
                    onClick={() => setZoom(value => Math.max(1, value - 1))}
                    className="min-h-11 px-3 md:min-h-0"
                  >
                    −
                  </Button>
                  <span role="status" aria-label={`Preview zoom ${zoom} times`} className="min-w-7 text-center">
                    {zoom}×
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label="Zoom in desktop preview"
                    disabled={zoom >= 4}
                    onClick={() => setZoom(value => Math.min(4, value + 1))}
                    className="min-h-11 px-3 md:min-h-0"
                  >
                    +
                  </Button>
                </div>
                <div
                  ref={scrollRef}
                  className={`min-h-0 flex-1 overflow-auto py-3 ${zoom === 1 ? 'flex items-center justify-center' : ''}`}
                >
                  <button
                    type="button"
                    aria-label={`Click the permission dialog for ${computer.name}`}
                    data-testid="computer-consent-preview"
                    disabled={!inputEnabled || !previewLoaded || clickBusy || available === 'offline'}
                    onClick={clickPreview}
                    onKeyDown={moveCursor}
                    onPointerDown={event => {
                      previewPointerStart.current = { x: event.clientX, y: event.clientY };
                      previewDragged.current = false;
                      setKeyboardTargetVisible(false);
                    }}
                    onPointerMove={movePreviewPointer}
                    onPointerUp={() => {
                      previewPointerStart.current = null;
                    }}
                    onPointerCancel={() => {
                      previewPointerStart.current = null;
                      previewDragged.current = true;
                    }}
                    style={{ width: fitWidth ? `${fitWidth * zoom}px` : '100%' }}
                    className="relative block aspect-video shrink-0 overflow-hidden rounded-lg border border-border bg-black enabled:cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <img
                      ref={imageRef}
                      src={`/api/computers/${encodeURIComponent(id)}/preview?full=1&at=${frame}`}
                      alt={`Permission preview of ${computer.name}`}
                      draggable={false}
                      onDragStart={event => event.preventDefault()}
                      onLoad={() => {
                        setPreviewLoaded(true);
                        setPreviewFailed(false);
                      }}
                      onError={() => {
                        setPreviewLoaded(false);
                        setPreviewFailed(true);
                      }}
                      className="h-full w-full select-none object-contain"
                    />
                    {previewLoaded && keyboardTargetVisible && (
                      <span
                        aria-hidden="true"
                        data-testid="computer-keyboard-target"
                        className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/40 shadow-[0_0_2px_2px_black]"
                        style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}
                      />
                    )}
                    {!previewLoaded && (
                      <span
                        role="status"
                        className="absolute inset-0 flex items-center justify-center text-sm text-white"
                      >
                        {previewFailed ? 'Preview unavailable' : 'Loading screen…'}
                      </span>
                    )}
                  </button>
                </div>
                {clickError && (
                  <p role="alert" className="shrink-0 text-xs text-red-400">
                    {clickError}
                  </p>
                )}
                <div className="flex shrink-0 items-center justify-between gap-3">
                  <span role="status" className="text-xs text-muted-foreground">
                    {available === 'offline'
                      ? 'Stream offline'
                      : clickBusy
                        ? 'Clicking…'
                        : 'Control is shared with other dashboard visitors.'}
                  </span>
                  <Button type="button" size="sm" className="min-h-11 shrink-0 md:min-h-0" onClick={finishSetup}>
                    Show live desktop
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
        {running && !setupOpen && (
          <FloatingTerminal computer={computer} onExpand={session => onRoute?.(computerTerminalPath(id, session))} />
        )}
        <AnimatePresence>
          {running && !setupOpen && view === 'desktop' && chatAgent && agentState?.chat && (
            <FloatingChat
              key={chatAgent.id}
              agent={agentState.agents.find(item => item.id === chatAgent.id) ?? chatAgent}
              state={{ ...agentState, chat: agentState.chat }}
              from={chatFrom}
              onMinimize={() => setChatAgent(null)}
            />
          )}
        </AnimatePresence>
        {onOpenComputer && <ComputerSwitcher currentId={id} onOpen={onOpenComputer} />}
      </div>
    </section>
  );
}
