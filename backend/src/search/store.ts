import type { PlatformStore } from '../platform-store';
import { offsetMinutes } from '../time-notes';

/**
 * Message search (docs/chat-and-groups.md#search): private chats, groups and agent↔agent DMs, through the FTS5
 * indexes of migration 20261005030000_message_search. Callers resolve what the person may read into a `Scope`
 * first; every query here stays inside it.
 */
export const PAGE_SIZE = 25;
/** Counting stops here: more is shown as "1000+", and pages end at 40. */
export const COUNT_CAP = 1000;
export const MAX_PAGE = COUNT_CAP / PAGE_SIZE;
/** Snippets: a message longer than this shows a window around its first match. */
const SNIPPET = 320;
const SNIPPET_LEAD = 100;

export type Kind = 'chat' | 'group' | 'dm';
/**
 * What a search may read. A single conversation, or every conversation in these organizations (null: all of them,
 * admin only). A DM is in scope only when both of its agents are.
 */
export type Scope =
  | {
      conversation:
        { kind: 'chat'; channelId: string } | { kind: 'group'; groupId: string } | { kind: 'dm'; key: string };
    }
  | { organizations: string[] | null };

export type SearchFilters = {
  text?: string;
  /** "you": written by people; otherwise an agent's id. */
  from?: { kind: 'people' } | { kind: 'agent'; id: string };
  has?: ('file' | 'image' | 'link')[];
  /** createdAt >= since, createdAt < until. */
  since?: Date;
  until?: Date;
  sort: 'newest' | 'oldest';
  page: number;
};

/**
 * The FTS5 query for what the person typed: each word matches as a word prefix ("deplo" finds "deployed"), a
 * "quoted phrase" matches those words in order, and all must match. Words are quoted, so nothing typed is an
 * FTS5 operator. Null when nothing searchable is left (only punctuation).
 */
/** Shortest term the trigram index can match; shorter ones (e.g. two Chinese characters) are matched with LIKE. */
export const TRIGRAM = 3;

/**
 * A search box's text as terms: words and "quoted phrases", each matched as a substring anywhere in a message's text
 * (any language: the index is trigram, so "amd" finds "我要换amd了"). Terms of 3+ characters use the index (`match`,
 * all required); shorter ones are matched with LIKE (`likes`). Null when nothing searchable is left.
 */
