import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function TypingDots({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex shrink-0 items-center', compact ? 'gap-0.5' : 'gap-1', className)}
    >
      {[0, 1, 2].map(index => (
        <span
          key={index}
          className={cn('typing-dot rounded-full bg-current opacity-70', compact ? 'size-0.5' : 'size-1')}
          style={{ animationDelay: `${index * 150}ms` }}
        />
      ))}
    </span>
  );
}

type IndicatorSize = 'sm' | 'md';
function indicatorDimensions(size: IndicatorSize, typing: boolean) {
  return size === 'md'
    ? { width: typing ? 24 : 10, height: typing ? 12 : 10 }
    : { width: typing ? 20 : 8, height: typing ? 10 : 8 };
}

// Subtract the indicator's silhouette from the avatar, revealing any parent background.
export function AvatarFace({
  children,
  avatarSize,
  ready = false,
  typing = false,
  working = false,
  size = 'sm',
}: {
  children: ReactNode;
  avatarSize: number;
  ready?: boolean;
  typing?: boolean;
  working?: boolean;
  size?: IndicatorSize;
}) {
  const { width, height } = indicatorDimensions(size, typing);
  const center = avatarSize - 4;
  const visible = ready || typing || working;
  const cutout = {
    x: center - width / 2 - 2,
    y: center - height / 2 - 2,
    width: width + 4,
    height: height + 4,
    rx: height / 2 + 2,
  };
  // The face, with a rounded hole where the presence indicator sits. A self-contained image, not a reference to an
  // SVG <mask> in the page: iOS Safari loses such references once the list is hidden and shown, masking it all.
  const mask = `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${avatarSize}" height="${avatarSize}"><mask id="m"><rect width="100%" height="100%" fill="white"/><rect x="${cutout.x}" y="${cutout.y}" width="${cutout.width}" height="${cutout.height}" rx="${cutout.rx}" fill="black"/></mask><rect width="100%" height="100%" mask="url(#m)"/></svg>`,
  )}")`;
  const maskSize = `${avatarSize}px ${avatarSize}px`;
  return (
    <span
      data-slot="avatar-face"
      data-cutout-width={visible ? cutout.width : undefined}
      className="absolute inset-0"
      style={
        visible
          ? {
              maskImage: mask,
              WebkitMaskImage: mask,
              maskSize,
              WebkitMaskSize: maskSize,
              maskRepeat: 'no-repeat',
              WebkitMaskRepeat: 'no-repeat',
            }
          : undefined
      }
    >
      {children}
    </span>
  );
}

// Kibo avatar-standard-4 placement; a fixed-size working dot pulses in opacity. Typing remains a pill.
// Ready is a prototype UI state, not an endpoint-health or presence probe.
export function PresenceIndicator({
  ready = false,
  typing = false,
  working = false,
  size = 'sm',
  className,
}: {
  ready?: boolean;
  typing?: boolean;
  working?: boolean;
  size?: IndicatorSize;
  className?: string;
}) {
  const dot = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = dot.current;
    if (!element || !working || typing) return;
    const update = () => {
      element.style.animationPlayState = document.hidden ? 'paused' : 'running';
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, [working, typing]);
  if (!ready && !typing && !working) return null;
  const state = typing ? 'typing' : working ? 'working' : 'ready';
  return (
    <span
      aria-hidden="true"
      data-slot={typing ? 'typing-badge' : 'online-indicator'}
      data-state={state}
      title={typing ? 'Typing' : working ? 'Working' : 'Ready to chat'}
      style={indicatorDimensions(size, typing)}
      className={cn(
        // One shape in every state: the teal dot grows into the teal pill (and back); text colour switches at once.
        'absolute bottom-1 right-1 z-10 translate-x-1/2 translate-y-1/2 flex items-center justify-center overflow-hidden rounded-full transition-[width,height,background-color] duration-220 motion-reduce:transition-none',
        typing
          ? 'bg-[#2dd4bf] text-[#134e4a]'
          : working
            ? 'bg-transparent text-[#2dd4bf]'
            : 'bg-transparent text-[#23a55a]',
        className,
      )}
    >
      {typing ? (
        // The dots appear once the pill has grown in behind them, so they never float without it.
        <TypingDots compact className={cn('badge-dots-in', size === 'md' ? 'scale-125' : undefined)} />
      ) : (
        <span ref={dot} className={cn('presence-dot size-full rounded-full bg-current', working && 'presence-pulse')} />
      )}
    </span>
  );
}
