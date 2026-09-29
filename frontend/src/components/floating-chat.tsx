import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { m } from 'motion/react';
import { keepReachable, raiseWindow, resizeFrom, useWindowLayer, type Box, type Edge } from '@/lib/floating-windows';
import { ResizeEdges } from './ui/resize-edges';
import { glide } from '@/lib/motion';
import { defaultAvatar } from '@/lib/agent-avatar';
import type { ChatAgent } from '@/use-chat';
import type { ChatMessage } from '@/chat-types';
import { useMessageWindow } from '@/lib/use-message-window';
import { ChatSkeleton, EdgeSkeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { JumpToLatest } from './jump-to-latest';
import { AgentAvatarArt } from './agent-avatar-art';
import { AgentTypingStatus } from './agent-typing-status';
import { ChatComposer } from './chat-composer';
import { chatFilesKey } from '@/lib/chat-files';
import { useAttachments } from '@/lib/use-attachments';
import type { ComputerAgentState } from './computer-control';
import { ConversationMessages } from './conversation-messages';
import { CloseLight } from './ui/close-light';
import { ScrollArea } from './ui/scroll-area';

/** Any size from 300×320 up to the page. */
const size = (want: { width: number; height: number }) => ({
  width: Math.min(Math.max(want.width, 300), window.innerWidth - 16),
  height: Math.min(Math.max(want.height, 320), window.innerHeight - 16),
});

/** Sizes the window within the page, then keeps it reachable. */
const place = (box: Box): Box => keepReachable({ ...box, ...size(box) });

/**
 * A floating chat with the agent on this computer, over the live desktop. It is the same conversation (and draft)
 * as in Chat, in a window styled like the floating terminal: dragged by its title bar (anywhere on the page, 64px
 * always on screen), resized from its corner, brought to the front when touched, and its one traffic light (red ×)
 * closes it back to the agent in the header.
 */
export function FloatingChat({
  agent,
  state,
  from,
  onMinimize,
}: {
  agent: ChatAgent;
  state: ComputerAgentState & { chat: NonNullable<ComputerAgentState['chat']> };
  /** The header control it was opened from (viewport coordinates): it grows from there and shrinks back into it. */
  from?: DOMRect | null;
  onMinimize: () => void;
}) {
  const { chat } = state;
  const channel = agent.channelId;
  const attachments = useAttachments(agent.real ? chatFilesKey(channel) : undefined);
  const area = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const gesture = useRef<{ kind: 'move' | Edge; x: number; y: number; start: Box } | null>(null);
  const layer = useWindowLayer('chat');
  // Opens at the viewer's right side (clear of the Terminals handle); later moves are the operator's.
  useLayoutEffect(() => {
    const room = area.current!.getBoundingClientRect();
    raiseWindow('chat');
    setBox(place({ width: 380, height: Math.min(560, room.height - 24), x: room.right - 380 - 48, y: room.top + 12 }));
  }, []);
  useEffect(() => {
    const refit = () => setBox(current => (current ? place(current) : current));
    window.addEventListener('resize', refit);
    return () => window.removeEventListener('resize', refit);
  }, []);
  useEffect(() => {
    if (!chat.historyReady[channel]) chat.loadHistory(agent);
  }, [channel]);
  const messages = chat.conversations[channel] ?? [];
  const ready = Boolean(chat.historyReady[channel]);
  // The same bounded window as the full chat: older pages load near the top, newer ones return near the bottom.
  const history = useMessageWindow({
    items: messages,
    idOf: (message: ChatMessage) => message.id,
    viewport,
    canLoadOlder: chat.historyCursor[channel] != null && !chat.historyLoading[channel] && ready,
    loadOlder: () => chat.loadHistory(agent, true),
    reset: channel,
  });
  // Follow new messages only while the reader is near the bottom; older pages keep their place through the
  // window's anchor (as in the group chat).
  const nearBottom = useRef(true);
  const previous = useRef({ first: '', last: '' });
  useLayoutEffect(() => {
    const root = viewport.current;
    if (!root) return;
    const first = messages[0]?.id ?? '',
      last = messages.at(-1)?.id ?? '';
    const before = previous.current;
    if (before.first && before.first !== first && before.last === last) {
      /* anchored by useMessageWindow */
    } else if (!before.last || nearBottom.current) root.scrollTo({ top: root.scrollHeight, behavior: 'instant' });
    previous.current = { first, last };
  }, [messages.length, messages.at(-1)?.text, box !== null]);
  // Once the window is on the page: a short history that cannot scroll still pages in older messages.
  useEffect(() => {
    if (box && ready) history.onScroll();
  }, [box !== null, ready]);

  const start = (kind: 'move' | Edge) => (event: ReactPointerEvent<HTMLElement>) => {
    if (!box || event.button !== 0) return;
    if (kind === 'move' && (event.target as Element).closest('button, a')) return;
    event.preventDefault();
    // Capture keeps the drag going while the pointer passes over the desktop stream's iframe.
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { kind, x: event.clientX, y: event.clientY, start: box };
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = gesture.current;
    if (!drag) return;
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    setBox(
      drag.kind === 'move'
        ? place({ ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy })
        : resizeFrom(drag.start, drag.kind, dx, dy, size),
    );
  };
  const end = () => {
    gesture.current = null;
  };
  // The grow/shrink point, in the window's own coordinates.
  const origin =
    box && from ? `${from.left + from.width / 2 - box.x}px ${from.top + from.height / 2 - box.y}px` : 'top right';

  return (
    <div ref={area} className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {box &&
        createPortal(
          <m.section
            aria-label={`Chat with ${agent.name}`}
            initial={{ opacity: 0, scale: 0.12 }}
            animate={{ opacity: 1, scale: 1, transition: { ...glide, opacity: { duration: 0.16 } } }}
            exit={{ opacity: 0, scale: 0.12, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
            data-floating-window
            data-focused={layer.focused ? '' : undefined}
            className={`fixed flex flex-col overflow-hidden rounded-xl border bg-background transition-[border-color,box-shadow] duration-200 ${layer.focused ? 'border-white/15 shadow-2xl shadow-black/60' : 'border-white/[0.08] shadow-lg shadow-black/40'}`}
            onPointerDownCapture={() => raiseWindow('chat')}
            style={{
              left: box.x,
              top: box.y,
              width: box.width,
              height: box.height,
              zIndex: layer.zIndex,
              transformOrigin: origin,
            }}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          >
            <header
              onPointerDown={start('move')}
              className="flex h-8 shrink-0 cursor-grab touch-none select-none items-center gap-3 border-b border-white/10 bg-[#1d1d1d] px-3 active:cursor-grabbing"
            >
              <CloseLight label={`Close chat with ${agent.name}`} onClick={onMinimize} dim={!layer.focused} />
              <span className="flex min-w-0 flex-1 items-center justify-center gap-1.5 text-xs">
                <AgentAvatarArt {...(agent.avatar ?? defaultAvatar(agent.id))} size={16} />
                <span
                  className={`truncate font-medium transition-colors ${layer.focused ? '' : 'text-muted-foreground'}`}
                >
                  {agent.name}
                </span>
              </span>
              <button
                type="button"
                onClick={() => chat.openConversation(agent)}
                className="shrink-0 rounded px-1 text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                Open in Chat
              </button>
            </header>
            <ScrollArea
              label={`Messages with ${agent.name}`}
              viewportRef={viewport}
              overlay={<JumpToLatest viewport={viewport} newest={messages.at(-1)?.id} onJump={history.toLatest} />}
              onScroll={event => {
                const root = event.currentTarget;
                nearBottom.current = root.scrollHeight - root.scrollTop - root.clientHeight < 80;
                history.onScroll();
              }}
              className="min-h-0 flex-1"
            >
              <div className="px-3 py-3">
                {chat.historyFailed[channel] && !ready ? (
                  <div className="py-6 text-center">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={chat.historyLoading[channel]}
                      onClick={() => chat.loadHistory(agent)}
                    >
                      Retry loading messages
                    </Button>
                  </div>
                ) : !ready ? (
                  <ChatSkeleton />
                ) : messages.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    No messages yet. Say something to {agent.name}.
                  </p>
                ) : (
                  <>
                    {/* Older messages load as the reader nears the top; this stays for keyboard users. */}
                    {chat.historyCursor[channel] != null && (
                      <button
                        type="button"
                        disabled={chat.historyLoading[channel]}
                        onClick={history.loadOlder}
                        className="sr-only focus:not-sr-only focus:mx-auto focus:mb-2 focus:block focus:rounded-md focus:px-3 focus:py-1 focus:text-xs focus:ring-2 focus:ring-ring"
                      >
                        Load earlier messages
                      </button>
                    )}
                    {(chat.historyCursor[channel] != null || chat.historyLoading[channel] || history.olderHidden) && (
                      <EdgeSkeleton label="Loading earlier messages…" />
                    )}
                    <ConversationMessages
                      reactionChannel={channel}
                      messages={history.visible}
                      time={agent.time}
                      agentName={agent.name}
                    />
                    {history.newerHidden && <EdgeSkeleton label="Loading newer messages…" />}
                  </>
                )}
              </div>
            </ScrollArea>
            <div className="shrink-0 border-t border-border px-2 pb-2 pt-1">
              <div className="mb-1 flex h-5 min-w-0 items-center px-2">
                <AgentTypingStatus
                  name={agent.name}
                  agentId={agent.id}
                  typing={Boolean(state.typing[channel])}
                  working={state.busy[channel]}
                  connected={state.connected}
                />
              </div>
              <ChatComposer
                name={agent.name}
                draft={chat.drafts[channel] ?? ''}
                onChange={text => chat.setDraft(channel, text)}
                onSend={() => {
                  // Your own message always shows, even when you had scrolled back.
                  nearBottom.current = true;
                  history.toLatest();
                  if (chat.send(agent, chat.drafts[channel] ?? '', attachments.ids)) attachments.clear();
                }}
                attachments={agent.real ? attachments : undefined}
                busy={state.busy[channel]}
                onStop={() => chat.stop(channel)}
                disabled={chat.historyLoading[channel] || !ready}
              />
            </div>
            <ResizeEdges onStart={start} />
          </m.section>,
          document.body,
        )}
    </div>
  );
}
