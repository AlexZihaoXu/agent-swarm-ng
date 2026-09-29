import { AnimatePresence, m } from 'motion/react';
import { AgentAvatarArt } from '@/components/agent-avatar-art';
import { defaultAvatar } from '@/lib/agent-avatar';
import { glide } from '@/lib/motion';
import { useTerminalTypist } from '@/lib/terminal-typists';
import { cn } from '@/lib/utils';

/**
 * The agent typing into a terminal: its animated avatar (and name, where there is room) pops in while it types
 * and eases out a moment after it stops.
 */
export function TerminalTypist({
  computerId,
  session,
  compact = false,
  className,
}: {
  computerId: string;
  session: string;
  /** Just the avatar (for small previews). */
  compact?: boolean;
  className?: string;
}) {
  const typist = useTerminalTypist(computerId, session);
  return (
    <AnimatePresence>
      {typist && (
        <m.span
          key={typist.agentId}
          role="status"
          aria-label={`${typist.name} is typing in this terminal`}
          data-terminal-typist={typist.agentId}
          initial={{ opacity: 0, scale: 0.6, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0, transition: glide }}
          exit={{ opacity: 0, scale: 0.6, y: 4, transition: { duration: 0.18 } }}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-full bg-black/40 py-0.5 pl-0.5 text-[11px] text-white/85',
            compact ? 'pr-0.5' : 'pr-2',
            className,
          )}
          title={`${typist.name} ${typist.active ? 'is typing' : 'was typing'}`}
        >
          <AgentAvatarArt
            {...(typist.avatar ?? defaultAvatar(typist.agentId))}
            size={compact ? 18 : 20}
            state={typist.active ? 'typing' : 'idle'}
            animated
          />
          {!compact && <span className="max-w-32 truncate">{typist.name}</span>}
        </m.span>
      )}
    </AnimatePresence>
  );
}
