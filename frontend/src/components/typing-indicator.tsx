import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function TypingDots({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('inline-flex shrink-0 items-center', compact ? 'gap-0.5' : 'gap-1', className)}>
      {[0, 1, 2].map(index => <span key={index} className={cn('typing-dot rounded-full bg-current opacity-70', compact ? 'size-0.5' : 'size-1')} style={{ animationDelay: `${index * 150}ms` }} />)}
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
export function AvatarFace({ children, avatarSize, ready = false, typing = false, size = 'sm' }: {
  children: ReactNode; avatarSize: number; ready?: boolean; typing?: boolean; size?: IndicatorSize;
}) {
  const id = useId();
  const { width, height } = indicatorDimensions(size, typing);
  const center = avatarSize - 4;
  const visible = ready || typing;
  return <>
    {visible && <svg aria-hidden="true" width="0" height="0" className="pointer-events-none absolute">
      <defs><mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width={avatarSize} height={avatarSize}>
        <rect width={avatarSize} height={avatarSize} fill="white" />
        <rect data-slot="presence-cutout" x={center - width / 2 - 2} y={center - height / 2 - 2} width={width + 4} height={height + 4} rx={height / 2 + 2} fill="black" className="transition-[x,y,width,height,rx] duration-150 motion-reduce:transition-none" />
      </mask></defs>
    </svg>}
    <span data-slot="avatar-face" className="absolute inset-0" style={visible ? { maskImage: `url(#${id})` } : undefined}>{children}</span>
  </>;
}

// Kibo avatar-standard-4 placement; the user-selected typing state expands the dot into a pill.
// Ready is a prototype UI state, not an endpoint-health or presence probe.
export function PresenceIndicator({ ready = false, typing = false, size = 'sm', className }: { ready?: boolean; typing?: boolean; size?: IndicatorSize; className?: string }) {
  if (!ready && !typing) return null;
  return (
    <span aria-hidden="true" data-slot={typing ? 'typing-badge' : 'online-indicator'} title={typing ? 'Typing' : 'Ready to chat'} style={indicatorDimensions(size, typing)} className={cn(
      'absolute bottom-1 right-1 z-10 translate-x-1/2 translate-y-1/2 flex items-center justify-center overflow-hidden rounded-full bg-[#23a55a] text-white transition-[width,height] duration-150 motion-reduce:transition-none',
      className,
    )}>
      {typing && <TypingDots compact className={size === 'md' ? 'scale-125' : undefined} />}
    </span>
  );
}
