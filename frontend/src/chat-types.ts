import type { ChatFile } from '@/lib/chat-files';

export type ChatMessage = {
  id: string;
  sequence?: number;
  author: 'agent' | 'user';
  text: string;
  time?: string;
  timestamp?: number;
  replyTo?: { id: string; role: 'user' | 'assistant'; text: string } | null;
  files?: ChatFile[];
  /** Who wrote a human message (docs/users.md#in-chats); absent: the owner, before there were users. */
  writer?: string;
  /** Client-side only: uploaded files going with a message being sent. */
  fileIds?: string[];
};
