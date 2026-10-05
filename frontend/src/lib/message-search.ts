/**
 * Message search (docs/chat-and-groups.md#search): the filters a search carries, how typed `key:value` tokens become
 * them, the request they make, and the browser's recent searches. Pure, so the panel stays a view.
 */
export type HasValue = 'file' | 'image' | 'link';
export type DateKey = 'before' | 'after' | 'during';
export type Filter =
  | { key: 'from'; value: string; label: string }
  | { key: 'has'; value: HasValue; label: string }
  | { key: DateKey; value: string; label: string }
  | { key: 'in'; value: 'this' | 'all'; label: string };
export type FilterKey = Filter['key'];
export type SearchState = { text: string; filters: Filter[] };
export type Person = { id: string; name: string };

export const FILTER_KEYS: { key: FilterKey; hint: string }[] = [
  { key: 'from', hint: 'you or an agent' },
  { key: 'has', hint: 'link, file or image' },
  { key: 'before', hint: 'a date' },
  { key: 'during', hint: 'a date' },
  { key: 'after', hint: 'a date' },
  { key: 'in', hint: 'this conversation or all chats' },
];
export const HAS_VALUES: { value: HasValue; label: string }[] = [
  { value: 'link', label: 'link' },
  { value: 'file', label: 'file' },
  { value: 'image', label: 'image' },
];
export const IN_VALUES: { value: 'this' | 'all'; label: string }[] = [
  { value: 'this', label: 'This conversation' },
  { value: 'all', label: 'All chats' },
];
export const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
] as const;
export type Sort = (typeof SORTS)[number]['value'];

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const isKey = (key: string): key is FilterKey => FILTER_KEYS.some(item => item.key === key);
/** A calendar day as the person's browser counts it (YYYY-MM-DD). */
export const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** The token being typed at the end of the field when it is a filter: `from:ad` → { key: 'from', value: 'ad' }. */
export function typingFilter(input: string): { key: FilterKey; value: string } | null {
  const match = /(?:^|\s)([a-z]+):(\S*)$/i.exec(input);
  if (!match || !isKey(match[1]!.toLowerCase())) return null;
  return { key: match[1]!.toLowerCase() as FilterKey, value: match[2]! };
}
/** The field without the filter token being typed. */
export const withoutTyping = (input: string) => input.replace(/(?:^|\s)[a-z]+:\S*$/i, '').trimEnd();

/** The choices for a filter key, narrowed by what is typed after the colon. */
export function filterChoices(
  key: FilterKey,
  typed: string,
  people: Person[],
  now = new Date(),
): (Filter & { description?: string; personId?: string })[] {
  const needle = typed.trim().toLowerCase();
  const matches = (label: string) => !needle || label.toLowerCase().includes(needle);
  if (key === 'from')
    return [
      { key: 'from' as const, value: 'you', label: 'You', description: 'Messages people wrote' },
      ...people.map(person => ({
        key: 'from' as const,
        value: `agent:${person.id}`,
        label: person.name,
        personId: person.id,
      })),
    ].filter(choice => matches(choice.label));
  if (key === 'has') return HAS_VALUES.filter(item => matches(item.label)).map(item => ({ key, ...item }));
  if (key === 'in') return IN_VALUES.filter(item => matches(item.label)).map(item => ({ key, ...item }));
  const day = (offset: number) => localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset));
  const days = [
    { value: day(0), label: 'Today' },
    { value: day(1), label: 'Yesterday' },
    { value: day(7), label: 'A week ago' },
    { value: day(30), label: '30 days ago' },
  ];
  if (DAY.test(needle)) return [{ key, value: needle, label: needle }];
  return days
    .filter(item => matches(item.label) || item.value.startsWith(needle))
    .map(item => ({ key, value: item.value, label: item.label, description: item.value }));
}

/** Adds a filter: one per key, except `has`, which may hold each value once; before/after/during replace each other. */
export function addFilter(filters: Filter[], filter: Filter): Filter[] {
  const dates: FilterKey[] = ['before', 'after', 'during'];
  const kept = filters.filter(item =>
    filter.key === 'has'
      ? !(item.key === 'has' && item.value === filter.value)
      : filter.key === 'during' || (dates.includes(filter.key) && item.key === 'during')
        ? !dates.includes(item.key)
        : item.key !== filter.key,
  );
  return [...kept, filter];
}

/**
 * Whole filter tokens typed into the field (`has:link `, `before:2026-10-01`, `in:all`) become filters; the rest is
 * the text. `from:` takes a name only through its choices, since names can have spaces.
 */
