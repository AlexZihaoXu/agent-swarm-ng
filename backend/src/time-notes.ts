/**
 * Time notes (docs/agent-time.md#time-notes): while an agent works, it gets one note of the current time per
 * clock-aligned window (every 15 minutes by default: :00, :15, :30, :45), stacked before its next model call (in the
 * turn's input, or after a tool result), never interrupting. The owner sets the window per agent, or turns it off.
 */
export const TIME_NOTE_CHOICES = [0, 1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60] as const;
export const TIME_NOTE_DEFAULT = 15;

/** The platform's zone: the one heartbeats and active hours use. */
export const platformZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The zone's offset from UTC at that moment, in minutes ("GMT-04:00" → -240). */
export function offsetMinutes(now: Date, zone: string) {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(now)
      .find(part => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
}

/**
 * The note due now, or null when the window already had one (or notes are off). The window is the N-minute slot of
 * the local clock, named with the UTC offset too: the hour repeated when clocks go back is a new window.
 */
export function timeNoteFor(now: Date, minutes: number, zone: string, lastWindow: string | undefined) {
  if (!minutes || minutes <= 0) return null;
  const offset = offsetMinutes(now, zone);
  const local = Math.floor(now.getTime() / 60_000) + offset;
  const window = `${minutes}:${offset}:${Math.floor(local / minutes)}`;
  if (window === lastWindow) return null;
  const shown = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(now);
  const utc = now.toISOString().slice(11, 16);
  return {
    window,
    text: `[Time note from the platform (not a message): it is now ${shown} (${zone}; ${utc} UTC).]`,
  };
}

/**
 * An IANA zone name the runtime knows, in its standard form ("america/toronto" → "America/Toronto"), or null. Offsets
 * ("+05:00") are refused: a zone follows its daylight-saving rules, an offset does not.
 */
export function canonicalTimeZone(zone: string) {
  if (/^[+-]\d/.test(zone.trim())) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone.trim() }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}
