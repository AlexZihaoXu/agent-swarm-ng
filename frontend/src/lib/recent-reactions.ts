import type { paths } from '@/api/schema';
export type ReactionEmoji = paths['/api/chats/{channelId}/messages/{messageId}/reaction']['put']['requestBody']['content']['application/json']['emoji'];
export const reactionChoices: { value: ReactionEmoji; label: string }[] = [{ value: '👍', label: 'Thumbs up' }, { value: '❤️', label: 'Heart' }, { value: '😂', label: 'Laugh' }, { value: '🎉', label: 'Celebrate' }, { value: '👀', label: 'Eyes' }, { value: '✅', label: 'Check' }, { value: '🤔', label: 'Thinking' }, { value: '🔥', label: 'Fire' }];
export const recentReactionsKey = 'swarm.recent-reactions';
export function parseRecentReactions(raw: string | null): ReactionEmoji[] {
  if (!raw || raw.length > 4096) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((value): value is ReactionEmoji => reactionChoices.some(choice => choice.value === value)))].slice(0, 3);
  } catch { return []; }
}
export function rememberReaction(current: ReactionEmoji[], emoji: ReactionEmoji): ReactionEmoji[] {
  return [emoji, ...current.filter(value => value !== emoji)].slice(0, 3);
}