export function absorbTokens(state: SearchState): SearchState {
  let filters = state.filters;
  const words: string[] = [];
  for (const word of state.text.split(/(\s+)/)) {
    const match = /^([a-z]+):(\S+)$/i.exec(word);
    const key = match?.[1]!.toLowerCase();
    const value = match?.[2]!.toLowerCase() ?? '';
    if (key === 'has' && HAS_VALUES.some(item => item.value === value))
      filters = addFilter(filters, { key, value: value as HasValue, label: value });
    else if ((key === 'before' || key === 'after' || key === 'during') && DAY.test(value))
      filters = addFilter(filters, { key, value, label: value });
    else if (key === 'in' && (value === 'all' || value === 'this'))
      filters = addFilter(filters, { key, value, label: IN_VALUES.find(item => item.value === value)!.label });
    else if (key === 'from' && value === 'you') filters = addFilter(filters, { key, value, label: 'You' });
    else words.push(word);
  }
  return { text: words.join('').replace(/\s+/g, ' ').trimStart(), filters };
}

/** Something to search for: words, or at least one filter that narrows (scope alone does not). */
export const searchable = (state: SearchState) =>
  Boolean(state.text.trim()) || state.filters.some(filter => filter.key !== 'in');

/** The request: `conversation` when the search stays in this conversation, else the organization shown (if one). */
export function searchQuery(
  state: SearchState,
  options: { conversation: string | null; organizationId: string | null; sort: Sort; page: number },
) {
  const scope = state.filters.find(filter => filter.key === 'in')?.value ?? (options.conversation ? 'this' : 'all');
  const has = state.filters.filter(filter => filter.key === 'has').map(filter => filter.value);
  const one = (key: FilterKey) => state.filters.find(filter => filter.key === key)?.value;
  return {
    ...(state.text.trim() ? { q: state.text.trim().slice(0, 200) } : {}),
    ...(scope === 'this' && options.conversation
      ? { conversation: options.conversation }
      : options.organizationId
        ? { organizationId: options.organizationId }
        : {}),
    ...(one('from') ? { from: one('from') } : {}),
    ...(has.length ? { has: has.join(',') } : {}),
    ...(one('before') ? { before: one('before') } : {}),
    ...(one('after') ? { after: one('after') } : {}),
    ...(one('during') ? { during: one('during') } : {}),
    ...(options.sort !== 'newest' ? { sort: options.sort } : {}),
    ...(options.page > 1 ? { page: options.page } : {}),
  };
}

/** A search as one line, for History and chips' screen-reader names: `deploy from: Ada has: link`. */
export const describeSearch = (state: SearchState) =>
  [state.text.trim(), ...state.filters.map(filter => `${filter.key}: ${filter.label}`)].filter(Boolean).join(' ');

export const HISTORY_KEY = 'swarm.search-history';
const HISTORY_SIZE = 8;
/** Recent searches kept by this browser (never sent anywhere): newest first, without repeats. */
export function parseHistory(raw: string | null): SearchState[] {
  if (!raw || raw.length > 20_000) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is SearchState =>
          typeof item?.text === 'string' &&
          Array.isArray(item.filters) &&
          item.filters.every(
            (filter: Filter) =>
              isKey(filter?.key) && typeof filter.value === 'string' && typeof filter.label === 'string',
          ),
      )
      .slice(0, HISTORY_SIZE);
  } catch {
    return [];
  }
}
export function rememberSearch(history: SearchState[], state: SearchState): SearchState[] {
  const entry = { text: state.text.trim(), filters: state.filters };
  if (!searchable(entry)) return history;
  const key = describeSearch(entry);
  return [entry, ...history.filter(item => describeSearch(item) !== key)].slice(0, HISTORY_SIZE);
}

/** Text split at its matched ranges, for <mark>. */
export function highlightParts(text: string, ranges: { start: number; end: number }[]) {
  const parts: { text: string; match: boolean }[] = [];
  let at = 0;
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const start = Math.max(at, range.start),
      end = Math.min(text.length, range.end);
    if (end <= start) continue;
    if (start > at) parts.push({ text: text.slice(at, start), match: false });
    parts.push({ text: text.slice(start, end), match: true });
    at = end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), match: false });
  return parts;
}

/** Page buttons: the first, the last, and the current one with its neighbours; gaps become ellipses. */
export function pageItems(current: number, pages: number): (number | 'gap')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const shown = new Set([1, pages, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4].forEach(page => shown.add(page));
  if (current >= pages - 2) [pages - 3, pages - 2, pages - 1].forEach(page => shown.add(page));
  const sorted = [...shown].filter(page => page >= 1 && page <= pages).sort((a, b) => a - b);
  return sorted.flatMap((page, index) => (index && page - sorted[index - 1]! > 1 ? ['gap' as const, page] : [page]));
}
