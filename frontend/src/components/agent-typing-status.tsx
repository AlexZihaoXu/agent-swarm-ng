import { useEffect, useState } from 'react';
import { TypingDots } from '@/components/typing-indicator';
import { SlideUpFadeSwap } from '@/components/ui/slide-up-fade-swap';
import { useScratchWriter } from '@/lib/scratch-writers';
import { describeDoing } from '@/lib/agent-doing';
import type { ActivityEntry } from '@/use-chat';

export function AgentTypingStatus({
  name,
  typing,
  working = false,
  compaction = null,
  connected = true,
  agentId,
  activity,
}: {
  name: string;
  typing: boolean;
  working?: boolean;
  /** Background compaction: compacting its active context, or asleep until that is done. */
  compaction?: 'running' | 'sleeping' | null;
  connected?: boolean;
  /** Shows when this agent is writing to its scratchpad (typing a message still comes first). */
  agentId?: string;
  /** The agent's activity: names what it is doing ("reading Knowledge", "browsing the web"…) while it works. */
  activity?: readonly ActivityEntry[];
}) {
  const writing = useScratchWriter(agentId);
  // Re-read the activity every second while working, so unnamed work falls back to "working" on time.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!working || !activity) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [working, activity]);
  const doing = (working && activity && describeDoing(activity, now)) || 'working';
  if (!typing && !working && !writing && !compaction) return null;
  // Asleep outranks everything but typing; background tidying only shows when nothing else is happening.
  const mode = typing
    ? 'typing'
    : compaction === 'sleeping'
      ? 'sleeping'
      : writing
        ? 'writing'
        : working
          ? 'working'
          : 'compacting';
  return (
    // Keyed by mode, so moving between "working", "writing" and "typing" replays the small entrance.
    <p key={mode} role="status" className="status-enter flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      {typing ? (
        <>
          <TypingDots />
          <span className="truncate">
            <strong className="font-medium text-foreground">{name}</strong> is typing…
          </span>
        </>
      ) : mode === 'sleeping' ? (
        <>
          <span aria-hidden="true" className="font-semibold text-violet-300">
            zzz
          </span>
          <span className="truncate">
            <strong className="font-medium text-foreground">{name}</strong> is asleep until its context is compacted…
          </span>
        </>
      ) : mode === 'compacting' ? (
        <>
          <span aria-hidden="true" className="relative size-3 shrink-0">
            <span className="compaction-ring absolute inset-0 rounded-full" />
          </span>
          <span className="truncate">
            <strong className="font-medium text-foreground">{name}</strong> is compacting its context in the background
          </span>
        </>
      ) : writing ? (
        <>
          <TypingDots />
          <span className="truncate">
            <strong className="font-medium text-foreground">{name}</strong> is writing{' '}
            <span className="font-mono text-foreground/80">{writing}</span> in its scratchpad…
          </span>
        </>
      ) : (
        <span className="flex min-w-0 items-baseline gap-1 truncate">
          <strong className="font-medium text-foreground">{name}</strong> is <SlideUpFadeSwap text={doing} />…
          {!connected && ' · reconnecting…'}
        </span>
      )}
    </p>
  );
}
