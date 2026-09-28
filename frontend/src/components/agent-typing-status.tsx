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
    <p role="status" className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
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
