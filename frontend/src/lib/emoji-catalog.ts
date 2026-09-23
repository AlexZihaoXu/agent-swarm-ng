export type EmojiChoice = { value: string; label: string; keywords: string[] };
const emojiSequence = new RegExp('^\\p{RGI_Emoji}$', 'v');
export function isEmoji(value: string) { return value.length > 0 && value.length <= 64 && emojiSequence.test(value); }

function canonical(unicode: string) {
  if (isEmoji(unicode)) return unicode;
  // Emojibase appends a presentation selector to some default-emoji characters (e.g. 👍️).
  const withoutSelector = unicode.endsWith('\ufe0f') ? unicode.slice(0, -1) : unicode;
  return isEmoji(withoutSelector) ? withoutSelector : null;
}
let catalogPromise: Promise<EmojiChoice[]> | undefined;
export function loadEmojiCatalog() {
  return catalogPromise ??= import('emojibase-data/en/compact.json').then(({ default: data }) => {
    const options = new Map<string, EmojiChoice>();
    for (const item of data) for (const variant of [item, ...(item.skins ?? [])]) {
      const value = canonical(variant.unicode);
      if (value && !options.has(value)) options.set(value, { value, label: variant.label, keywords: [...(item.tags ?? []), item.label] });
    }
    return [...options.values()];
  });
}
export function searchEmoji(catalog: EmojiChoice[], query: string) {
  const term = query.trim().toLowerCase();
  return term ? catalog.filter(item => item.value === term || item.label.toLowerCase().includes(term) || item.keywords.some(tag => tag.toLowerCase().includes(term))) : catalog;
}
