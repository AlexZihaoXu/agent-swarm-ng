import { useId, useLayoutEffect, useRef } from 'react';
import {
  accentColor,
  avatarShapes,
  eyePath,
  eyePoses,
  interpolateEyes,
  type AvatarAccessory,
  type AvatarMarking,
  type AvatarMouth,
  type AvatarShape,
  type AvatarState,
  type EyePose,
} from '@/lib/agent-avatar';
import {
  blendContour,
  contourPoints,
  curvePath,
  contourSpeed,
  crown,
  eyelidTransform,
  faceMotion,
  shapeOutline,
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
const INK = '#18272a';
/** Resting eye centres (left, right) that eye size and spacing are applied around. */
const eyeCentres = [
  [25, 28.5],
  [38, 27.5],
] as const;
const mouthPaths: Record<Exclude<AvatarMouth, 'none' | 'open'>, string> = {
  smile: 'M28.4 35.6 Q31.5 38.6 34.6 35.6',
  flat: 'M29.2 36.6 H33.8',
  cat: 'M28.2 35.6 Q29.85 37.8 31.5 35.8 Q33.15 37.8 34.8 35.6',
};
/** Accessories that sit on top of the head, drawn with the outline's highest point at the origin. */
function TopAccessory({ kind, accent }: { kind: AvatarAccessory; accent: string }) {
  if (kind === 'antenna')
    return (
      <>
        <path d="M32 1.5 V-5" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="32" cy="-7" r="2.6" fill={accent} />
      </>
    );
  if (kind === 'sprout')
    return (
      <>
        <path d="M32 1.5 V-3.5" stroke="#3f8f5a" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M32 -3 C28 -3.5 26 -6.5 26.5 -9 C29.5 -8.5 31.8 -6 32 -3 Z" fill="#6cc28a" />
        <path d="M32 -3.5 C36 -4 38.2 -7 37.6 -9.6 C34.6 -9 32.3 -6.6 32 -3.5 Z" fill="#8fd6a4" />
      </>
    );
  if (kind === 'bow')
    return (
      <g fill={accent} stroke={INK} strokeWidth="0.8" strokeLinejoin="round">
        <path d="M32 -1 L25 -5.5 Q23.5 -1 25 3 Z" />
        <path d="M32 -1 L39 -5.5 Q40.5 -1 39 3 Z" />
        <circle cx="32" cy="-1" r="2.1" />
      </g>
    );
  if (kind === 'halo')
    return <ellipse cx="32" cy="-5" rx="9.5" ry="2.6" fill="none" stroke="#f3d36b" strokeWidth="1.8" />;
  return null;
}
export function AgentAvatarArt({
  shape,
  color,
  seed = 0,
  eyeStyle = 'pill',
  state = 'idle',
  size = 64,
  animated = false,
  look,
  stretch = 0,
  taper = 0,
  wobble = 0,
  eyeSize = 1,
  eyeGap = 0,
  mouth = 'none',
  marking = 'none',
  accent,
  accessory = 'none',
}: {
  shape: AvatarShape;
  color: string;
  seed?: number;
  eyeStyle?: 'pill' | 'round';
  stretch?: number;
  taper?: number;
  wobble?: number;
  eyeSize?: number;
  eyeGap?: number;
  mouth?: AvatarMouth;
  marking?: AvatarMarking;
  accent?: string;
  accessory?: AvatarAccessory;
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
  const identity = `${shape}:${seed}:${eyeStyle}:${state}:${stretch}:${taper}:${wobble}`;
  const face = useRef<SVGGElement>(null),
    cheeks = useRef<SVGGElement>(null),
    topping = useRef<SVGGElement>(null);
  const ids = useId().replace(/[^a-zA-Z0-9]/g, '');
  const bodyId = `avatar-body-${ids}`,
    clipId = `avatar-clip-${ids}`,
    shadeId = `avatar-shade-${ids}`,
    lightId = `avatar-light-${ids}`;
  // Fine details only where they can be seen: markings from 24px, accessories from 20px.
  const detailed = size >= 24;
  const wearing = size >= 20 ? accessory : 'none';
  const onTop = wearing !== 'none' && wearing !== 'glasses';
  const tint = accentColor({ color, accent });
  const eyeWrap = (index: 0 | 1) => {
    const [cx, cy] = eyeCentres[index];
    const dx = (index ? 1 : -1) * eyeGap * 2.4;
    return `translate(${cx + dx} ${cy}) scale(${eyeSize}) translate(${-cx} ${-cy})`;
  };
  const previousIdentity = useRef(identity);
  useLayoutEffect(() => {
    const root = svg.current!,
      outline = body.current!;
    const points = shapeOutline(sampleContour(outline, artwork.path), { stretch, taper, wobble }, seed);
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
        state === 'idle' || state === 'sleeping' ? 0 : state === 'working' ? 0.6 : 1,
      );
      rendered.current = morph && progress < 1 ? blendContour(morph.points, target, eased) : target;
      const blend = (from: number, to: number) => from + (to - from) * eased;
      tilt.current = morph ? blend(morph.tilt, artwork.tilt) : artwork.tilt;
      // Closed eyes are arcs whatever the eye style.
      const targetRound = eyeStyle === 'round' && state !== 'sleeping' ? 1 : 0;
      roundness.current = morph
        ? blend(morph.roundness, targetRound)
        : roundness.current + (targetRound - roundness.current) * (allowMotion ? step : 1);
      const targetNarrow = shape === 'triangle' || shape === 'pear' ? 1 : 0;
      narrow.current = morph ? blend(morph.narrow, targetNarrow) : targetNarrow;
      head.current?.setAttribute('transform', `rotate(${tilt.current} 32 32)`);
      outline.setAttribute('d', curvePath(rendered.current));
      // A top accessory rides the top of the outline as the silhouette moves.
      const top = topping.current && crown(rendered.current);
      if (top) topping.current!.setAttribute('transform', `translate(${(top.x - 32).toFixed(2)} ${top.y.toFixed(2)})`);
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
      // Mouth, cheeks and the glasses bridge turn with the face like the eyes do.
      const faceTransform = projectEye([31.5, 32, 31.5, 32, 31.6, 32], gaze.current, shape, narrow.current).transform;
      face.current?.setAttribute('transform', faceTransform);
      cheeks.current?.setAttribute('transform', faceTransform);
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
  }, [
    artwork.path,
    artwork.tilt,
    identity,
    shape,
    seed,
    eyeStyle,
    state,
    animated,
    look?.x,
    look?.y,
    stretch,
    taper,
    wobble,
    wearing,
  ]);
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
      data-mouth={mouth}
      data-marking={marking}
      data-accessory={wearing}
    >
      <defs>
        <clipPath id={clipId}>
          <use href={`#${bodyId}`} />
        </clipPath>
        {/* Ambient occlusion, as on the app icon: shade gathering low on the body, a soft light along its top. */}
        <linearGradient id={shadeId} gradientUnits="userSpaceOnUse" x1="0" y1="30" x2="0" y2="62">
          <stop offset="0" stopColor="#0b2233" stopOpacity="0" />
          <stop offset="1" stopColor="#0b2233" stopOpacity="0.34" />
        </linearGradient>
        <linearGradient id={lightId} gradientUnits="userSpaceOnUse" x1="0" y1="4" x2="0" y2="22">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.26" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Room above the head for an accessory: the whole figure settles slightly lower and smaller. */}
      <g
        style={{
          transform: onTop ? 'translate(32px, 61px) scale(0.84) translate(-32px, -61px)' : 'none',
          transition: 'transform 240ms ease-out',
        }}
      >
        <g ref={head} transform={`rotate(${artwork.tilt} 32 32)`}>
          <path
            id={bodyId}
            ref={body}
            d={artwork.path}
            fill={color}
            className="transition-[fill] duration-240 ease-out motion-reduce:transition-none"
          />
          <g clipPath={`url(#${clipId})`} data-slot="avatar-shading">
            <rect x="-8" y="-8" width="80" height="80" fill={`url(#${shadeId})`} />
            <rect x="-8" y="-8" width="80" height="80" fill={`url(#${lightId})`} />
          </g>
          <g clipPath={`url(#${clipId})`} fill={tint} data-slot="avatar-markings">
            {detailed && marking === 'spots' && (
              <>
                {[0, 1, 2].map(i => (
                  <circle
                    key={i}
                    cx={14 + ((seed >>> (i * 3)) % 7) + i * 14}
                    cy={40 + ((seed >>> (i * 5)) % 9)}
                    r={2.2 + ((seed >>> (i * 7)) % 3) * 0.5}
                    opacity="0.85"
                  />
                ))}
              </>
            )}
            {marking === 'belly' && <ellipse cx="32" cy="52" rx="17" ry="11" opacity="0.8" />}
            {detailed && marking === 'stripe' && <rect x="0" y="41" width="64" height="5" opacity="0.8" />}
            <g ref={cheeks}>
              {marking === 'cheeks' && (
                <>
                  <ellipse cx="20.5" cy="34.5" rx="3.2" ry="2" opacity="0.75" />
                  <ellipse cx="42.5" cy="33.5" rx="3.2" ry="2" opacity="0.75" />
                </>
              )}
            </g>
          </g>
          <g ref={face} data-slot="avatar-features">
            {mouth === 'open' ? (
              <circle cx="31.5" cy="36.4" r="1.7" fill={INK} />
            ) : (
              mouth !== 'none' && (
                <path d={mouthPaths[mouth]} fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
              )
            )}
            {wearing === 'glasses' && (
              <path
                d={`M${29.6 - eyeGap * 2.4 + 4.6 * (eyeSize - 1)} 28 Q31.5 26.6 ${33.4 + eyeGap * 2.4 - 4.6 * (eyeSize - 1)} 27.6`}
                fill="none"
                stroke={INK}
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            )}
          </g>
          <g ref={eyesGroup} data-slot="avatar-eyes" fill="none" stroke={INK} strokeWidth="4.2" strokeLinecap="round">
            <g ref={leftView} data-eye-view="left">
              <g transform={eyeWrap(0)}>
                {wearing === 'glasses' && (
                  <circle cx={eyeCentres[0][0]} cy={eyeCentres[0][1]} r="5" fill="#ffffff22" strokeWidth="1.4" />
                )}
                <g ref={leftLid} data-eyelid="left">
                  <path ref={left} d={eyePath(initial.current[0])} />
                </g>
              </g>
            </g>
            <g ref={rightView} data-eye-view="right">
              <g transform={eyeWrap(1)}>
                {wearing === 'glasses' && (
                  <circle cx={eyeCentres[1][0]} cy={eyeCentres[1][1]} r="5" fill="#ffffff22" strokeWidth="1.4" />
                )}
                <g ref={rightLid} data-eyelid="right">
                  <path ref={right} d={eyePath(initial.current[1])} />
                </g>
              </g>
            </g>
          </g>
          {onTop && (
            <g ref={topping} data-slot="avatar-accessory" transform="translate(0 7)">
              <TopAccessory kind={wearing} accent={tint} />
            </g>
          )}
        </g>
      </g>
    </svg>
  );
}
