import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MutableRefObject,
} from 'react';
import { cn } from '@/lib/utils';

export type LiveSeries = { key: string; label: string; color: string; values: (number | null)[] };
/** The server's clock is the browser's minus `offset`; the window ends `delay` behind it, so readings never run out. */
export type LiveClock = { offset: number; delay: number };

const WINDOW = 60_000;
const TICK = 15_000;
// The same frame as TimeChart's Recharts layout: a 76px value axis, 8px top/right margins, time labels below.
const LEFT = 76,
  RIGHT = 8,
  TOP = 8,
  BOTTOM = 24;

/** 1, 2, 2.5 or 5 × a power of ten at or above the value: the axis eases between these, never to every wiggle. */
function niceMax(value: number) {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 2.5, 5, 10].find(step => value <= step * power) ?? 10) * power;
}

/** Path segments in data units (x: ms after `origin`, y: the value); a missing reading or a gap breaks the line. */
function segments(times: number[], values: (number | null)[], origin: number, gap: number) {
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  times.forEach((t, i) => {
    const value = values[i];
    if (value == null || (i > 0 && t - times[i - 1]! > gap)) {
      if (run.length) runs.push(run);
      run = [];
    }
    if (value != null) run.push([t - origin, value]);
  });
  if (run.length) runs.push(run);
  return runs;
}

const motionQuery = () => window.matchMedia?.('(prefers-reduced-motion: reduce)');
function useReducedMotion() {
  return useSyncExternalStore(
    change => {
      const query = motionQuery();
      query?.addEventListener('change', change);
      return () => query?.removeEventListener('change', change);
    },
    () => motionQuery()?.matches ?? false,
  );
}

/** One animation loop for every live chart on screen: each gets the frame's easing step (about 150 ms to settle). */
const followers = new Set<(ease: number) => void>();
let loopHandle = 0,
  lastFrame = 0;
function loop(now: number) {
  const ease = 1 - Math.exp(-(now - lastFrame) / 150);
  lastFrame = now;
  for (const follower of followers) follower(ease);
  loopHandle = followers.size ? requestAnimationFrame(loop) : 0;
}
function followFrames(follower: (ease: number) => void) {
  followers.add(follower);
  if (!loopHandle) {
    lastFrame = performance.now();
    loopHandle = requestAnimationFrame(loop);
  }
  return () => void followers.delete(follower);
}
const timeLabel = (t: number) => new Date(t).toLocaleTimeString(undefined, { minute: '2-digit', second: '2-digit' });

/**
 * The live minute's chart (docs/dashboard.md#now-live): TimeChart's look, but the window slides continuously with
 * the clock and readings are joined by straight lines, so four readings a second move smoothly. The lines are drawn
 * once per reading in data units; each animation frame (one loop shared by the charts on screen, none off screen)
 * only moves the lines and time labels and eases the value axis's top and labels, so it stays cheap. Reduced motion:
 * it steps once per reading instead.
 */
