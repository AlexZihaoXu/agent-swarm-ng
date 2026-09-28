export type ChatMessage = {
  id: string;
  sequence?: number;
  author: 'agent' | 'user';
  text: string;
  time?: string;
  timestamp?: number;
  replyTo?: { id: string; role: 'user' | 'assistant'; text: string } | null;
};
