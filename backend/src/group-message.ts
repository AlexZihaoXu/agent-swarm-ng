import type { AgentMessageSource } from './chat-runtime';
import type { GroupStore } from './group-store';

type Message = Awaited<ReturnType<GroupStore['message']>>;
export function groupSource(message: Message): AgentMessageSource {
  return { agentId: message.authorId ?? 'human', name: message.role === 'user' ? 'Human' : message.authorName, human: message.role === 'user', groupId: message.groupId, channelId: `group:${message.groupId}`, chainId: message.chainId, messageId: message.id };
}
export function groupMessageView(message: Message) {
  return { id: message.id, sequence: message.sequence, groupId: message.groupId, role: message.role, authorId: message.authorId, authorName: message.authorName, authorAvatar: message.authorAvatar ? JSON.parse(message.authorAvatar) : null, text: message.text, timestamp: message.createdAt.getTime() };
}
