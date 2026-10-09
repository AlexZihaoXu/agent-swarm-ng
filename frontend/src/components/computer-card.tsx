import { menuAnchorX } from '@/lib/menu-anchor';
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Button } from '@/components/ui/button';
import { advanceFrames, settleFrames, type PreviewLayer } from '@/lib/computer-preview-frames';
import { UsageDial } from './usage-dial';
import type { paths } from '@/api/schema';
import { useQuery } from '@tanstack/react-query';
import { terminalSessionsQuery } from '@/lib/computer-terminals';
import { TerminalIcon } from '@/components/ui/icons';
import { AgentAvatar } from './chat-identity';
import { defaultAvatar } from '@/lib/agent-avatar';
import type { AvatarAppearance } from '@/lib/agent-avatar';

/** An agent on a computer, for its card: who (avatar only) and whether it is working now. */
export type CardAgent = { id: string; name: string; avatar?: AvatarAppearance; working: boolean; ready: boolean };

export type Computer =
  paths['/api/computers']['get']['responses'][200]['content']['application/json']['computers'][number];

// 2 fps thumbnails, with the dissolve comfortably shorter than the poll
// interval so a fade is not normally interrupted mid-ramp.
const POLL_MS = 500,
  FADE_MS = 300;
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function ComputerCard({
  computer,
  canManage,
  index = 0,
  onOpen,
  recording = [],
  holder,
  readers = [],
}: {
  computer: Computer;
  canManage: boolean;
  /** Agents recording this computer now (start_recording). */
  recording?: string[];
  /** The agent holding it (write), and those only reading it: avatars with their status dot. */
  holder?: CardAgent;
  readers?: CardAgent[];
  /** Position in the grid, for the entrance cascade. */
  index?: number;
  onOpen: (computer: Computer) => void;
}) {
  const card = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === 'visible');
  const [layers, setLayers] = useState<PreviewLayer[]>([]);
  const [failed, setFailed] = useState(false);
  const running = computer.state === 'running';
  const stopped = computer.state === 'exited';
  const polling = running && visible && pageVisible;
  // Open terminals, for the chip beside the status: refreshed while the card is on screen (Portal shares the list).
  const terminals = useQuery({
    ...terminalSessionsQuery(computer.id),
    enabled: polling && canManage,
    refetchInterval: 10_000,
  });
  const openTerminals = running ? (terminals.data?.sessions.filter(session => session.alive).length ?? 0) : 0;

  useEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(Boolean(entries[0]?.isIntersecting)), {
      threshold: 0.01,
    });
    if (card.current) observer.observe(card.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const changed = () => setPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);

  // Poll a fresh thumbnail, then dissolve it in over the opaque floor.
  useEffect(() => {
    if (!polling) return;
    let cancelled = false,
      last = 0;
    const tick = () => {
      // Frame IDs must never repeat, even across visits: Chrome reuses an already-decoded image for an identical
      // URL in the same page regardless of no-store, so a counter restarting at 1 replayed old frames after
      // returning to this page. A timestamp is unique per card and increases.
      const id = Math.max(Date.now(), last + 1);
      last = id;
      // One stable URL per frame, shared by the preload and the rendered <img>,
      // so the fade never triggers a second fetch.
      const src = `/api/computers/${encodeURIComponent(computer.id)}/preview?at=${id}`;
      const probe = new Image();
      probe.onload = () => {
        if (cancelled) return;
        setFailed(false);
        if (prefersReducedMotion()) {
          setLayers(settleFrames(id));
          return;
        }
        setLayers(current => advanceFrames(current, id, 0));
        const started = performance.now();
        const step = () => {
          if (cancelled) return;
          const t = Math.min(1, (performance.now() - started) / FADE_MS);
          setLayers(current => advanceFrames(current, id, t));
          if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      };
      probe.onerror = () => {
        if (!cancelled) setFailed(true);
      };
      probe.src = src;
    };
    tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [polling, computer.id]);

  const status = running
    ? 'Running'
    : stopped
      ? 'Stopped'
      : computer.state === 'unavailable'
        ? 'Unavailable'
        : computer.state === 'creating'
          ? 'Creating'
          : computer.state === 'deleting'
            ? 'Deleting'
            : computer.state;
  // Docker sums CPU across cores, so divide by the container's own CPU count to
  // keep the dial a true fraction of capacity instead of saturating at 100%.
  const cpuFraction =
    computer.cpuPercent === null ? null : computer.cpuPercent / (100 * Math.max(1, computer.cpuCount ?? 1));
  const memoryMiB = computer.memoryBytes === null ? null : Math.round(computer.memoryBytes / (1024 * 1024));
  const limitMiB = computer.memoryLimitBytes === null ? null : Math.round(computer.memoryLimitBytes / (1024 * 1024));
  const openMenu = (event: ReactMouseEvent<HTMLElement>) => {
    // Radix opens on the DOM contextmenu event; a button click does not fire
    // one, so the trigger synthesises it on the card (the dashboard's existing
    // pattern for keyboard/touch access to a context menu). It opens at the ⋯
    // button, kept where the menu fits on screen.
    const anchor = card.current;
    if (!anchor) return;
    const button = event.currentTarget.getBoundingClientRect();
    anchor.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: Math.round(menuAnchorX(button.right)),
        clientY: Math.round(button.bottom),
      }),
    );
  };

  return (
    <article
      ref={card}
      data-computer-id={computer.id}
      aria-label={computer.name}
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
      className="card-enter min-w-0 overflow-hidden rounded-xl border border-border bg-sidebar ao-card shadow-sm transition-colors duration-200 hover:border-foreground/20"
    >
      <button
        type="button"
        data-testid="computer-preview"
        aria-label={`Open ${computer.name} desktop`}
        onClick={() => onOpen(computer)}
        disabled={!running || !canManage}
        className="relative block aspect-video w-full overflow-hidden bg-black/55 text-left enabled:cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {/* At most two layers, in paint order: the previous frame is a fully
          opaque floor and the newest dissolves over it, so brightness never
          dips the way a sum-to-one crossfade does. */}
        {polling &&
          layers.map(layer => (
            <img
              key={layer.id}
              alt=""
              aria-hidden="true"
              data-testid="computer-preview-layer"
              src={`/api/computers/${encodeURIComponent(computer.id)}/preview?at=${layer.id}`}
              style={{ opacity: layer.opacity }}
              className="absolute inset-0 h-full w-full object-cover will-change-[opacity]"
            />
          ))}
        {(!running || !layers.length) && (
          <div
            role="status"
            className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground"
          >
            {!running ? 'Desktop offline' : failed ? 'Preview unavailable' : 'Loading preview…'}
          </div>
        )}
        <span className="absolute bottom-2 left-2 flex items-center gap-1.5">
          <span className="flex items-center gap-1.5 rounded-md bg-black/75 px-2 py-1 text-xs text-white">
            {running && <span aria-hidden="true" className="size-2 rounded-full bg-emerald-400" />}
            {status}
          </span>
          {openTerminals > 0 && (
            <span
              title={`${openTerminals} terminal${openTerminals === 1 ? '' : 's'} open`}
              aria-label={`${openTerminals} terminal${openTerminals === 1 ? '' : 's'} open`}
              className="flex items-center gap-1 rounded-md bg-black/75 px-2 py-1 text-xs tabular-nums text-white"
            >
              <TerminalIcon className="size-3.5" />
              {openTerminals}
            </span>
          )}
        </span>
        {(holder || readers.length > 0) && (
          // Bottom right: the holder alone, then the readers grouped (like a shared document's viewers).
          <span className="absolute bottom-2 right-2 flex items-center gap-1.5">
            {holder && (
              <span
                role="img"
                aria-label={`${holder.name} is using it${holder.working ? ', working' : ''}`}
                title={`${holder.name} is using it`}
                className="relative flex rounded-full bg-black/75 p-0.5"
              >
                <AgentAvatar
                  initials={holder.name.slice(0, 2).toUpperCase()}
                  avatar={holder.avatar ?? defaultAvatar(holder.id)}
                  ready={holder.ready}
                  working={holder.working}
                />
              </span>
            )}
            {readers.length > 0 && (
              <span
                role="img"
                aria-label={`Viewing: ${readers.map(reader => reader.name).join(', ')}`}
                title={`Viewing: ${readers.map(reader => reader.name).join(', ')}`}
                className="flex items-center -space-x-2 rounded-full bg-black/75 p-0.5"
              >
                {readers.slice(0, 3).map(reader => (
                  <span key={reader.id} className="relative flex rounded-full ring-2 ring-black/75">
                    <AgentAvatar
                      initials={reader.name.slice(0, 2).toUpperCase()}
                      avatar={reader.avatar ?? defaultAvatar(reader.id)}
                      ready={reader.ready}
                      working={reader.working}
                    />
                  </span>
                ))}
                {readers.length > 3 && (
                  <span className="relative flex size-7 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-white ring-2 ring-black/75">
                    +{readers.length - 3}
                  </span>
                )}
              </span>
            )}
          </span>
        )}
        {recording.length > 0 && (
          <span
            role="status"
            aria-label={`Being recorded by ${recording.join(', ')}`}
            title={`Being recorded by ${recording.join(', ')}`}
            className="absolute right-2 top-2 flex items-center gap-1.5 rounded-md bg-black/75 px-2 py-1 text-[11px] font-medium text-white"
          >
            <span aria-hidden="true" className="size-2 rounded-full bg-red-500 motion-safe:animate-pulse" />
            Rec
          </span>
        )}
      </button>
      <div className="space-y-2 px-3 py-2.5">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold" title={computer.name}>
            {computer.name}
          </h3>
          {computer.outdated && (
            <span
              title="A newer computer image exists: Settings → Update to the latest computer image"
              className="shrink-0 rounded-full bg-sky-500/15 px-1.5 py-px text-[10px] font-medium text-sky-300"
            >
              Update available
            </span>
          )}
          {computer.resourceViewStale && (
            <span
              title="Its own memory and CPU figures (free, top) could not be restored after the LXCFS service restarted: restart this computer to refresh them"
              className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] font-medium text-amber-300"
            >
              Restart to refresh
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Actions for ${computer.name}`}
            aria-haspopup="menu"
            disabled={!canManage}
            onClick={openMenu}
            className="min-h-11 min-w-11 shrink-0 cursor-pointer rounded-md px-2 text-muted-foreground hover:text-foreground focus-visible:border-border focus-visible:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:min-h-9 md:min-w-9"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="currentColor">
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </Button>
        </div>
        {/* CPU starts at the left edge; memory begins at the card's centre. */}
        <div className="flex items-center gap-3 text-xs">
          <div className="min-w-0 flex-1">
            <UsageDial
              label="CPU"
              value={computer.cpuPercent === null ? '—' : `${computer.cpuPercent.toFixed(1)}%`}
              fraction={cpuFraction}
            />
          </div>
          <div className="min-w-0 flex-1">
            <UsageDial
              label="Memory"
              value={memoryMiB === null ? '—' : `${memoryMiB} MB`}
              caption={limitMiB ? `of ${limitMiB} MB` : undefined}
              fraction={memoryMiB === null || !limitMiB ? null : memoryMiB / limitMiB}
            />
          </div>
        </div>
      </div>
    </article>
  );
}
