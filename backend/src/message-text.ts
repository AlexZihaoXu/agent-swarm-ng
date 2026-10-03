export function messageMatch(text: string, query: string) {
  const fold = (value: string) => value.replace(/[A-Z]/g, letter => letter.toLowerCase());
  const matchOffset = fold(text).indexOf(fold(query));
  let offset = Math.max(0, matchOffset - 80);
  if (
    text.charCodeAt(offset) >= 0xdc00 &&
    text.charCodeAt(offset) <= 0xdfff &&
    text.charCodeAt(offset - 1) >= 0xd800 &&
    text.charCodeAt(offset - 1) <= 0xdbff
  )
    offset--;
  return { matchOffset, snippet: messageText(text, offset, 320) };
}

/** Offsets are returned by the tool; keep UTF-16 surrogate pairs intact at slice boundaries. */
export function messageText(text: string, offset = 0, limit = 1000) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length)
    throw new Error('Message offset is out of range.');
  const low = (index: number) => text.charCodeAt(index) >= 0xdc00 && text.charCodeAt(index) <= 0xdfff;
  const high = (index: number) => text.charCodeAt(index) >= 0xd800 && text.charCodeAt(index) <= 0xdbff;
  if (offset > 0 && low(offset) && high(offset - 1))
    throw new Error('Use the returned nextOffset to avoid splitting a character.');
  let end = Math.min(text.length, offset + limit);
  if (end < text.length && high(end - 1) && low(end)) end--;
  return {
    text: text.slice(offset, end),
    offset,
    totalCharacters: text.length,
    truncated: offset > 0 || end < text.length,
    nextOffset: end < text.length ? end : null,
  };
}

/**
 * Untrusted text (another agent's message, a Discord body, computer or harness output) embedded in a model input must
 * never start a line with something the platform writes there: a bracketed label ("[your owner]", "[channel: …]", an
 * event header), a Discord author line ("12:00:00 · […]") or "+N more messages". Such a line gets a leading backslash
 * (after any indentation or invisible characters), so it reads as quoted text, never as the platform's own.
 */
export function neutralizeLabels(text: string) {
  return text.replace(
    // Indentation and any invisible or format character (bidi controls, zero-width, tags…) may precede it, and
    // look-alike dots and plus signs count too. The lead never spans a line break, so the scan stays linear.
    /^(?:[^\S\r\n\u2028\u2029]|[\p{Cf}\p{Default_Ignorable_Code_Point}])*(?=[[［〔【⟦]|\d{1,2}:\d\d:\d\d\s*[·⋅•∙‧・]|[+＋﹢]\s*\d+\s+more\s+message)/gimu,
    '$&\\',
  );
}
