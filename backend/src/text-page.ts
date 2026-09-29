/** Text files read like a person scrolls a page: the same shape as the computer `read` tool. */
export const DEFAULT_LINES = 200;
export const MAX_LINES = 2000;
export const MAX_PAGE_BYTES = 50_000;

export class TextError extends Error {}

/** One page of `text` from 1-based line `offset`, at most `limit` lines and 50,000 UTF-8 bytes. */
export function pageText(text: string, offset = 1, limit = DEFAULT_LINES) {
  if (!Number.isInteger(offset) || offset < 1) throw new TextError('offset is a positive line number.');
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LINES)
    throw new TextError(`limit must be 1..${MAX_LINES} lines.`);
  const lines = text.split(/(?<=\n)/);
  if (lines.length && lines.at(-1) === '') lines.pop();
  const encoder = new TextEncoder();
  let output = '',
    bytes = 0,
    count = 0,
    partial = false;
  for (let index = offset - 1; index < lines.length && count < limit; index++) {
    const line = lines[index];
    const size = encoder.encode(line).byteLength;
    if (bytes + size > MAX_PAGE_BYTES) {
      // Keep whole characters of a long line up to the byte budget.
      let room = MAX_PAGE_BYTES - bytes;
      for (const character of line) {
        const width = encoder.encode(character).byteLength;
        if (width > room) break;
        output += character;
        room -= width;
      }
      partial = true;
      count++;
      break;
    }
    output += line;
    bytes += size;
    count++;
  }
  const more = partial || offset - 1 + count < lines.length;
  return {
    text: output,
    offset,
    lines: count,
    totalLines: lines.length,
    truncated: more,
    partialLine: partial,
    nextOffset: more && !partial ? offset + count : null,
    prevOffset: offset > 1 ? Math.max(1, offset - limit) : null,
  };
}

export type TextEdit = { oldText: string; newText: string };

/**
 * Applies 1–100 exact replacements to `text`. Every `oldText` must appear exactly once in the ORIGINAL text, and
 * matches may not overlap; all are checked before anything changes (like the computer `edit` tool).
 */
export function applyEdits(text: string, edits: TextEdit[]) {
  if (!Array.isArray(edits) || edits.length < 1 || edits.length > 100)
    throw new TextError('Give 1–100 edits of {oldText, newText}.');
  const spans = edits.map((edit, index) => {
    if (typeof edit?.oldText !== 'string' || !edit.oldText || typeof edit.newText !== 'string')
      throw new TextError(`Edit ${index + 1}: oldText must be non-empty text and newText text.`);
    const start = text.indexOf(edit.oldText);
    if (start < 0) throw new TextError(`Edit ${index + 1}: oldText was not found. Read the file again.`);
    if (text.indexOf(edit.oldText, start + 1) >= 0)
      throw new TextError(`Edit ${index + 1}: oldText appears more than once; include more surrounding text.`);
    return { start, end: start + edit.oldText.length, newText: edit.newText, index };
  });
  spans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++)
    if (spans[i].start < spans[i - 1].end)
      throw new TextError(`Edits ${spans[i - 1].index + 1} and ${spans[i].index + 1} overlap.`);
  let result = '',
    position = 0;
  for (const span of spans) {
    result += text.slice(position, span.start) + span.newText;
    position = span.end;
  }
  return result + text.slice(position);
}