export function ftsQuery(text: string) {
  const terms: string[] = [];
  for (const found of text.matchAll(/"([^"]*)"|(\S+)/g)) {
    // Control characters (NUL above all) cannot be part of an FTS5 phrase.
    const value = (found[1] ?? found[2]!).replace(/["\p{Cc}]/gu, ' ').trim();
    if (!/[\p{L}\p{N}]/u.test(value)) continue;
    terms.push(value);
    if (terms.length >= 16) break;
  }
  if (!terms.length) return null;
  const long = terms.filter(term => [...term].length >= TRIGRAM);
  return {
    terms,
    match: long.length ? long.map(term => `"${term}"`).join(' ') : null,
    likes: terms.filter(term => [...term].length < TRIGRAM),
  };
}
export type Query = NonNullable<ReturnType<typeof ftsQuery>>;

/** Where each term occurs in a message's text (case-insensitive), merged and in order. */
export function termRanges(text: string, terms: string[]) {
  // Lowercased one code unit at a time, keeping any unit whose lowercase is longer ("İ"), so offsets stay the text's.
  let lower = '';
  for (const unit of text) {
    const folded = unit.toLowerCase();
    lower += folded.length === unit.length ? folded : unit;
  }
  const found: { start: number; end: number }[] = [];
  for (const term of terms) {
    const needle = term.toLowerCase();
    if (!needle) continue;
    for (let at = lower.indexOf(needle); at >= 0 && found.length < 200; at = lower.indexOf(needle, at + needle.length))
      found.push({ start: at, end: at + needle.length });
  }
  found.sort((a, b) => a.start - b.start);
  const merged: typeof found = [];
  for (const range of found) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export type Snippet = {
  text: string;
  ranges: { start: number; end: number }[];
  clippedStart: boolean;
  clippedEnd: boolean;
};
/**
 * A result's text with where the search terms occur (none without a text query). Long messages show a window
 * starting a little before the first match.
 */
export function snippetOf(text: string, terms: string[] = []): Snippet {
  const ranges = termRanges(text, terms);
  if (text.length <= SNIPPET) return { text, ranges, clippedStart: false, clippedEnd: false };
  let from = Math.max(0, (ranges[0]?.start ?? 0) - SNIPPET_LEAD);
  // Start at a word boundary where one is near.
  const space = text.lastIndexOf(' ', from);
  if (from > 0 && space >= 0 && from - space < 20) from = space + 1;
  let to = Math.min(text.length, from + SNIPPET);
  // Never split a surrogate pair (an emoji, a rare character) at the window's edges.
  if (from > 0 && /[\uDC00-\uDFFF]/.test(text[from] ?? '')) from--;
  if (to < text.length && /[\uDC00-\uDFFF]/.test(text[to] ?? '')) to++;
  return {
    text: text.slice(from, to),
    ranges: ranges
      .filter(range => range.end > from && range.start < to)
      .map(range => ({ start: Math.max(range.start, from) - from, end: Math.min(range.end, to) - from })),
    clippedStart: from > 0,
    clippedEnd: to < text.length,
  };
}

type Source = { kind: Kind; fts: string; sql: string; params: unknown[] };
type Hit = { kind: Kind; sequence: number };

/** Midnight starting a calendar day ("2026-10-05") in a time zone, as an instant. */
export function dayStart(day: string, zone: string) {
  const [year, month, date] = day.split('-').map(Number);
  const midnight = Date.UTC(year!, month! - 1, date!);
  // The zone's offset at the guess, then again at the result (a daylight-saving change near midnight).
  let at = midnight - offsetMinutes(new Date(midnight), zone) * 60_000;
  at = midnight - offsetMinutes(new Date(at), zone) * 60_000;
  return new Date(at);
}

export class MessageSearch {
  constructor(private readonly platform: PlatformStore) {}

  /** Each message table's part of the query: its rows in scope that pass the filters, or null when none can. */
  private sources(scope: Scope, filters: SearchFilters, query: Query | null): Source[] {
    const orgs = 'organizations' in scope ? scope.organizations : undefined;
    const inOrgs = (column: string, params: unknown[]) => {
      if (!orgs) return '';
      params.push(JSON.stringify(orgs));
      return ` AND ${column} IN (SELECT value FROM json_each(?))`;
    };
    const conversation = 'conversation' in scope ? scope.conversation : undefined;
    const sources: Source[] = [];
    const common = (alias: string, kind: Kind, fts: string, params: unknown[]) => {
      let sql = '';
      if (query?.match) {
        sql += ` AND ${alias}."sequence" IN (SELECT rowid FROM "${fts}" WHERE "${fts}" MATCH ?)`;
        params.push(query.match);
      }
      // Terms too short for the trigram index: a plain substring match, on rows already narrowed by the rest.
      for (const term of query?.likes ?? []) {
        sql += ` AND ${alias}."text" LIKE ? ESCAPE '\\'`;
        params.push(`%${term.replace(/[\\%_]/g, char => `\\${char}`)}%`);
      }
      if (filters.since) {
        sql += ` AND ${alias}."createdAt" >= ?`;
        // createdAt is stored as "…+00:00": compare in the same form ("Z" sorts after "+", off by a midnight).
        params.push(filters.since.toISOString().replace('Z', '+00:00'));
      }
      if (filters.until) {
        sql += ` AND ${alias}."createdAt" < ?`;
        params.push(filters.until.toISOString().replace('Z', '+00:00'));
      }
      for (const has of filters.has ?? []) {
        if (has === 'link') sql += ` AND (${alias}."text" LIKE '%http://%' OR ${alias}."text" LIKE '%https://%')`;
        // Files deleted from the chat (tombstones) do not count.
        else
          sql += ` AND EXISTS (SELECT 1 FROM "ChannelFile" f WHERE f."messageKind" = '${kind}' AND f."messageId" = ${alias}."id" AND f."status" = 'available'${has === 'image' ? ` AND f."kind" = 'image'` : ''})`;
      }
      return sql;
    };
    const from = filters.from;

    if (!conversation || conversation.kind === 'chat') {
      const params: unknown[] = [];
      let sql = `SELECT 'chat' AS "kind", m."sequence" AS "sequence", m."createdAt" AS "createdAt" FROM "Message" m
        JOIN "Channel" c ON c."id" = m."channelId" JOIN "Agent" a ON a."id" = c."agentId" WHERE c."kind" = 'platform-chat'`;
      if (conversation?.kind === 'chat') {
        sql += ` AND m."channelId" = ?`;
        params.push(conversation.channelId);
      }
      sql += inOrgs('a."organizationId"', params);
      if (from?.kind === 'people') sql += ` AND m."role" = 'user'`;
      if (from?.kind === 'agent') {
        sql += ` AND m."role" = 'assistant' AND c."agentId" = ?`;
        params.push(from.id);
      }
      sql += common('m', 'chat', 'MessageSearch', params);
      sources.push({ kind: 'chat', fts: 'MessageSearch', sql, params });
    }
    if (!conversation || conversation.kind === 'group') {
      const params: unknown[] = [];
      let sql = `SELECT 'group' AS "kind", g."sequence" AS "sequence", g."createdAt" AS "createdAt" FROM "GroupMessage" g
        JOIN "GroupChat" gc ON gc."id" = g."groupId" WHERE 1`;
      if (conversation?.kind === 'group') {
        sql += ` AND g."groupId" = ?`;
        params.push(conversation.groupId);
      }
      sql += inOrgs('gc."organizationId"', params);
      if (from?.kind === 'people') sql += ` AND g."role" = 'user'`;
      if (from?.kind === 'agent') {
        sql += ` AND g."role" = 'assistant' AND g."authorId" = ?`;
        params.push(from.id);
      }
      sql += common('g', 'group', 'GroupMessageSearch', params);
      sources.push({ kind: 'group', fts: 'GroupMessageSearch', sql, params });
    }
    // Agent↔agent DMs have no human side: from:you finds none there.
    if ((!conversation || conversation.kind === 'dm') && from?.kind !== 'people') {
      const params: unknown[] = [];
      let sql = `SELECT 'dm' AS "kind", d."sequence" AS "sequence", d."createdAt" AS "createdAt" FROM "DmMessage" d
        JOIN "Agent" s ON s."id" = d."senderId" JOIN "Agent" r ON r."id" = d."recipientId" WHERE 1`;
      if (conversation?.kind === 'dm') {
        sql += ` AND d."conversationId" = ?`;
        params.push(conversation.key);
      }
      sql += inOrgs('s."organizationId"', params) + inOrgs('r."organizationId"', params);
      if (from?.kind === 'agent') {
        sql += ` AND d."senderId" = ?`;
        params.push(from.id);
      }
      sql += common('d', 'dm', 'DmMessageSearch', params);
      sources.push({ kind: 'dm', fts: 'DmMessageSearch', sql, params });
    }
    return sources;
  }

  /**
   * Applies the changes the triggers queued to the indexes, in order (an FTS5 'delete' needs the text that was
   * indexed, which the queue keeps). Searches call it first, and the backend every few minutes so the queue stays
   * short. A busy database (another writer) is retried briefly; failing that, this search may miss the newest changes.
   */
  async sync() {
    await this.platform.initialize();
    const client = this.platform.client;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const [{ max }] = await client.$queryRawUnsafe<{ max: number | bigint | null }[]>(
          `SELECT max("id") AS "max" FROM "MessageSearchQueue"`,
        );
        if (max === null) return;
        const upTo = Number(max);
        await client.$transaction([
          ...(
            [
              ['chat', 'MessageSearch'],
              ['group', 'GroupMessageSearch'],
              ['dm', 'DmMessageSearch'],
            ] as const
          ).map(([source, fts]) =>
            client.$executeRawUnsafe(
              `INSERT INTO "${fts}"("${fts}", rowid, "text")
               SELECT CASE "op" WHEN 'delete' THEN 'delete' END, "row", "text" FROM "MessageSearchQueue"
               WHERE "source" = ? AND "id" <= ? ORDER BY "id"`,
              source,
              upTo,
            ),
          ),
          client.$executeRawUnsafe(`DELETE FROM "MessageSearchQueue" WHERE "id" <= ?`, upTo),
        ]);
        return;
      } catch (error) {
        if (attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
  }

  /**
   * One page of matches (newest or oldest first) and how many there are, counted up to COUNT_CAP + 1. Each table
   * contributes at most the rows up to the end of the page, so a page never sorts more than 3 × 1000 rows.
   */
  async search(scope: Scope, filters: SearchFilters) {
    await this.platform.initialize();
    await this.sync().catch(() => {});
    const query = filters.text?.trim() ? ftsQuery(filters.text) : null;
    if (filters.text?.trim() && !query) return { total: 0, hits: [] as Hit[], terms: [] as string[] };
    const sources = this.sources(scope, filters, query);
    if (!sources.length) return { total: 0, hits: [] as Hit[], terms: [] as string[] };
    const client = this.platform.client;
    const direction = filters.sort === 'oldest' ? 'ASC' : 'DESC';
    const page = Math.min(Math.max(1, filters.page), MAX_PAGE);
    const offset = (page - 1) * PAGE_SIZE;
    const order = `"createdAt" ${direction}, "sequence" ${direction}`;
    const union = sources
      .map(source => `SELECT * FROM (${source.sql} ORDER BY ${order} LIMIT ${offset + PAGE_SIZE})`)
      .join(' UNION ALL ');
    const counts = sources
      .map(source => `SELECT count(*) AS "n" FROM (${source.sql} LIMIT ${COUNT_CAP + 1})`)
      .join(' UNION ALL ');
    const params = sources.flatMap(source => source.params);
    const [hits, counted] = await Promise.all([
      client.$queryRawUnsafe<Hit[]>(
        `SELECT * FROM (${union}) ORDER BY ${order}, "kind" LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
        ...params,
      ),
      client.$queryRawUnsafe<{ n: number | bigint }[]>(counts, ...params),
    ]);
    const total = Math.min(
      COUNT_CAP + 1,
      counted.reduce((sum, row) => sum + Number(row.n), 0),
    );
    return {
      total,
      hits: hits.map(hit => ({ kind: hit.kind, sequence: Number(hit.sequence) })),
      terms: query?.terms ?? [],
    };
  }
}
