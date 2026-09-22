import { AgentAvatarArt } from '@/components/agent-avatar-art';
import { MessageMarkdown } from '@/components/message-markdown';
import { defaultAvatar } from '@/lib/agent-avatar';
import type { DmNotice } from '@/use-dm-inbox';

// Reuse the chat bubble composition; only its tint and sender decoration differ.
export function AgentDmNotice({ notice, onOpen }: { notice: DmNotice; onOpen: () => void }) {
  return <article aria-label={`Message received from ${notice.senderName}`} data-dm-notice={notice.id} className="message-enter min-w-0 origin-top max-w-[85%] whitespace-pre-wrap rounded-2xl bg-teal-400/[0.09] px-3.5 py-2 text-sm leading-5 ring-1 ring-inset ring-teal-400/15 [overflow-wrap:anywhere] sm:max-w-[75%]">
    <div className="mb-1 flex items-center gap-1.5 text-[11px] text-teal-200/80">
      <AgentAvatarArt {...(notice.senderAvatar ?? defaultAvatar(notice.senderId))} size={16} />
      <span className="min-w-0 flex-1 break-words">Received from <span className="font-medium">{notice.senderName}</span></span>
      <button type="button" onClick={onOpen} aria-label={`View conversation with ${notice.senderName}`} title="View agent conversation" className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-full text-sm hover:bg-teal-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">↗</button>
    </div>
    <MessageMarkdown text={notice.preview} />
  </article>;
}
