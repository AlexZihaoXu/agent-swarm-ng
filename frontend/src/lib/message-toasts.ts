import type { AvatarAppearance } from '@/lib/agent-avatar';

/**
 * A new agent message somewhere else (another conversation, another organization), for a toast at the top of the
 * dashboard (components/message-toasts.tsx). use-chat announces them as they arrive; the toaster decides.
 */
export type MessageToast =
  | { kind: 'agent'; id: string; agentId: string; text: string }
  | {
      kind: 'group';
      id: string;
      groupId: string;
      authorId: string | null;
      authorName: string;
      authorAvatar?: AvatarAppearance | null;
      text: string;
    };

const listeners = new Set<(toast: MessageToast) => void>();
export function announceMessage(toast: MessageToast) {
  for (const listener of listeners) listener(toast);
}
export function onMessageAnnounced(listener: (toast: MessageToast) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
