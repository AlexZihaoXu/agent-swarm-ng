export type ChatMessage = { id: string; sequence?: number; author: 'agent' | 'user'; text: string; time?: string };
