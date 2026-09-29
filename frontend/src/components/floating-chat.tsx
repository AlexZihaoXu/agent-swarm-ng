import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { defaultAvatar } from '@/lib/agent-avatar';
import type { ChatAgent } from '@/use-chat';
import { AgentAvatarArt } from './agent-avatar-art';
import { AgentTypingStatus } from './agent-typing-status';
import { ChatComposer } from './chat-composer';
import type { ComputerAgentState } from './computer-control';
import { ConversationMessages } from './conversation-messages';
import { MinimizeLight } from './ui/minimize-light';
import { ScrollArea } from './ui/scroll-area';

type Box = { x: number; y: number; width: number; height: number };
/** A window shows the latest messages only; the full history stays in Chat. */
const SHOWN = 80;

function place(box: Box, area: { width: number; height: number }): Box {
  const width = Math.min(Math.max(box.width, 300), area.width - 16);
  const height = Math.min(Math.max(box.height, 320), area.height - 16);
  return {
    width,
    height,
    x: Math.min(Math.max(box.x, 8), area.width - width - 8),
    y: Math.min(Math.max(box.y, 8), area.height - height - 8),
  };
}

/**
 * A floating chat with the agent on this computer, over the live desktop. It is the same conversation (and draft)
 * as in Chat, in a window styled like the floating terminal: dragged by its title bar, resized from its corner,
 * kept inside the viewer, and its one traffic light minimizes it back to the agent in the header.
 */
export function FloatingChat({
  agent,
  state,
  onMinimize,
}: {
  agent: ChatAgent;
  state: ComputerAgentState & { chat: NonNullable<ComputerAgentState['chat']> };
  onMinimize: () => void;
}) {
  const { chat } = state;
  const channel = agent.channelId;
  const area = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const gesture = useRef<{ kind: 'move' | 'resize'; x: number; y: number; start: Box } | null>(null);
  const bounds = () => {
    const element = area.current?.parentElement;
    return { width: element?.clientWidth ?? 800, height: element?.clientHeight ?? 600 };
  };
  // Opens beside the right edge (clear of the Terminals handle); later moves are the operator's.
  useLayoutEffect(() => {
    const room = bounds();
    setBox(place({ width: 380, height: 560, x: room.width - 380 - 48, y: 12 }, room));
  }, []);
  useEffect(() => {
    const refit = () => setBox(current => (current ? place(current, bounds()) : current));
    window.addEventListener('resize', refit);
    return () => window.removeEventListener('resize', refit);
  }, []);
  useEffect(() => {
    if (!chat.historyReady[channel]) chat.loadHistory(agent);
  }, [channel]);
  const messages = (chat.conversations[channel] ?? []).slice(-SHOWN);
  // Follow the newest message while the reader is at the bottom.
  const following = useRef(true);
  useLayoutEffect(() => {
    const root = viewport.current;
    if (root && following.current) root.scrollTop = root.scrollHeight;
  }, [messages.length, messages.at(-1)?.text, box !== null]);

  const start = (kind: 'move' | 'resize') => (event: ReactPointerEvent<HTMLElement>) => {
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
      place(
        drag.kind === 'move'
          ? { ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy }
          : { ...drag.start, width: drag.start.width + dx, height: drag.start.height + dy },
        bounds(),
      ),
    );
  };
  const end = () => {
    gesture.current = null;
  };
  const ready = Boolean(chat.historyReady[channel]);

  return (
    <div ref={area} className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {box && (
        <section
          aria-label={`Chat with ${agent.name}`}
          className="float-window-enter pointer-events-auto absolute flex flex-col overflow-hidden rounded-xl border border-white/15 bg-background shadow-2xl shadow-black/60"
          style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <header
            onPointerDown={start('move')}
            className="flex h-8 shrink-0 cursor-grab touch-none select-none items-center gap-3 border-b border-white/10 bg-[#1d1d1d] px-3 active:cursor-grabbing"
          >
            <MinimizeLight label={`Minimize chat with ${agent.name}`} onClick={onMinimize} />
            <span className="flex min-w-0 flex-1 items-center justify-center gap-1.5 text-xs">
              <AgentAvatarArt {...(agent.avatar ?? defaultAvatar(agent.id))} size={16} />
              <span className="truncate font-medium">{agent.name}</span>
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
            onScroll={event => {
              const root = event.currentTarget;
              following.current = root.scrollHeight - root.scrollTop - root.clientHeight < 40;
            }}
            className="min-h-0 flex-1"
          >
            <div className="px-3 py-3">
              {!ready ? (
                <p role="status" className="py-6 text-center text-xs text-muted-foreground">
                  Loading messages…
                </p>
              ) : messages.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  No messages yet. Say something to {agent.name}.
                </p>
              ) : (
                <ConversationMessages
                  reactionChannel={channel}
                  messages={messages}
                  time={agent.time}
                  agentName={agent.name}
                />
              )}
            </div>
          </ScrollArea>
          <div className="shrink-0 border-t border-border px-2 pb-2 pt-1">
            <div className="mb-1 flex h-5 min-w-0 items-center px-2">
              <AgentTypingStatus
                name={agent.name}
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
                following.current = true;
                chat.send(agent, chat.drafts[channel] ?? '');
              }}
              busy={state.busy[channel]}
              onStop={() => chat.stop(channel)}
              disabled={chat.historyLoading[channel] || !ready}
            />
          </div>
          <div
            role="presentation"
            title="Resize"
            onPointerDown={start('resize')}
            className="absolute -bottom-1 -right-1 z-10 size-4 cursor-nwse-resize touch-none"
          />
        </section>
      )}
    </div>
  );
}
