import data from 'emojibase-data/en/compact.json';
import { isReactionEmoji } from './reaction-store';

export type EmojiEntry = { emoji: string; label: string; keywords: string[] };
const catalog = new Map<string, EmojiEntry>();
for (const item of data) for (const variant of [item, ...(item.skins ?? [])]) {
  const unicode = variant.unicode;
  const emoji = isReactionEmoji(unicode) ? unicode : unicode.endsWith('\ufe0f') && isReactionEmoji(unicode.slice(0, -1)) ? unicode.slice(0, -1) : null;
  if (emoji && !catalog.has(emoji)) catalog.set(emoji, { emoji, label: variant.label, keywords: [...(item.tags ?? []), item.label] });
}
export function emojiLabel(emoji: string) { return catalog.get(emoji)?.label ?? emoji; }
export function searchEmoji(query: string, offset = 0, limit = 20) {
  const term = query.trim().toLowerCase();
  const matches = [...catalog.values()].filter(item => !term || item.emoji === term || item.label.toLowerCase().includes(term) || item.keywords.some(keyword => keyword.toLowerCase().includes(term)));
  return { matches: matches.slice(offset, offset + limit).map(({ emoji, label }) => ({ emoji, label })), total: matches.length, nextOffset: offset + limit < matches.length ? offset + limit : null };
}
