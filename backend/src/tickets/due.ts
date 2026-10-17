import { offsetMinutes } from '../time-notes';

/**
 * Due dates (docs/tickets.md#due-dates): a calendar day, `YYYY-MM-DD`, in the organization owner's time zone. The
 * assigned agent is reminded when that day starts there; people see it overdue once the day has passed.
 */
export function cleanDueDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  const [year, month, day] = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!match || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || year < 2000 || year > 2200)
    return null;
  return value.trim();
}

/** The moment `date` (YYYY-MM-DD) starts in `zone`: local midnight, found from the zone's offset around it. */
export function dayStart(date: string, zone: string) {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const midnight = Date.UTC(year, month - 1, day);
  // The offset at local midnight: guess with the offset at UTC midnight, then once more with the guess's offset.
  let at = midnight - offsetMinutes(new Date(midnight), zone) * 60_000;
  at = midnight - offsetMinutes(new Date(at), zone) * 60_000;
  return new Date(at);
}

/** Today's date (YYYY-MM-DD) in `zone`. */
export function today(now: Date, zone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    now,
  );
}
