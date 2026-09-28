/** Operator-authored reference data. Agent memory and tool permissions live elsewhere. */
export type KnowledgeEntry = Readonly<{
  id: string;
  parentId: string | null;
  title: string;
  summary: string;
  source: string;
  content: string;
}>;

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

  constructor(entries: readonly KnowledgeEntry[]) {
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

  list({ parentId = null, offset, limit }: Page & { parentId?: string | null } = {}) {
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

  read({ id, offset, length }: { id: string; offset?: number; length?: number }) {
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
      text,
      offset: from,
      totalCharacters: entry.content.length,
      nextOffset: from + text.length < entry.content.length ? from + text.length : null,
    };
  }
}