export function LiveChart({
  times,
  series,
  format,
  max,
  area = false,
  gap,
  clock,
  label,
  className,
}: {
  times: number[];
  series: LiveSeries[];
  format: (value: number) => string;
  /** A fixed top (CPU 100%, memory's total); otherwise the window's largest reading, rounded up. */
  max?: number;
  area?: boolean;
  /** Readings further apart than this (ms) leave a gap. */
  gap: number;
  clock: MutableRefObject<LiveClock>;
  /** What the chart shows, for screen readers (the panel's title). */
  label: string;
  className?: string;
}) {
  const id = useId().replace(/:/g, '');
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const origin = times[0] ?? 0;
  const latest = times.at(-1) ?? 0;
  const paths = useMemo(
    () =>
      series.map(item => {
        const runs = segments(times, item.values, origin, gap);
        const line = runs.map(run => run.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('')).join('');
        const fill = runs
          .map(run => `M${run[0]![0]} 0${run.map(([x, y]) => `L${x} ${y}`).join('')}L${run.at(-1)![0]} 0Z`)
          .join('');
        return { ...item, line, fill };
      }),
    [series, times, origin, gap],
  );
  const target = max ?? niceMax(Math.max(0, ...series.flatMap(item => item.values.filter(v => v != null))) as number);
  // Gridlines stay put; their labels follow the axis top as it eases.
  const shares = [0, 0.25, 0.5, 0.75, 1];
  // Time labels every 15 s across the window and a little beyond, so they slide in and out at the edges.
  const timeTicks = useMemo(() => {
    const out: number[] = [];
    for (let t = Math.ceil((latest - WINDOW - TICK) / TICK) * TICK; t <= latest + TICK; t += TICK) out.push(t);
    return out;
  }, [latest]);

  const plotWidth = Math.max(0, size.width - LEFT - RIGHT),
    plotHeight = Math.max(0, size.height - TOP - BOTTOM),
    bottom = TOP + plotHeight,
    perMs = plotWidth / WINDOW;
  const data = useRef<SVGGElement>(null);
  const timeAxis = useRef<SVGGElement>(null);
  const gridLabels = useRef<(SVGTextElement | null)[]>([]);
  const shown = useRef({ max: target, end: latest });
  const frame = useRef<(now: number) => void>(() => {});
  const still = useReducedMotion();
  // One frame: where the window ends now and how tall the axis is, applied straight to the SVG.
  frame.current = (ease: number) => {
    const end = still ? latest : Date.now() - clock.current.offset - clock.current.delay;
    const state = shown.current;
    state.max = still || !Number.isFinite(state.max) ? target : state.max + (target - state.max) * ease;
    state.end = end;
    const shift = LEFT + plotWidth + (origin - end) * perMs;
    data.current?.setAttribute('transform', `matrix(${perMs} 0 0 ${-plotHeight / state.max} ${shift} ${bottom})`);
    timeAxis.current?.setAttribute('transform', `translate(${shift} 0)`);
    shares.forEach((share, i) => {
      const text = format(share * state.max);
      const element = gridLabels.current[i];
      if (element && element.textContent !== text) element.textContent = text;
    });
  };
  // After each reading, before paint: the new lines in place at once; the axis keeps easing (or snaps, reduced motion).
  useLayoutEffect(() => frame.current(still ? 1 : 0));
  // Moving only while on screen.
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry?.isIntersecting ?? true));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (still || !onScreen) return;
    return followFrames(ease => frame.current(ease));
  }, [still, onScreen]);

  // Hovering reads the nearest reading under the pointer, like TimeChart's tooltip.
  const [pointer, setPointer] = useState<number | null>(null);
  const hovered = useMemo(() => {
    if (pointer === null || !times.length) return null;
    const t = shown.current.end - (LEFT + plotWidth - pointer) / perMs;
    let best = 0;
    times.forEach((time, i) => {
      if (Math.abs(time - t) < Math.abs(times[best]! - t)) best = i;
    });
    return Math.abs(times[best]! - t) <= gap ? best : null;
  }, [pointer, times, plotWidth, perMs, gap]);
  const now = series.map(item => [...item.values].reverse().find(value => value != null));

  return (
    <div className={cn('flex h-32 w-full flex-col text-xs', className)}>
      <div
        ref={box}
        className="relative min-h-0 flex-1"
        role="img"
        aria-label={`${label}: ${series.map((item, i) => `${item.label} ${now[i] != null ? format(now[i]!) : 'no reading'}`).join(', ')}`}
        onPointerMove={event => {
          const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
          setPointer(x >= LEFT && x <= LEFT + plotWidth ? x : null);
        }}
        onPointerLeave={() => setPointer(null)}
      >
        {size.width > 0 && (
          <svg width={size.width} height={size.height} aria-hidden="true" className="absolute inset-0 overflow-visible">
            <defs>
              <clipPath id={`${id}-plot`}>
                <rect x={LEFT} y={0} width={plotWidth} height={bottom + 1} />
              </clipPath>
              {/* Time labels fade in and out at the edges rather than being cut through. */}
              <linearGradient id={`${id}-edges`} gradientUnits="userSpaceOnUse" x1={LEFT} x2={LEFT + plotWidth}>
                <stop offset="0" stopColor="white" stopOpacity={0} />
                <stop offset={Math.min(0.5, 32 / Math.max(1, plotWidth))} stopColor="white" />
                <stop offset={Math.max(0.5, 1 - 32 / Math.max(1, plotWidth))} stopColor="white" />
                <stop offset="1" stopColor="white" stopOpacity={0} />
              </linearGradient>
              <mask id={`${id}-axis`} maskUnits="userSpaceOnUse" x={LEFT} y={bottom} width={plotWidth} height={BOTTOM}>
                <rect x={LEFT} y={bottom} width={plotWidth} height={BOTTOM} fill={`url(#${id}-edges)`} />
              </mask>
              {series.map(item => (
                <linearGradient key={item.key} id={`${id}-${item.key}`} x1="0" x2="0" y1="1" y2="0">
                  <stop offset="5%" stopColor={item.color} stopOpacity={0.6} />
                  <stop offset="95%" stopColor={item.color} stopOpacity={0.05} />
                </linearGradient>
              ))}
            </defs>
            {shares.map((share, i) => (
              <g key={i} transform={`translate(0 ${bottom - share * plotHeight})`}>
                <line x1={LEFT} x2={LEFT + plotWidth} className="stroke-border/50" />
                <text
                  ref={element => void (gridLabels.current[i] = element)}
                  x={LEFT - 8}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-muted-foreground tabular-nums"
                >
                  {format(share * shown.current.max)}
                </text>
              </g>
            ))}
            <g mask={`url(#${id}-axis)`}>
              <g ref={timeAxis}>
                {timeTicks.map(t => (
                  <text
                    key={t}
                    x={(t - origin) * perMs}
                    y={bottom + 16}
                    textAnchor="middle"
                    className="fill-muted-foreground tabular-nums"
                  >
                    {timeLabel(t)}
                  </text>
                ))}
              </g>
            </g>
            <g clipPath={`url(#${id}-plot)`}>
              <g ref={data}>
                {paths.map(item => (
                  <g key={item.key}>
                    {area && <path d={item.fill} fill={`url(#${id}-${item.key})`} stroke="none" />}
                    <path
                      d={item.line}
                      fill="none"
                      stroke={item.color}
                      strokeWidth={area ? 1 : 2}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                ))}
              </g>
            </g>
            {pointer !== null && hovered !== null && (
              <line x1={pointer} x2={pointer} y1={TOP} y2={bottom} className="stroke-border" />
            )}
          </svg>
        )}
        {pointer !== null && hovered !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 grid min-w-[8rem] gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 shadow-xl"
            style={pointer > LEFT + plotWidth / 2 ? { right: size.width - pointer + 8 } : { left: pointer + 8 }}
          >
            <div className="font-medium">{timeLabel(times[hovered]!)}</div>
            {series.map(item => (
              <div key={item.key} className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: item.color }} />
                <span className="flex-1 text-muted-foreground">{item.label}</span>
                <span className="font-mono tabular-nums">
                  {item.values[hovered] != null ? format(item.values[hovered]!) : '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      {series.length > 1 && (
        <div className="flex items-center justify-center gap-4 pt-3">
          {series.map(item => (
            <div key={item.key} className="flex items-center gap-1.5">
              <span className="size-2 shrink-0 rounded-[2px]" style={{ background: item.color }} />
              {item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
