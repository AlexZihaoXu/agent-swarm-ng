/** Offsets are returned by the tool; keep UTF-16 surrogate pairs intact at slice boundaries. */
export function messageText(text: string, offset = 0, limit = 1000) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) throw new Error('Message offset is out of range.');
  const low = (index: number) => text.charCodeAt(index) >= 0xdc00 && text.charCodeAt(index) <= 0xdfff;
  const high = (index: number) => text.charCodeAt(index) >= 0xd800 && text.charCodeAt(index) <= 0xdbff;
  if (offset > 0 && low(offset) && high(offset - 1)) throw new Error('Use the returned nextOffset to avoid splitting a character.');
  let end = Math.min(text.length, offset + limit);
  if (end < text.length && high(end - 1) && low(end)) end--;
  return { text: text.slice(offset, end), offset, totalCharacters: text.length, truncated: offset > 0 || end < text.length, nextOffset: end < text.length ? end : null };
}
