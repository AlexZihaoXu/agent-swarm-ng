import { useLayoutEffect, useRef } from 'react';
import {
  avatarShapes,
  eyePath,
  eyePoses,
  interpolateEyes,
  type AvatarShape,
  type AvatarState,
  type EyePose,
} from '@/lib/agent-avatar';
import {
  blendContour,
  contourPoints,
  curvePath,
  contourSpeed,
  eyelidTransform,
  faceMotion,
  type Point,
} from '@/lib/avatar-motion';
import { projectEye, type Gaze } from '@/lib/avatar-perspective';

const sampledContours = new Map<string, Point[]>();
function sampleContour(outline: SVGPathElement, path: string) {
  const cached = sampledContours.get(path);
  if (cached) return cached;
  outline.setAttribute('d', path);
  const length = outline.getTotalLength();
  let start = 0,
    closest = Infinity;
  // Match the upward-facing ray so corresponding samples do not twist between silhouettes.
  for (let i = 0; i < 256; i++) {
    const point = outline.getPointAtLength((length * i) / 256);
    const angle = Math.abs(Math.atan2(point.x - 32, 32 - point.y));
    if (angle < closest) {
      closest = angle;
      start = (length * i) / 256;
    }
  }
  const points = Array.from({ length: 32 }, (_, i) => {
    const p = outline.getPointAtLength((start + (length * i) / 32) % length);
    return { x: p.x, y: p.y };
  });
  sampledContours.set(path, points);
  return points;
}
type AppearanceTransition = { started?: number; points: Point[]; tilt: number; roundness: number; narrow: number };
export function AgentAvatarArt({
  shape,
  color,
  seed = 0,
  eyeStyle = 'pill',
  state = 'idle',
  size = 64,
  animated = false,
  look,
}: {
  shape: AvatarShape;
  color: string;
  seed?: number;
  eyeStyle?: 'pill' | 'round';
  state?: AvatarState;
  size?: number;
  animated?: boolean;
  look?: Gaze;
}) {
  const artwork = avatarShapes.find(item => item.id === shape) ?? avatarShapes[0];
  const svg = useRef<SVGSVGElement>(null),
    body = useRef<SVGPathElement>(null),
    head = useRef<SVGGElement>(null);
  const left = useRef<SVGPathElement>(null),
    right = useRef<SVGPathElement>(null),
    eyesGroup = useRef<SVGGElement>(null);
  const leftLid = useRef<SVGGElement>(null),
    rightLid = useRef<SVGGElement>(null);
  const leftView = useRef<SVGGElement>(null),
    rightView = useRef<SVGGElement>(null);
  const initial = useRef<EyePose>(eyePoses[state]),
    current = useRef<EyePose>(initial.current);
  const gaze = useRef({ x: 0, y: 0 });
  const rendered = useRef<Point[] | undefined>(undefined),
    transition = useRef<AppearanceTransition | undefined>(undefined);
  const tilt = useRef<number>(artwork.tilt),
    roundness = useRef(eyeStyle === 'round' ? 1 : 0);
  const narrow = useRef(shape === 'triangle' || shape === 'pear' ? 1 : 0);
  const identity = `${shape}:${seed}:${eyeStyle}:${state}`;
  const previousIdentity = useRef(identity);
  useLayoutEffect(() => {
    const root = svg.current!,
      outline = body.current!;
    const points = sampleContour(outline, artwork.path);
    if (previousIdentity.current !== identity && rendered.current) {
      transition.current = {
        points: rendered.current,
        tilt: tilt.current,
        roundness: roundness.current,
        narrow: narrow.current,
      };
    }
    previousIdentity.current = identity;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0,
      previous = 0,
      visible = true,
      disposed = false;
    const paint = (now: number, allowMotion: boolean, step = 1) => {
      const ambient = allowMotion && animated,
        time = ambient ? now / 1000 : 0;
      const morph = transition.current;
      // Start at the first animation frame, not during synchronous layout/sampling work.
      if (morph && allowMotion && step > 0 && morph.started === undefined) morph.started = now;
      const progress =
        morph && allowMotion ? (morph.started === undefined ? 0 : Math.min(1, (now - morph.started) / 320)) : 1;
      const eased = 1 - (1 - progress) ** 3;
      const target = contourPoints(
        points,
        seed,
        time * contourSpeed[state],
        state === 'idle' ? 0 : state === 'working' ? 0.6 : 1,
      );
      rendered.current = morph && progress < 1 ? blendContour(morph.points, target, eased) : target;
      const blend = (from: number, to: number) => from + (to - from) * eased;
      tilt.current = morph ? blend(morph.tilt, artwork.tilt) : artwork.tilt;
      roundness.current = morph ? blend(morph.roundness, eyeStyle === 'round' ? 1 : 0) : eyeStyle === 'round' ? 1 : 0;
      const targetNarrow = shape === 'triangle' || shape === 'pear' ? 1 : 0;
      narrow.current = morph ? blend(morph.narrow, targetNarrow) : targetNarrow;
      head.current?.setAttribute('transform', `rotate(${tilt.current} 32 32)`);
      outline.setAttribute('d', curvePath(rendered.current));
      if (progress === 1) transition.current = undefined;
      root.dataset.transition = transition.current ? 'running' : 'idle';
      const motion = ambient ? faceMotion(seed, time, state) : { blink: 0, x: 0, y: 0 };
      current.current = interpolateEyes(current.current, eyePoses[state], allowMotion ? step : 1);
      gaze.current.x += ((look?.x ?? motion.x) - gaze.current.x) * (allowMotion ? step : 1);
      gaze.current.y += ((look?.y ?? motion.y) - gaze.current.y) * (allowMotion ? step : 1);
      const round = (eye: readonly number[]) => {
        const x = (eye[0] + eye[4]) / 2,
          y = (eye[1] + eye[5]) / 2;
        return [x, y, x, y, x + 0.01, y];
      };
      const openEyes = interpolateEyes(
        current.current,
        [round(current.current[0]), round(current.current[1])],
        roundness.current,
      );
      eyesGroup.current?.setAttribute('stroke-width', String(4.2 + (8 - 4.2) * roundness.current));
      const leftEye = openEyes[0],
        rightEye = openEyes[1];
      leftView.current?.setAttribute('transform', projectEye(leftEye, gaze.current, shape, narrow.current).transform);
      rightView.current?.setAttribute('transform', projectEye(rightEye, gaze.current, shape, narrow.current).transform);
      left.current?.setAttribute('d', eyePath(leftEye));
      right.current?.setAttribute('d', eyePath(rightEye));
      leftLid.current?.setAttribute('transform', eyelidTransform(leftEye, motion.blink));
      rightLid.current?.setAttribute('transform', eyelidTransform(rightEye, motion.blink));
    };
    function reset() {
      if (disposed) return;
      cancelAnimationFrame(frame);
      previous = 0;
      const allowed = !reduced.matches && !document.hidden && visible;
      const moving = allowed && (animated || Boolean(transition.current));
      root.dataset.motion =
        reduced.matches || !animated ? 'static' : document.hidden || !visible ? 'paused' : 'enabled';
      paint(performance.now(), moving, moving ? 0 : 1);
      if (!moving) return;
      const tick = (now: number) => {
        if (disposed) return;
        if (!previous || now - previous >= 1000 / 30) {
          const elapsed = previous ? Math.min(64, now - previous) : 32;
          paint(now, true, 1 - Math.exp(-elapsed / 180));
          previous = now;
        }
        if (animated || transition.current) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }
    reset();
    const observer = new IntersectionObserver(entries => {
      const next = entries[0]?.isIntersecting ?? false;
      if (next !== visible) {
        visible = next;
        reset();
      }
    });
    observer.observe(root);
    reduced.addEventListener('change', reset);
    document.addEventListener('visibilitychange', reset);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      reduced.removeEventListener('change', reset);
      document.removeEventListener('visibilitychange', reset);
    };
  }, [artwork.path, artwork.tilt, identity, shape, seed, eyeStyle, state, animated, look?.x, look?.y]);
  return (
    <svg
      ref={svg}
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className="shrink-0"
      data-avatar-shape={shape}
      data-avatar-seed={seed}
      data-eye-style={eyeStyle}
      data-avatar-state={state}
    >
      <g ref={head} transform={`rotate(${artwork.tilt} 32 32)`}>
        <path
          ref={body}
          d={artwork.path}
          fill={color}
          className="transition-[fill] duration-240 ease-out motion-reduce:transition-none"
        />
        <g ref={eyesGroup} fill="none" stroke="#18272a" strokeWidth="4.2" strokeLinecap="round">
          <g ref={leftView} data-eye-view="left">
            <g ref={leftLid} data-eyelid="left">
              <path ref={left} d={eyePath(initial.current[0])} />
            </g>
          </g>
          <g ref={rightView} data-eye-view="right">
            <g ref={rightLid} data-eyelid="right">
              <path ref={right} d={eyePath(initial.current[1])} />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}
