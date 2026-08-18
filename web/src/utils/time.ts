/** Always renders 12-hour clock time with AM/PM, regardless of the browser/OS locale or 24-hour
 * clock setting — native Intl formatting (and native <input type="time">) both defer to the
 * device's own time-format preference, which on many phones/OSes defaults to 24-hour even in a
 * 12-hour-speaking region. Explicit hour12 avoids that. */
const TIME_FORMAT = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
const DATETIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

export function formatClockTime(value: string | Date): string {
  return TIME_FORMAT.format(new Date(value));
}

export function formatDateTime(value: string | Date): string {
  return DATETIME_FORMAT.format(new Date(value));
}

/** Formats a bare "HH:MM" or "HH:MM:SS" 24-hour string (e.g. from a DB TIME column) as 12-hour
 * AM/PM — these aren't full dates, so Intl can't be pointed at a Date object for them directly. */
export function formatTimeOfDay(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}
