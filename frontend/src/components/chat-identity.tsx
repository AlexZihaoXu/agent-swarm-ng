import { useState } from 'react';
import { SlideUpFadeSwap } from '@/components/ui/slide-up-fade-swap';
import { AvatarFace, PresenceIndicator } from '@/components/typing-indicator';
import { AgentAvatarArt } from '@/components/agent-avatar-art';
import type { AvatarAppearance } from '@/lib/agent-avatar';

export function AgentAvatar({
  initials,
  avatar,
  typing = false,
  ready = false,
  working = false,
  compaction = null,
  size = 'sm',
}: {
  initials: string;
  avatar?: AvatarAppearance;
  typing?: boolean;
  ready?: boolean;
  working?: boolean;
  /** Background compaction: summarizing its memory (an orbiting arc), or asleep until that is done (zzz). */
  compaction?: 'running' | 'sleeping' | null;
  size?: 'sm' | 'md';
}) {
  const avatarSize = size === 'md' ? 32 : 28;
  const value = {
    key: avatar ? `${avatar.shape}:${avatar.color}:${avatar.seed}:${avatar.eyeStyle ?? 'pill'}` : initials,
    initials,
    avatar,
  };
  const [snapshot, setSnapshot] = useState<{ current: typeof value; previous: typeof value | null }>({
    current: value,
    previous: null,
  });
  if (snapshot.current.key !== value.key) setSnapshot({ current: value, previous: snapshot.current });
  const state = compaction === 'sleeping' ? 'sleeping' : typing ? 'typing' : working ? 'working' : 'idle';
  const face = (item: typeof value, animated: boolean) =>
    item.avatar ? (
      <AgentAvatarArt {...item.avatar} size={avatarSize} state={state} animated={animated} />
    ) : (
      <span className="absolute inset-0 flex items-center justify-center rounded-full bg-foreground/10 text-[11px] font-medium text-foreground/75">
        {item.initials}
      </span>
    );
  return (
    <span
      aria-hidden="true"
      data-testid="chat-avatar"
      className={`relative shrink-0 ${size === 'md' ? 'size-8' : 'size-7'}`}
    >
      <AvatarFace avatarSize={avatarSize} ready={ready} typing={typing} working={working} size={size}>
        {snapshot.previous && (
          <span
            key={`previous-${snapshot.current.key}`}
            data-avatar="previous"
            className="absolute inset-0 opacity-0 animate-[fade-out_180ms_ease-out_both] motion-reduce:animate-none"
          >
            {face(snapshot.previous, false)}
          </span>
        )}
        <span
          key={snapshot.current.key}
          data-avatar="current"
          className={`absolute inset-0 ${snapshot.previous ? 'animate-[fade-in_180ms_ease-out_both] motion-reduce:animate-none' : ''}`}
        >
          {face(snapshot.current, true)}
        </span>
      </AvatarFace>
      <PresenceIndicator ready={ready} typing={typing} working={working} size={size} />
      <CompactionCue state={compaction} />
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

/** Background compaction on an avatar: an orbiting violet arc while summarizing; rising z's while asleep. */
export function CompactionCue({ state }: { state?: 'running' | 'sleeping' | null }) {
  if (state === 'running')
    return (
      <span
        data-slot="compaction-ring"
        className="compaction-ring pointer-events-none absolute -inset-[3px] rounded-full"
      />
    );
  if (state === 'sleeping')
    return (
      <span data-slot="sleeping" className="avatar-zzz pointer-events-none absolute -right-1.5 top-0 z-20 size-4">
        <span className="bottom-0 left-0 text-[9px]">z</span>
        <span className="bottom-0 left-0 text-[11px]">z</span>
        <span className="bottom-0 left-0 text-[13px]">z</span>
      </span>
    );
  return null;
}
