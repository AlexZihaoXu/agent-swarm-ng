/**
 * Portal (Ctrl/⌘+K): what can be found, how a query is read and how results are ranked. Pure, so the palette stays a
 * thin view over it.
 */
export type PortalKind = 'agent' | 'chat' | 'computer' | 'terminal' | 'page' | 'file' | 'knowledge' | 'command';

/** What a result can pull out as a floating window (Enter). Everything else goes to its page. */
export type PortalWindowTarget =
  | { kind: 'chat'; agentId: string }
  | { kind: 'terminal'; computerId: string; session: string }
  | { kind: 'computer'; computerId: string };

export type PortalItem = {
  /** Unique across kinds. */
  id: string;
  kind: PortalKind;
  title: string;
  subtitle?: string;
  /** Extra words that find it (names of what it belongs to, aliases). */
  keywords?: string[];
  /** Its page (Shift+Enter, or Enter when it cannot float). */
  path?: string;
  float?: PortalWindowTarget;
  /** A command's action (Enter). */
  run?: () => void | Promise<void>;
  /** Found by the server for this text (inside its content): kept even when its title does not match. */
  found?: boolean;
  /** Shown only under its prefix (a private chat is also its agent). */
  prefixOnly?: boolean;
};

export const PREFIXES = [
  { prefix: '@', kinds: ['agent'], label: 'Agents' },
  { prefix: '#', kinds: ['chat'], label: 'Chats' },
  { prefix: ':', kinds: ['computer', 'terminal'], label: 'Computers' },
  { prefix: '/', kinds: ['page'], label: 'Pages' },
  { prefix: '>', kinds: ['command'], label: 'Commands' },
  { prefix: '?', kinds: ['knowledge'], label: 'Knowledge' },
] as const satisfies readonly { prefix: string; kinds: readonly PortalKind[]; label: string }[];
export type PortalPrefix = (typeof PREFIXES)[number];

/** Result groups, in the order they are shown. */
export const GROUPS: { kind: PortalKind; heading: string }[] = [
  { kind: 'agent', heading: 'Agents' },
  { kind: 'chat', heading: 'Chats' },
  { kind: 'computer', heading: 'Computers' },
  { kind: 'terminal', heading: 'Terminals' },
  { kind: 'page', heading: 'Pages' },
  { kind: 'file', heading: 'Files' },
  { kind: 'knowledge', heading: 'Knowledge' },
  { kind: 'command', heading: 'Commands' },
];

/** A typed prefix becomes a chip; the rest is the search text. */
export function parseQuery(input: string): { prefix?: PortalPrefix; text: string } {
  const prefix = PREFIXES.find(item => input.startsWith(item.prefix));
  return prefix ? { prefix, text: input.slice(1).trim() } : { text: input.trim() };
}

const normal = (value: string) => value.toLocaleLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** How well `text` finds `item` (0 = not at all): whole title, title start, word start, inside, keywords, letters in order. */
export function score(item: PortalItem, text: string) {
  const value = rawScore(item, text);
  return item.found ? Math.max(value, 30) : value;
}
function rawScore(item: PortalItem, text: string) {
  const query = normal(text);
  if (!query) return 1;
  const title = normal(item.title);
  if (title === query) return 100;
  if (title.startsWith(query)) return 80;
  if (title.split(/[\s_\-/:·]+/).some(word => word.startsWith(query))) return 60;
  if (title.includes(query)) return 40;
  const extra = normal([item.subtitle ?? '', ...(item.keywords ?? [])].join(' '));
  if (extra.includes(query)) return 20;
  let at = 0;
  for (const letter of title) if (letter === query[at]) at++;
  return at === query.length && query.length > 1 ? 10 : 0;
}

/**
 * Results grouped in GROUPS order, best first within each group, at most `perGroup` each (more under a prefix, which
 * narrows to one or two groups). Without text, commands and files wait to be asked for.
 */
export function search(items: PortalItem[], input: string, perGroup = 6) {
  const { prefix, text } = parseQuery(input);
  const kinds: readonly PortalKind[] | undefined = prefix?.kinds;
  const limit = prefix ? perGroup * 4 : perGroup;
  return GROUPS.flatMap(group => {
    if (kinds ? !kinds.includes(group.kind) : !text && (group.kind === 'command' || group.kind === 'file')) return [];
    const found = items
      .filter(item => item.kind === group.kind && (prefix || !item.prefixOnly))
      .map(item => ({ item, value: score(item, text) }))
      .filter(entry => entry.value > 0)
      .sort((a, b) => b.value - a.value || a.item.title.localeCompare(b.item.title))
      .slice(0, limit)
      .map(entry => entry.item);
    return found.length ? [{ ...group, items: found }] : [];
  });
}

/** What Enter does for an item: float it, run it, or go to its page. */
export const enterAction = (item: PortalItem) => (item.run ? 'run' : item.float ? 'open' : 'go to');
