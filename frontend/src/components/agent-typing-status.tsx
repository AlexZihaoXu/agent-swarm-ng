import { TypingDots } from '@/components/typing-indicator';
import { useScratchWriter } from '@/lib/scratch-writers';

export function AgentTypingStatus({
  name,
  typing,
  working = false,
  connected = true,
  agentId,
}: {
  name: string;
  typing: boolean;
  working?: boolean;
  connected?: boolean;
  /** Shows when this agent is writing to its scratchpad (typing a message still comes first). */
  agentId?: string;
}) {
  const writing = useScratchWriter(agentId);
  if (!typing && !working && !writing) return null;
  const mode = typing ? 'typing' : writing ? 'writing' : 'working';
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
