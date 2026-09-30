import { TypingDots } from '@/components/typing-indicator';
import { useScratchWriter } from '@/lib/scratch-writers';

export function AgentTypingStatus({
  name,
  typing,
  working = false,
  compaction = null,
  connected = true,
  agentId,
}: {
  name: string;
  typing: boolean;
  working?: boolean;
  /** Background compaction: tidying its memory, or asleep until that is done. */
  compaction?: 'running' | 'sleeping' | null;
  connected?: boolean;
  /** Shows when this agent is writing to its scratchpad (typing a message still comes first). */
  agentId?: string;
}) {
  const writing = useScratchWriter(agentId);
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
            <strong className="font-medium text-foreground">{name}</strong> is asleep until its memory is compacted…
          </span>
        </>
      ) : mode === 'compacting' ? (
        <>
          <span aria-hidden="true" className="relative size-3 shrink-0">
            <span className="compaction-ring absolute inset-0 rounded-full" />
          </span>
          <span className="truncate">
            <strong className="font-medium text-foreground">{name}</strong> is compacting its memory in the background
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
      ) : connected ? (
        'Agent is working…'
      ) : (
        'Agent is working · reconnecting…'
      )}
    </p>
  );
}
