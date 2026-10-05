/** Messages kept before the target of a jump, so it does not open at the very top of the screen. */
export const AROUND_CONTEXT = 10;
/** The most messages one jump request returns; a farther jump asks again from the returned cursor. */
export const AROUND_PAGE = 200;

/**
 * The history page that reaches back to a message (a search result's Jump, docs/chat-and-groups.md#search): every
 * message from a few before the target up to `before` (exclusive, or the latest), at most AROUND_PAGE of the newest
 * of them. History is held from the latest backwards, so a client asks again with the returned cursor until it
 * holds the target; `nextCursor` is the usual older-history cursor. `find` reads one conversation's messages.
 */
export async function historyAround<T extends { sequence: number }>(
  target: number,
  before: number | undefined,
  find: (range: { gte?: number; lt?: number }, order: 'asc' | 'desc', take: number) => Promise<T[]>,
) {
  const earlier = await find({ lt: target }, 'desc', AROUND_CONTEXT);
  const floor = earlier.at(-1)?.sequence ?? target;
  const rows = await find({ gte: floor, ...(before === undefined ? {} : { lt: before }) }, 'desc', AROUND_PAGE + 1);
  const messages = rows.slice(0, AROUND_PAGE).reverse();
  // Nothing between (the client already holds the target): the cursor stays where it was.
  const first = messages[0]?.sequence ?? before;
  if (first === undefined) return { messages, nextCursor: null };
  const more = rows.length > AROUND_PAGE || (await find({ lt: first }, 'desc', 1)).length > 0;
  return { messages, nextCursor: more ? first : null };
}
