/** One place for every timestamp the interface shows, so lists, bubbles and groups agree in every locale. */
export const clockTime = (timestamp: number, locale?: string) =>
  new Date(timestamp).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }).replace(/\s+/g, ' ');

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** Sidebar rows: the time today, then "Yesterday", the weekday within a week, and finally the date. */
export function listTime(timestamp: number, now: Date = new Date(), locale?: string) {
  const days = Math.round((startOfDay(now) - startOfDay(new Date(timestamp))) / 86_400_000);
  if (days === 0) return clockTime(timestamp, locale);
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return new Date(timestamp).toLocaleDateString(locale, { weekday: 'short' });
  const date = new Date(timestamp);
  return date.toLocaleDateString(
    locale,
    date.getFullYear() === now.getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' },
  );
}

/** Messages this close to the previous one share its time label. */
export const MESSAGE_TIME_GAP = 5 * 60 * 1000;

/** A chat time label: the time today, otherwise the date and time (with the year when it is not this year). */
export function messageTime(timestamp: number, now: Date = new Date(), locale?: string) {
  const date = new Date(timestamp);
  if (startOfDay(date) === startOfDay(now)) return clockTime(timestamp, locale);
  const day = date.toLocaleDateString(
    locale,
    date.getFullYear() === now.getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' },
  );
  return `${day}, ${clockTime(timestamp, locale)}`;
}
