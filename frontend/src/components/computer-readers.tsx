import { AgentAvatarArt } from './agent-avatar-art';
import { defaultAvatar } from '@/lib/agent-avatar';
import type { ChatAgent } from '@/use-chat';

/**
 * Agents reading a computer without holding it, as overlapping avatars (like a shared document's viewers), kept apart
 * from the holder's own avatar. At most four faces; the rest are counted.
 */
export function ComputerReaders({
  readers,
  agents,
}: {
  readers: { id: string; name: string }[];
  agents?: ChatAgent[];
}) {
  if (!readers.length) return null;
  const shown = readers.slice(0, 4);
  const more = readers.length - shown.length;
  const names = readers.map(reader => reader.name).join(', ');
  return (
    <div
      role="status"
      aria-label={`Reading this computer: ${names}`}
      title={`Reading: ${names}`}
      data-testid="computer-readers"
      className="flex shrink-0 items-center gap-1.5 motion-safe:animate-[fade-in_160ms_ease-out]"
    >
      <span aria-hidden="true" className="flex -space-x-2">
        {shown.map(reader => (
          <span
            key={reader.id}
            title={`${reader.name} is reading`}
            className="flex size-7 items-center justify-center rounded-full bg-sidebar ring-2 ring-background"
          >
            <AgentAvatarArt
              {...(agents?.find(agent => agent.id === reader.id)?.avatar ?? defaultAvatar(reader.id))}
              size={20}
            />
          </span>
        ))}
        {more > 0 && (
          <span className="flex size-7 items-center justify-center rounded-full bg-muted text-[10px] font-medium ring-2 ring-background">
            +{more}
          </span>
        )}
      </span>
      <span className="text-muted-foreground">reading</span>
    </div>
  );
}
