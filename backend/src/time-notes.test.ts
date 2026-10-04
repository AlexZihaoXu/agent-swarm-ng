import { expect, it } from 'vitest';
import { timeNoteFor } from './time-notes';

it('gives one note per clock-aligned window, always with the current time', () => {
  const at = (iso: string) => new Date(iso);
  // 9:38 in Toronto (13:38 UTC), nothing yet in the 9:30–9:45 window: a note saying 9:38, not 9:30.
  const first = timeNoteFor(at('2026-10-05T13:38:20Z'), 15, 'America/Toronto', undefined)!;
  expect(first.text).toContain('9:38 AM');
  expect(first.text).toContain('America/Toronto; 13:38 UTC');
  // 9:44: same window, no note. 9:45: a new window.
  expect(timeNoteFor(at('2026-10-05T13:44:59Z'), 15, 'America/Toronto', first.window)).toBeNull();
  const next = timeNoteFor(at('2026-10-05T13:45:01Z'), 15, 'America/Toronto', first.window)!;
  expect(next.text).toContain('9:45 AM');
  // Hourly windows: 9:59 shares 9:00's window; 10:00 starts the next.
  const hour = timeNoteFor(at('2026-10-05T13:05:00Z'), 60, 'America/Toronto', undefined)!;
  expect(timeNoteFor(at('2026-10-05T13:59:00Z'), 60, 'America/Toronto', hour.window)).toBeNull();
  expect(timeNoteFor(at('2026-10-05T14:00:00Z'), 60, 'America/Toronto', hour.window)).not.toBeNull();
  // The same clock time on another day is another window; off gives nothing.
  expect(timeNoteFor(at('2026-10-06T13:38:20Z'), 15, 'America/Toronto', first.window)).not.toBeNull();
  expect(timeNoteFor(at('2026-10-05T13:38:20Z'), 0, 'America/Toronto', undefined)).toBeNull();
  // Clocks go back (Toronto, 1 November 2026): 1:10 EDT and 1:20 EST share a clock hour but not a window.
  const edt = timeNoteFor(at('2026-11-01T05:10:00Z'), 60, 'America/Toronto', undefined)!;
  expect(edt.text).toContain('1:10 AM');
  const est = timeNoteFor(at('2026-11-01T06:20:00Z'), 60, 'America/Toronto', edt.window)!;
  expect(est.text).toContain('1:20 AM');
});
