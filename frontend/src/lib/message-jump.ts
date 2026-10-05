import { useEffect, useRef } from 'react';

/**
 * A search result's Jump (docs/chat-and-groups.md#search): the panel asks for a message in a conversation (keyed
 * `chat:<channelId>`, `group:<id>`, `dm:<a>:<b>`), navigates there if needed, and that conversation takes the
 * request once its history is ready, loads back to the message and shows it highlighted.
 */
type Jump = { key: string; messageId: string };
let pending: Jump | null = null;
const EVENT = 'swarm-message-jump';

export function requestJump(key: string, messageId: string) {
  pending = { key, messageId };
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Runs `onJump` for a jump into this conversation, once `ready` (its first history page is in). */
export function useMessageJump(key: string, ready: boolean, onJump: (messageId: string) => void) {
  const latest = useRef(onJump);
  latest.current = onJump;
  useEffect(() => {
    if (!ready) return;
    const take = () => {
      if (pending?.key !== key) return;
      const { messageId } = pending;
      pending = null;
      latest.current(messageId);
    };
    take();
    window.addEventListener(EVENT, take);
    return () => window.removeEventListener(EVENT, take);
  }, [key, ready]);
}

/** Scrolls a shown message to the middle of its viewport and highlights it briefly. */
export function showMessage(root: HTMLElement, messageId: string) {
  const element = root.querySelector<HTMLElement>(`[data-window-id="${CSS.escape(messageId)}"]`);
  if (!element) return false;
  // Instantly (a smooth scroll would move the history window's edges while it runs), and only this viewport.
  const box = element.getBoundingClientRect(),
    view = root.getBoundingClientRect();
  root.scrollTop += box.top - view.top - Math.max(0, (root.clientHeight - box.height) / 2);
  element.classList.remove('message-jump-flash');
  // Restart the highlight when the same message is chosen again.
  void element.offsetWidth;
  element.classList.add('message-jump-flash');
  window.setTimeout(() => element.classList.remove('message-jump-flash'), 2400);
  return true;
}
