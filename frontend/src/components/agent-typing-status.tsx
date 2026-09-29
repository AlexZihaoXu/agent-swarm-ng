import { TypingDots } from '@/components/typing-indicator';

export function AgentTypingStatus({
  name,
  typing,
  working = false,
  connected = true,
}: {
  name: string;
  typing: boolean;
  working?: boolean;
  connected?: boolean;
}) {
  if (!typing && !working) return null;
  return (
    // Keyed by mode, so moving between "working" and "typing" replays the small entrance.
    <p
      key={typing ? 'typing' : 'working'}
      role="status"
      className="status-enter flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
    >
      {typing ? (
        <>
          <TypingDots />
          <span className="truncate">
            <strong className="font-medium text-foreground">{name}</strong> is typing…
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
