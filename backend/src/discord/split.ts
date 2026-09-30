/**
 * Splits text into Discord messages (at most `max` characters each) at paragraph, then line, then word
 * boundaries. A code block cut across parts is closed at the end of one part and reopened (same language) at the
 * start of the next, so every part renders correctly.
 */
export function splitDiscord(text: string, max = 2000): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed ? [trimmed] : [];
  const parts: string[] = [];
  let current = '';
  let fence: string | null = null; // the opening line of the code block `current` is inside, if any
  const reserve = () => (fence ? 4 : 0); // room for "\n```" to close it
  const flush = () => {
    if (!current.trim()) return;
    parts.push(fence ? `${current}\n\`\`\`` : current);
    current = fence ? `${fence}\n` : '';
  };
  for (const line of trimmed.split('\n')) {
    let rest = line;
    while (rest.length) {
      const room = max - reserve() - current.length - (current && !current.endsWith('\n') ? 1 : 0);
      if (rest.length <= room) {
        current += (current && !current.endsWith('\n') ? '\n' : '') + rest;
        rest = '';
        break;
      }
      if (current.trim() && rest.length <= max - reserve() - (fence ? fence.length + 1 : 0)) {
        flush();
        continue;
      }
      // A line longer than a whole message: cut it at the last space that fits (or hard).
      const space = rest.lastIndexOf(' ', room);
      const cut = space > room / 2 ? space : room;
      current += (current && !current.endsWith('\n') ? '\n' : '') + rest.slice(0, cut);
      rest = rest.slice(cut).trimStart();
      flush();
    }
    if (/^\s*```/.test(line)) fence = fence ? null : line.trim();
  }
  if (current.trim()) parts.push(current);
  return parts;
}
