import { useState } from 'react';
import { SlideUpFadeSwap } from '@/components/ui/slide-up-fade-swap';

export function AgentAvatar({ initials }: { initials: string }) {
  const [snapshot, setSnapshot] = useState<{ current: string; previous: string | null }>({ current: initials, previous: null });
  if (snapshot.current !== initials) {
    setSnapshot({ current: initials, previous: snapshot.current });
  }
  const layerClass = 'absolute inset-0 flex items-center justify-center rounded-full bg-foreground/10 text-[11px] font-medium text-foreground/75';

  return (
    <span aria-hidden="true" data-testid="chat-avatar" className="relative size-7 shrink-0">
      {snapshot.previous && (
        <span key={`previous-${snapshot.current}`} data-avatar="previous" className={`${layerClass} opacity-0 animate-[fade-out_180ms_ease-out_both] motion-reduce:animate-none`}>
          {snapshot.previous}
        </span>
      )}
      <span key={snapshot.current} data-avatar="current" className={`${layerClass} ${snapshot.previous ? 'animate-[fade-in_180ms_ease-out_both] motion-reduce:animate-none' : ''}`}>
        {snapshot.current}
      </span>
    </span>
  );
}

export function AgentName({ name }: { name: string }) {
  return (
    <h2 aria-label={name} className="overflow-hidden text-sm font-semibold">
      <SlideUpFadeSwap text={name} />
    </h2>
  );
}
