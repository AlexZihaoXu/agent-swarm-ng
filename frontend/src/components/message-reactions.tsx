import { menuAnchorX } from '@/lib/menu-anchor';
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as Popover from '@radix-ui/react-popover';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { paths } from '@/api/schema';
import { Button } from '@/components/ui/button';
import { EmojiSearch } from '@/components/emoji-search';
import { cn } from '@/lib/utils';
import {
  reactionChoices as choices,
  recentReactionsKey,
  parseRecentReactions,
  rememberReaction,
  type ReactionEmoji as Emoji,
} from '@/lib/recent-reactions';

type ReactionMap = Record<
  string,
  paths['/api/chats/{channelId}/reactions']['get']['responses'][200]['content']['application/json']['messages'][number]['reactions']
>;
function savedRecents() {
  try {
    return parseRecentReactions(localStorage.getItem(recentReactionsKey));
  } catch {
    return [];
  }
}
function AddReactionIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <circle cx="10" cy="13" r="7" />
      <path d="M7.5 15.5q2.5 2.5 5 0M7.5 11h.01M12.5 11h.01M19 3v6m-3-3h6" />
    </svg>
  );
}
function ReplyIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 17-5-5 5-5M4 12h10a6 6 0 0 1 6 6" />
    </svg>
  );
}
export function useMessageReactions(channelId: string | undefined, ids: string[]) {
  return useQuery<ReactionMap>({
    queryKey: ['reactions', channelId, ids.join(',')],
    enabled: Boolean(channelId && ids.length),
    placeholderData: previous => previous,
    queryFn: async ({ signal }) => {
      const output: ReactionMap = {};
      for (let index = 0; index < ids.length; index += 100) {
        const { data, error } = await api.GET('/api/chats/{channelId}/reactions', {
          params: { path: { channelId: channelId! }, query: { ids: ids.slice(index, index + 100) } },
          signal,
        });
        if (!data || error) throw new Error(error?.message ?? 'Could not load reactions.');
        for (const message of data.messages) output[message.id] = message.reactions;
      }
      return output;
    },
  });
}
export function ReactionLoadError({ failed, retry }: { failed: boolean; retry: () => void }) {
  return failed ? (
    <p role="alert" className="px-3 py-2 text-xs text-muted-foreground">
      Could not load reactions.{' '}
      <Button type="button" size="sm" variant="outline" onClick={retry}>
        Retry reactions
      </Button>
    </p>
  ) : null;
}
// Kibo context-menu-standard-7: recent emoji shortcuts and an accessible submenu on the message content.
export function MessageReactions({
  channelId,
  messageId,
  reactions = [],
  children,
  onReply,
}: {
  channelId: string;
  messageId: string;
  reactions?: ReactionMap[string];
  children: ReactElement;
  onReply?: () => void;
}) {
  const client = useQueryClient();
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const [mobileChoices, setMobileChoices] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false),
    [pickerOpen, setPickerOpen] = useState(false);
  const replyChosen = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const touchHold = useRef<{ x: number; y: number; timer: number } | null>(null);
  const suppressTouchClick = useRef(false);
  const clearTouchHold = () => {
    if (touchHold.current) window.clearTimeout(touchHold.current.timer);
    touchHold.current = null;
  };
  useEffect(() => () => clearTouchHold(), []);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menuOpen || !menu || !window.matchMedia('(max-width: 639px)').matches) return;
    const position = () => {
      menu.style.translate = 'none';
      const viewport = window.visualViewport;
      menu.style.maxHeight = `${Math.max(120, (viewport?.height ?? window.innerHeight) - 16)}px`;
      const rect = menu.getBoundingClientRect();
      const left = (viewport?.offsetLeft ?? 0) + 8,
        top = (viewport?.offsetTop ?? 0) + 8;
      const right = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth) - 8;
      const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - 8;
      const x = rect.left < left ? left - rect.left : rect.right > right ? right - rect.right : 0;
      const y = rect.top < top ? top - rect.top : rect.bottom > bottom ? bottom - rect.bottom : 0;
      menu.style.translate = `${x}px ${y}px`;
    };
    const observer = new ResizeObserver(position);
    observer.observe(menu);
    window.addEventListener('resize', position);
    window.visualViewport?.addEventListener('resize', position);
    menu.addEventListener('animationend', position);
    const frame = requestAnimationFrame(position);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('resize', position);
      menu.removeEventListener('animationend', position);
      cancelAnimationFrame(frame);
      menu.style.translate = 'none';
      menu.style.maxHeight = '';
    };
  }, [menuOpen, mobileChoices]);
  const recent = useQuery<Emoji[]>({
    queryKey: ['reaction-recents'],
    queryFn: savedRecents,
    initialData: savedRecents,
    staleTime: Infinity,
  });
  const change = async (emoji: Emoji) => {
    if (pending) return;
    setPending(true);
    setError('');
    const active = !reactions.find(item => item.emoji === emoji)?.mine;
    try {
      const { data, error } = await api.PUT('/api/chats/{channelId}/messages/{messageId}/reaction', {
        params: { path: { channelId, messageId } },
        body: { emoji, active },
      });
      if (!data || error) throw new Error(error?.message ?? 'Could not update the reaction.');
      if (active) {
        const next = rememberReaction(client.getQueryData<Emoji[]>(['reaction-recents']) ?? [], emoji);
        client.setQueryData(['reaction-recents'], next);
        try {
          localStorage.setItem(recentReactionsKey, JSON.stringify(next));
        } catch {
          /* Keep session-local preferences if storage is unavailable. */
        }
      }
      client.setQueriesData<ReactionMap>({ queryKey: ['reactions', channelId] }, previous =>
        previous ? { ...previous, [messageId]: data.reactions } : previous,
      );
      void client.invalidateQueries({ queryKey: ['reactions', channelId] });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not update the reaction.');
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <ContextMenu.Root
        open={menuOpen}
        onOpenChange={open => {
          setMenuOpen(open);
          if (!open) setMobileChoices(false);
        }}
      >
        <ContextMenu.Trigger
          asChild
          onPointerDown={event => {
            clearTouchHold();
            if (event.pointerType !== 'touch' || !event.isPrimary) return;
            suppressTouchClick.current = false;
            const { clientX: x, clientY: y } = event;
            const trigger = event.currentTarget;
            // Radix cancels its 700ms hold on *any* pointermove. A small finger drift
            // is not a scroll: open the same context menu after a tolerant hold.
            touchHold.current = {
              x,
              y,
              timer: window.setTimeout(() => {
                touchHold.current = null;
                suppressTouchClick.current = true;
                trigger.dispatchEvent(
                  new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    button: 2,
                    clientX: menuAnchorX(x),
                    clientY: y,
                  }),
                );
              }, 550),
            };
          }}
          onPointerMove={event => {
            if (
              touchHold.current &&
              event.pointerType === 'touch' &&
              Math.hypot(event.clientX - touchHold.current.x, event.clientY - touchHold.current.y) > 12
            )
              clearTouchHold();
          }}
          onPointerUp={clearTouchHold}
          onPointerCancel={clearTouchHold}
          onContextMenu={clearTouchHold}
          onClickCapture={event => {
            if (!suppressTouchClick.current) return;
            suppressTouchClick.current = false;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {children}
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            ref={menuRef}
            aria-label="Message actions"
            sticky="always"
            collisionPadding={8}
            onCloseAutoFocus={event => {
              if (pickerOpen || replyChosen.current) event.preventDefault();
              replyChosen.current = false;
            }}
            className="context-menu-content phone-menu-targets z-50 max-h-[calc(100dvh-16px)] min-w-52 max-w-[calc(100vw-16px)] overflow-y-auto rounded-lg border border-border bg-background p-1 ao-top shadow-lg sm:max-h-none sm:overflow-visible"
          >
            {recent.data.length > 0 && (
              <>
                <div role="group" aria-label="Recent reactions" className="flex flex-wrap gap-0.5 px-1 py-1">
                  {recent.data.map(emoji => {
                    const label = choices.find(choice => choice.value === emoji)?.label ?? emoji;
                    const mine = reactions.some(reaction => reaction.emoji === emoji && reaction.mine);
                    return (
                      <ContextMenu.Item
                        key={emoji}
                        textValue={label}
                        aria-label={mine ? `Remove ${label} reaction` : `React with ${label}`}
                        disabled={pending}
                        onSelect={() => void change(emoji)}
                        className="flex size-11 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md text-2xl leading-none outline-none data-[highlighted]:bg-muted data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 sm:size-9"
                      >
                        {emoji}
                      </ContextMenu.Item>
                    );
                  })}
                </div>
                <ContextMenu.Separator className="my-1 h-px bg-border" />
              </>
            )}
            <ContextMenu.Item
              disabled={pending}
              aria-expanded={mobileChoices}
              onSelect={event => {
                event.preventDefault();
                setMobileChoices(open => !open);
              }}
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-[highlighted]:bg-muted data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 sm:hidden"
            >
              <AddReactionIcon />
              Add reaction
              <span aria-hidden="true" className="ml-auto text-muted-foreground">
                ›
              </span>
            </ContextMenu.Item>
            {mobileChoices && (
              <div className="border-t border-border sm:hidden">
                <EmojiSearch
                  compact
                  onSelect={emoji => {
                    setMenuOpen(false);
                    void change(emoji);
                  }}
                />
              </div>
            )}
            <ContextMenu.Sub>
              <ContextMenu.SubTrigger
                disabled={pending}
                className="hidden w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-[highlighted]:bg-muted data-[state=open]:bg-muted data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 sm:flex"
              >
                <AddReactionIcon />
                Add reaction
                <span aria-hidden="true" className="ml-auto text-muted-foreground">
                  ›
                </span>
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent
                  sideOffset={4}
                  className="context-menu-content z-[60] rounded-lg border border-border bg-background ao-top shadow-lg"
                >
                  <EmojiSearch
                    onSelect={emoji => {
                      setMenuOpen(false);
                      void change(emoji);
                    }}
                  />
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
            <ContextMenu.Item
              disabled={!onReply || pending}
              onSelect={() => {
                replyChosen.current = true;
                onReply?.();
              }}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-[highlighted]:bg-muted data-[disabled]:cursor-not-allowed data-[disabled]:text-muted-foreground data-[disabled]:opacity-40"
            >
              <ReplyIcon />
              Reply
            </ContextMenu.Item>
            <p className="px-2 pb-1 pt-1.5 text-[11px] leading-snug text-muted-foreground">
              An agent may respond to a reaction, which uses its model.
            </p>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {reactions.length > 0 && (
        <div aria-label="Message reactions" className="ml-2 mt-1 flex flex-wrap items-center gap-1">
          {reactions.map(reaction => (
            <Button
              key={reaction.emoji}
              type="button"
              size="sm"
              variant="outline"
              aria-pressed={reaction.mine}
              aria-label={`${choices.find(item => item.value === reaction.emoji)?.label ?? reaction.emoji}: ${reaction.count} reaction${reaction.count === 1 ? '' : 's'}`}
              disabled={pending}
              onClick={() => void change(reaction.emoji as Emoji)}
              className={cn(
                'min-h-11 gap-1 rounded-md px-3 text-xs sm:min-h-0 sm:h-7 sm:px-1.5',
                reaction.mine && 'border-primary/50 bg-primary/10',
              )}
            >
              <span aria-hidden="true" className="text-base leading-none">
                {reaction.emoji}
              </span>
              <span>{reaction.count}</span>
            </Button>
          ))}
          <Popover.Root open={pickerOpen} onOpenChange={setPickerOpen}>
            <Popover.Trigger asChild>
              <button
                type="button"
                aria-label="Add reaction"
                disabled={pending}
                className="flex size-11 cursor-pointer items-center justify-center rounded-md border border-border bg-background text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 sm:size-7"
              >
                <AddReactionIcon />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="start"
                sideOffset={4}
                collisionPadding={12}
                className="z-[60] rounded-lg border border-border bg-background ao-top shadow-lg origin-[var(--radix-popover-content-transform-origin)] motion-safe:data-[state=open]:animate-[dialog-in_160ms_ease-out] motion-safe:data-[state=closed]:animate-[dialog-out_120ms_ease-in]"
              >
                <EmojiSearch
                  onSelect={emoji => {
                    setPickerOpen(false);
                    void change(emoji);
                  }}
                />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-400">
          {error}
        </p>
      )}
    </>
  );
}
