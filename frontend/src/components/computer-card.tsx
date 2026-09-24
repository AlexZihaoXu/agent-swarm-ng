import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { paths } from '@/api/schema';

export type Computer = paths['/api/computers']['get']['responses'][200]['content']['application/json']['computers'][number];

export function ComputerCard({ computer, onDelete, onOpen, canManage }: { computer: Computer; onDelete: (computer: Computer) => void; onOpen: (computer: Computer) => void; canManage: boolean }) {
  const target = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === 'visible');
  const [frame, setFrame] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const running = computer.state === 'running';

  useEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(Boolean(entries[0]?.isIntersecting)), { threshold: 0.01 });
    if (target.current) observer.observe(target.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const changed = () => setPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  useEffect(() => {
    if (!running || !visible || !pageVisible) return;
    setFrame(Date.now());
    const timer = window.setInterval(() => setFrame(Date.now()), 2000);
    return () => window.clearInterval(timer);
  }, [running, visible, pageVisible]);

  const status = running ? 'Running' : computer.state === 'exited' ? 'Stopped' : computer.state === 'unavailable' ? 'Unavailable' : computer.state;
  return <article ref={target} aria-label={computer.name} className="min-w-0 overflow-hidden rounded-xl border border-border bg-sidebar shadow-sm">
    <button type="button" data-testid="computer-preview" aria-label={`Open ${computer.name} desktop`} onClick={() => onOpen(computer)} disabled={!running || !canManage} className="relative block aspect-video w-full overflow-hidden bg-black/55 text-left enabled:cursor-pointer disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      {running && visible && frame > 0 && <img
        alt={`Desktop preview of ${computer.name}`}
        src={`/api/computers/${encodeURIComponent(computer.id)}/preview?at=${frame}`}
        onLoad={() => { setLoaded(true); setFailed(false); }}
        onError={() => { setLoaded(false); setFailed(true); }}
        className={`absolute inset-0 h-full w-full object-cover ${loaded ? '' : 'invisible'}`}
      />}
      {(!running || !loaded) && <div role="status" className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
        {!running ? 'Desktop offline' : failed ? 'Preview unavailable' : 'Loading preview…'}
      </div>}
      <span className="absolute bottom-2 left-2 rounded-md bg-black/75 px-2 py-1 text-xs text-white">{status}</span>
    </button>
    <div className="space-y-1.5 px-3 py-2.5">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-sm font-semibold" title={computer.name}>{computer.name}</h3>
        <Button type="button" variant="outline" size="sm" aria-label={`Delete ${computer.name}`} onClick={() => onDelete(computer)} disabled={!canManage} className="min-h-9 shrink-0 px-2 text-xs text-muted-foreground hover:text-red-400">Delete</Button>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>CPU {computer.cpuPercent === null ? '—' : `${computer.cpuPercent.toFixed(1)}%`}</span>
        <span>Memory {computer.memoryBytes === null ? '—' : `${Math.round(computer.memoryBytes / (1024 * 1024))} MiB`}</span>
      </div>
    </div>
  </article>;
}
