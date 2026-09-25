import { useEffect, useRef, useState, type MouseEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import type { Computer } from './computer-card';

function initialSetup(id: string) {
  try { return localStorage.getItem(`computer-consent:${id}`) !== 'yes'; }
  catch { return true; }
}

export function ComputerViewer({ computer, canManage, onBack }: { computer: Computer; canManage: boolean; onBack: () => void }) {
  const id = computer.id;
  const running = computer.state === 'running' && canManage;
  const [setupOpen, setSetupOpen] = useState(() => initialSetup(id));
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
  const [streamWidth, setStreamWidth] = useState(0);
  const [panOffset, setPanOffset] = useState(0);
  const imageRef = useRef<HTMLImageElement>(null);
  const previewPointerStart = useRef<{ x: number; y: number } | null>(null);
  const previewDragged = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const url = `/computers/${encodeURIComponent(id)}/desktop/`;

  useEffect(() => {
    if (!running || !setupOpen) return;
    const refresh = () => { if (document.visibilityState === 'visible') setFrame(Date.now()); };
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, [running, setupOpen, id]);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!setupOpen || !scroller) return;
    const resize = () => setFitWidth(Math.max(1, Math.min(scroller.clientWidth, (scroller.clientHeight - 24) * 16 / 9)));
    const observer = new ResizeObserver(resize);
    observer.observe(scroller);
    resize();
    return () => observer.disconnect();
  }, [setupOpen]);
  useEffect(() => {
    const scroller = streamRef.current;
    if (!running || !scroller) return;
    const resize = () => setStreamWidth(Math.max(scroller.clientWidth, Math.round(scroller.clientHeight * 16 / 9)));
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
      } catch { if (active) setAvailable('offline'); }
    };
    void check();
    const timer = window.setInterval(() => void check(), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [running, url, viewerKey]);

  const click = async (x: number, y: number) => {
    if (clickBusy || !running || !previewLoaded || available === 'offline') return;
    setClickBusy(true); setClickError('');
    try {
      const result = await api.POST('/api/computers/{id}/desktop/input', { params: { path: { id } }, body: { x, y } });
      if (!result.data || result.error) throw new Error(result.error?.message ?? 'Could not click the computer desktop.');
      setFrame(Date.now());
    } catch (error) { setClickError(error instanceof Error ? error.message : 'Could not click the computer desktop.'); }
    finally { setClickBusy(false); }
  };
  const movePreviewPointer = (event: PointerEvent<HTMLButtonElement>) => {
    const start = previewPointerStart.current;
    if (start && (event.clientX - start.x) ** 2 + (event.clientY - start.y) ** 2 > 64) previewDragged.current = true;
  };
  const clickPreview = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0) { void click(cursor.x, cursor.y); return; }
    if (previewDragged.current) { previewDragged.current = false; return; }
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
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
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
    try { localStorage.setItem(`computer-consent:${id}`, 'yes'); } catch { /* Private browsing still works. */ }
    setSetupOpen(false);
  };

  return <section data-testid="computer-viewer" aria-label={`${computer.name} desktop`} className="computer-viewer-enter flex min-h-0 w-full flex-1 flex-col">
    <header className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-6">
      {/* Kibo Breadcrumb with Slash Separator, adapted to a real back action. */}
      <nav aria-label="Computer location" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-2 text-sm">
          <li><button type="button" aria-label="Back to computers" onClick={onBack} className="min-h-11 cursor-pointer rounded-md text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0">Computers</button></li>
          <li aria-hidden="true" className="text-muted-foreground">/</li>
          <li aria-current="page" className="min-w-0 truncate font-semibold" title={computer.name}>{computer.name}</li>
        </ol>
      </nav>
      {running && !setupOpen && <Button type="button" variant="outline" size="sm" className="min-h-10 shrink-0" onClick={() => { setSetupOpen(true); setClickError(''); }}>Grant screen access</Button>}
    </header>
    <div className="relative flex min-h-0 flex-1 flex-col bg-black pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">
      {!running ? <p role="status" className="m-auto px-5 text-center text-sm text-muted-foreground">Desktop unavailable. Its saved files remain until confirmed deletion.</p> : <>
        <div ref={streamRef} onScroll={event => setPanOffset(event.currentTarget.scrollLeft)} className="relative flex min-h-0 flex-1 overflow-x-auto overflow-y-hidden bg-black">
          <iframe key={`${id}:${viewerKey}`} title={`${computer.name} desktop`} src={url} referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-downloads" allow="fullscreen" style={{ width: streamWidth ? `${streamWidth}px` : '100%' }} className="h-full min-h-0 shrink-0 border-0 bg-black" />
        </div>
        {streamWidth > (streamRef.current?.clientWidth ?? 0) + 4 && !setupOpen && <div className="absolute bottom-[calc(5.75rem+env(safe-area-inset-bottom))] left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-background/90 p-1 shadow-lg md:bottom-3">
          <Button type="button" variant="outline" size="sm" aria-label="Pan desktop left" disabled={panOffset < 1} className="min-h-11 min-w-11" onClick={() => streamRef.current?.scrollBy({ left: -240 })}>←</Button>
          <span className="text-xs text-muted-foreground">Pan desktop</span>
          <Button type="button" variant="outline" size="sm" aria-label="Pan desktop right" disabled={panOffset >= streamWidth - (streamRef.current?.clientWidth ?? 0) - 1} className="min-h-11 min-w-11" onClick={() => streamRef.current?.scrollBy({ left: 240 })}>→</Button>
        </div>}
        {available === 'offline' && !setupOpen && <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 p-5 text-center text-sm">
          <p>Desktop stream unavailable. Your computer and files have not been deleted.</p>
          <Button type="button" variant="outline" onClick={() => { setAvailable('checking'); setViewerKey(key => key + 1); }}>Retry connection</Button>
        </div>}
        {setupOpen && <div className="absolute inset-x-0 top-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 flex min-h-0 flex-col bg-background p-3 md:bottom-0 md:p-5">
          <h3 className="shrink-0 text-base font-semibold">Grant screen access</h3>
          <p className="mt-1 shrink-0 text-xs leading-relaxed text-muted-foreground"><strong>Permission preview: clicks only.</strong> Wait for Ubuntu’s dialog, turn on “Allow Remote Interaction”, then click “Share”. Arrow keys move the marker; Enter clicks it. To drag windows or type, choose <strong>Show live desktop</strong> after granting access.</p>
          <div className="mt-2 flex shrink-0 items-center justify-end gap-2 text-xs text-muted-foreground">
            <Button type="button" variant="outline" size="sm" aria-label="Zoom out desktop preview" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - 1))} className="min-h-11 px-3 md:min-h-0">−</Button>
            <span role="status" aria-label={`Preview zoom ${zoom} times`} className="min-w-7 text-center">{zoom}×</span>
            <Button type="button" variant="outline" size="sm" aria-label="Zoom in desktop preview" disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value + 1))} className="min-h-11 px-3 md:min-h-0">+</Button>
          </div>
          <div ref={scrollRef} className={`min-h-0 flex-1 overflow-auto py-3 ${zoom === 1 ? 'flex items-center justify-center' : ''}`}>
            <button type="button" aria-label={`Click the permission dialog for ${computer.name}`} data-testid="computer-consent-preview" disabled={!previewLoaded || clickBusy || available === 'offline'} onClick={clickPreview} onKeyDown={moveCursor} onPointerDown={event => { previewPointerStart.current = { x: event.clientX, y: event.clientY }; previewDragged.current = false; setKeyboardTargetVisible(false); }} onPointerMove={movePreviewPointer} onPointerUp={() => { previewPointerStart.current = null; }} onPointerCancel={() => { previewPointerStart.current = null; previewDragged.current = true; }} style={{ width: fitWidth ? `${fitWidth * zoom}px` : '100%' }} className="relative block aspect-video shrink-0 overflow-hidden rounded-lg border border-border bg-black enabled:cursor-pointer disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <img ref={imageRef} src={`/api/computers/${encodeURIComponent(id)}/preview?full=1&at=${frame}`} alt={`Permission preview of ${computer.name}`} draggable={false} onDragStart={event => event.preventDefault()} onLoad={() => { setPreviewLoaded(true); setPreviewFailed(false); }} onError={() => { setPreviewLoaded(false); setPreviewFailed(true); }} className="h-full w-full select-none object-contain" />
              {previewLoaded && keyboardTargetVisible && <span aria-hidden="true" data-testid="computer-keyboard-target" className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/40 shadow-[0_0_2px_2px_black]" style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }} />}
              {!previewLoaded && <span role="status" className="absolute inset-0 flex items-center justify-center text-sm text-white">{previewFailed ? 'Preview unavailable' : 'Loading screen…'}</span>}
            </button>
          </div>
          {clickError && <p role="alert" className="shrink-0 text-xs text-red-400">{clickError}</p>}
          <div className="flex shrink-0 items-center justify-between gap-3">
            <span role="status" className="text-xs text-muted-foreground">{available === 'offline' ? 'Stream offline' : clickBusy ? 'Clicking…' : 'Control is shared with other dashboard visitors.'}</span>
            <Button type="button" size="sm" className="min-h-11 shrink-0 md:min-h-0" onClick={finishSetup}>Show live desktop</Button>
          </div>
        </div>}
      </>}
    </div>
  </section>;
}
