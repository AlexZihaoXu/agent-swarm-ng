/** Operator-authored reference data. Agent memory and tool permissions live elsewhere. */
export type KnowledgeEntry = Readonly<{
  id: string;
  parentId: string | null;
  title: string;
  summary: string;
  source: string;
  content: string;
  /** Entries to read alongside this one (a concept's practices, a practice's concepts). */
  related?: readonly string[];
}>;
/** Where an entry used to be: old IDs keep resolving after a reorganisation. */
export type KnowledgeAliases = Readonly<Record<string, string>>;
type Link = { id: string; title: string; summary: string };
const mentioned = /[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)+/g;

type Page = { offset?: number; limit?: number };
const idPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*$/;

function bounded(value: number | undefined, fallback: number, max: number, name: string) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < (name === 'offset' ? 0 : 1) || result > max)
    throw new Error(`Invalid ${name}.`);
  return result;
}

export class KnowledgeCatalog {
  readonly #entries = new Map<string, KnowledgeEntry>();
  readonly #children = new Map<string | null, KnowledgeEntry[]>();
  readonly #aliases: KnowledgeAliases;
  readonly #links = new Map<string, Link[]>();

  constructor(entries: readonly KnowledgeEntry[], aliases: KnowledgeAliases = {}) {
    if (entries.length > 500) throw new Error('Too many knowledge entries.');
    for (const entry of entries) {
      if (
        !idPattern.test(entry.id) ||
        entry.id.length > 120 ||
        !entry.title.trim() ||
        entry.title.length > 120 ||
        !entry.summary.trim() ||
        entry.summary.length > 300 ||
        !entry.source.trim() ||
        entry.source.length > 256 ||
        !entry.content.trim() ||
        entry.content.length > 100_000
      )
        throw new Error(`Invalid knowledge entry: ${entry.id}`);
      if (this.#entries.has(entry.id)) throw new Error(`Duplicate knowledge ID: ${entry.id}`);
      this.#entries.set(entry.id, Object.freeze({ ...entry }));
    }
    for (const entry of this.#entries.values()) {
      if (entry.parentId !== null && !this.#entries.has(entry.parentId))
        throw new Error(`Missing parent for ${entry.id}`);
      const related = entry.related ?? [];
      if (related.length > 16 || related.some(id => id === entry.id || !this.#entries.has(id)))
        throw new Error(`Invalid related entries for ${entry.id}`);
    }
    for (const [from, to] of Object.entries(aliases))
      if (this.#entries.has(from) || !this.#entries.has(to)) throw new Error(`Invalid knowledge alias: ${from}`);
    this.#aliases = aliases;
    // Links: the explicit related entries first, then every entry the text mentions by ID.
    for (const entry of this.#entries.values()) {
      const ids = new Set(entry.related ?? []);
      for (const [id] of entry.content.matchAll(mentioned)) {
        const target = this.#entries.has(id) ? id : aliases[id];
        if (target && target !== entry.id) ids.add(target);
      }
      this.#links.set(
        entry.id,
        [...ids].map(id => {
          const target = this.#entries.get(id)!;
          return { id, title: target.title, summary: target.summary };
        }),
      );
    }
    const visited = new Set<string>(),
      visiting = new Set<string>();
    const visit = (id: string) => {
      if (visiting.has(id)) throw new Error(`Knowledge cycle at ${id}`);
      if (visited.has(id)) return;
      visiting.add(id);
      const parent = this.#entries.get(id)!.parentId;
      if (parent !== null) visit(parent);
      visiting.delete(id);
      visited.add(id);
    };
    for (const entry of this.#entries.values()) visit(entry.id);
    for (const entry of this.#entries.values()) {
      const siblings = this.#children.get(entry.parentId) ?? [];
      siblings.push(entry);
      this.#children.set(entry.parentId, siblings);
    }
    for (const siblings of this.#children.values()) siblings.sort((a, b) => a.id.localeCompare(b.id));
  }

  #summary(entry: KnowledgeEntry) {
    return {
      id: entry.id,
      title: entry.title,
      summary: entry.summary,
      source: entry.source,
      hasChildren: Boolean(this.#children.get(entry.id)?.length),
    };
  }

  /** An entry ID, following an alias from before a reorganisation. */
  resolve(id: string) {
    return this.#entries.has(id) ? id : this.#aliases[id];
  }

  list({ parentId: requested = null, offset, limit }: Page & { parentId?: string | null } = {}) {
    const parentId = requested === null ? null : (this.resolve(requested) ?? requested);
    if (parentId !== null && !this.#entries.has(parentId)) throw new Error('Knowledge entry not found.');
    const from = bounded(offset, 0, 500, 'offset'),
      size = bounded(limit, 20, 20, 'limit');
    const siblings = this.#children.get(parentId) ?? [];
    if (from > siblings.length) throw new Error('Invalid offset.');
    const entries = siblings.slice(from, from + size).map(entry => this.#summary(entry));
    return { parentId, entries, nextOffset: from + size < siblings.length ? from + size : null };
  }

  search({ query, offset, limit }: Page & { query: string }) {
    if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new Error('Invalid query.');
    const from = bounded(offset, 0, 500, 'offset'),
      size = bounded(limit, 10, 20, 'limit');
    const term = query.trim().toLowerCase();
    const hits = [...this.#entries.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .flatMap(entry => {
        const index = entry.content.toLowerCase().indexOf(term);
        if (index < 0 && !`${entry.title} ${entry.summary}`.toLowerCase().includes(term)) return [];
        const start = Math.max(0, index < 0 ? 0 : index - 60);
        return [
          { ...this.#summary(entry), snippet: (index < 0 ? entry.summary : entry.content).slice(start, start + 200) },
        ];
      });
    if (from > hits.length) throw new Error('Invalid offset.');
    return {
      query: query.trim(),
      matches: hits.slice(from, from + size),
      nextOffset: from + size < hits.length ? from + size : null,
    };
  }

  read({ id: requested, offset, length }: { id: string; offset?: number; length?: number }) {
    const id = this.resolve(requested) ?? requested;
    const entry = this.#entries.get(id);
    if (!entry) throw new Error('Knowledge entry not found.');
    const from = bounded(offset, 0, entry.content.length, 'offset'),
      size = bounded(length, 4000, 6000, 'length');
    const text = entry.content.slice(from, from + size);
    const breadcrumbs: { id: string; title: string }[] = [];
    let ancestor: KnowledgeEntry | undefined = entry;
    while (ancestor) {
      breadcrumbs.unshift({ id: ancestor.id, title: ancestor.title });
      ancestor = ancestor.parentId === null ? undefined : this.#entries.get(ancestor.parentId);
    }
    return {
      ...this.#summary(entry),
      parentId: entry.parentId,
      breadcrumbs,
      ...(id !== requested ? { movedFrom: requested } : {}),
      related: this.#links.get(entry.id) ?? [],
      text,
      offset: from,
      totalCharacters: entry.content.length,
      nextOffset: from + text.length < entry.content.length ? from + text.length : null,
    };
  }
}
