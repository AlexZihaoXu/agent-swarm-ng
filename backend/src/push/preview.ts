/** Notification text limits (docs/notifications.md): short enough for a lock screen, the payload well under 3 KB. */
export const BODY_LIMIT = 160;
export const TITLE_LIMIT = 80;
/** Characters of a message considered for its preview. */
const INPUT_LIMIT = 4096;

/** Cuts text to `limit` characters (whole code points), with an ellipsis when it was longer. */
export function clip(text: string, limit: number) {
  const points = Array.from(text);
  return points.length > limit
    ? `${points
        .slice(0, limit - 1)
        .join('')
        .trimEnd()}…`
    : text;
}

/**
 * A chat message as one line of plain text for a notification: Markdown marks, HTML tags, links' addresses, code
 * fences and spoilers (hidden, as in chat previews) are removed, whitespace is collapsed.
 */
export function plainText(markdown: string, limit = BODY_LIMIT) {
  // Only the start can be shown: the expressions below never see more than this.
  const text = markdown
    .slice(0, INPUT_LIMIT)
    .replace(/[\uD800-\uDBFF]$/, '')
    .replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/```[^\n]*\n?/g, '')
    .replace(/\|\|[\s\S]*?\|\|/g, '(spoiler)')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, '')
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, '')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clip(text, limit);
}
