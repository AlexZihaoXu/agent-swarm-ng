import type { ChatAgent } from '@/use-chat';

/** The @word being typed at the caret (it may hold spaces, as names do), or null. */
export function mentionAt(text: string, caret: number) {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0 || (at > 0 && /[\p{L}\p{N}_]/u.test(before[at - 1]!))) return null;
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n@]/.test(query) || query.startsWith(' ')) return null;
  return { start: at, query };
}

/** Agents whose name starts with the query, then those with a word starting with it (case-insensitive). */
export function mentionMatches(agents: ChatAgent[], query: string) {
  const q = query.toLowerCase();
  const starts = agents.filter(agent => agent.name.toLowerCase().startsWith(q));
  const words = agents.filter(
    agent =>
      !starts.includes(agent) &&
      agent.name
        .toLowerCase()
        .split(/\s+/)
        .some(word => word.startsWith(q)),
  );
  return [...starts, ...words].slice(0, 8);
}
