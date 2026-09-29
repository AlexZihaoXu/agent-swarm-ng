import { expect, it } from 'vitest';
import { clockTime, listTime, messageTime } from './format-time';

const now = new Date(2026, 8, 28, 15, 0); // Monday 28 September 2026, 3 pm
const at = (year: number, month: number, day: number, hour = 9, minute = 5) =>
  new Date(year, month, day, hour, minute).getTime();
it('shows time today and a day label afterwards, so old conversations do not look like today', () => {
  expect(listTime(at(2026, 8, 28, 3, 23), now, 'en-US')).toBe('3:23 AM');
  expect(listTime(at(2026, 8, 27, 23, 59), now, 'en-US')).toBe('Yesterday');
  expect(listTime(at(2026, 8, 24), now, 'en-US')).toBe('Thu');
  expect(listTime(at(2026, 8, 21), now, 'en-US')).toBe('Sep 21'); // a full week ago is a date, not a weekday
  expect(listTime(at(2026, 0, 3), now, 'en-US')).toBe('Jan 3');
  expect(listTime(at(2025, 11, 31), now, 'en-US')).toBe('Dec 31, 2025');
  expect(listTime(at(2030, 0, 1), now, 'en-US')).toBe('Jan 1, 2030'); // clock skew never reads as "today"
});
it("uses the viewer's locale for clock times (24-hour where that is the convention)", () => {
  expect(clockTime(at(2026, 8, 28, 15, 7), 'en-US')).toBe('3:07 PM');
  expect(clockTime(at(2026, 8, 28, 15, 7), 'de-DE')).toBe('15:07');
});
it('labels chat times with the date unless they are from today', () => {
  const now = new Date(at(2026, 8, 28, 18, 0));
  expect(messageTime(at(2026, 8, 28, 15, 7), now, 'en-US')).toBe('3:07 PM');
  expect(messageTime(at(2026, 8, 27, 15, 7), now, 'en-US')).toBe('Sep 27, 3:07 PM');
  expect(messageTime(at(2025, 8, 27, 15, 7), now, 'en-US')).toBe('Sep 27, 2025, 3:07 PM');
});
