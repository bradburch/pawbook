import { addDays, nightsBetween, parseDateToUtcNoon, PACIFIC } from './dates.js';
export { PACIFIC };

/** Format a date-only string as a Pacific-time calendar date. */
function fmt(dateStr: string, opts: Intl.DateTimeFormatOptions): string {
  return parseDateToUtcNoon(dateStr).toLocaleDateString('en-US', { ...opts, timeZone: PACIFIC });
}

/** e.g. "Jun 7, 2026" */
export function formatDate(dateStr: string): string {
  return fmt(dateStr, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Time-of-day from a full ISO/datetime string, e.g. "9:00 AM" */
export function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: PACIFIC,
  });
}

/** e.g. "June 2026" */
export function formatMonthYear(dateStr: string): string {
  return fmt(dateStr, { month: 'long', year: 'numeric' });
}

/** e.g. "Jun 7" — falls back to the raw string if parsing throws. */
export function formatShortDate(dateStr: string): string {
  try {
    return fmt(dateStr, { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

/** e.g. "June 7" — long month, no year. */
export function formatDisplay(dateStr: string): string {
  return fmt(dateStr, { month: 'long', day: 'numeric' });
}

/**
 * Humanize an end-EXCLUSIVE blocked date range for display, e.g.
 * `('2028-07-03', '2028-07-05')` → "Jul 3 – 4, 2028 · 2 days".
 * A null end (or end = start + 1) is a single day: "Jul 3, 2028 · 1 day".
 * The month is elided within one month; full dates are shown across years.
 */
export function formatBlockRange(startDate: string, endDateExclusive: string | null): string {
  const start = startDate.slice(0, 10);
  const lastDay = endDateExclusive ? addDays(endDateExclusive.slice(0, 10), -1) : start;
  if (lastDay <= start) return `${formatDate(start)} · 1 day`;
  const days = nightsBetween(start, lastDay) + 1;
  const sameYear = start.slice(0, 4) === lastDay.slice(0, 4);
  const sameMonth = sameYear && start.slice(5, 7) === lastDay.slice(5, 7);
  if (!sameYear) return `${formatDate(start)} – ${formatDate(lastDay)} · ${days} days`;
  const endPart = sameMonth ? fmt(lastDay, { day: 'numeric' }) : formatShortDate(lastDay);
  return `${formatShortDate(start)} – ${endPart}, ${start.slice(0, 4)} · ${days} days`;
}

/** Format a Date as a medium-date / short-time string in Pacific time, e.g. "Jun 9, 2026, 5:00 PM". */
export function formatPacificTimestamp(date: Date): string {
  return date.toLocaleString('en-US', {
    timeZone: PACIFIC,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
