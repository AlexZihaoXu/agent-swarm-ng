import { Type } from '@sinclair/typebox';

/** A history route's `around`: reach back to this message (a search result's Jump; see history-around.ts). */
export const AroundParam = Type.String({
  minLength: 1,
  maxLength: 64,
  description: 'Reach back to this message (with a few before it), at most 200 per page; ignores limit.',
});
