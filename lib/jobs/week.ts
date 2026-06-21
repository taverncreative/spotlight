// Pure date helpers for the jobs scheduler week view (Phase 2, Pass 2). Every
// computation is in UTC, matching the convention the schedule form and the job
// displays already use: a stored scheduled_start is a UTC instant treated as the
// wall-clock time, formatted with timeZone: "UTC". Weeks start on Monday (the UK
// convention). There is deliberately no timezone handling beyond UTC here; a BST
// display offset is a separate decision recorded in CLAUDE.md, not solved in this
// pass. Kept pure (no Date.now, no I/O) so it is unit-testable: the caller passes
// "today" in.

export const DAYS_IN_WEEK = 7;

// Exactly one UTC day in milliseconds. UTC days are always 86_400_000 ms (no DST
// jumps), so adding days by arithmetic on the epoch keeps midnight at midnight.
const DAY_MS = 86_400_000;

// Midnight UTC of the given instant (drops the time of day).
function utcMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

export function addDaysUTC(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function addWeeksUTC(date: Date, weeks: number): Date {
  return addDaysUTC(date, weeks * DAYS_IN_WEEK);
}

// The Monday 00:00:00.000 UTC of the week containing `date`. getUTCDay is 0 (Sun)
// to 6 (Sat); Sunday belongs to the week that began the previous Monday, so it
// steps back six days, every other day steps back (day - 1).
export function startOfWeekUTC(date: Date): Date {
  const midnight = utcMidnight(date);
  const day = midnight.getUTCDay();
  const backToMonday = day === 0 ? 6 : day - 1;
  return addDaysUTC(midnight, -backToMonday);
}

// The seven day-start dates of the week beginning at weekStart (Mon to Sun).
export function weekDayStarts(weekStart: Date): Date[] {
  return Array.from({ length: DAYS_IN_WEEK }, (_, i) => addDaysUTC(weekStart, i));
}

// A week URL param is a YYYY-MM-DD date naming any day in the wanted week; an
// absent or malformed value falls back to today's week. Always returns a Monday.
export function weekStartFromParam(
  value: string | undefined,
  today: Date
): Date {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) return startOfWeekUTC(parsed);
  }
  return startOfWeekUTC(today);
}

// The YYYY-MM-DD param naming a week (its Monday), for the navigation links.
export function weekParam(weekStart: Date): string {
  return weekStart.toISOString().slice(0, 10);
}

// Two instants fall on the same UTC calendar day.
export function isSameUTCDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

// The index (0 to 6) of the day column an instant falls in, or -1 if it is
// outside the week. Used to bucket scheduled jobs into the grid.
export function dayIndexInWeek(weekStart: Date, instant: Date): number {
  const days = Math.floor(
    (utcMidnight(instant).getTime() - weekStart.getTime()) / DAY_MS
  );
  return days >= 0 && days < DAYS_IN_WEEK ? days : -1;
}

const RANGE_FULL = {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
} as const;

// A human week range collapsing the shared month/year, en-GB. The dash is an en
// dash (the correct glyph for a range), not an em dash. Examples:
//   "23–29 June 2026"            (same month)
//   "29 June–5 July 2026"        (same year, different month)
//   "29 December 2025–4 January 2026" (different year)
export function formatWeekRange(weekStart: Date): string {
  const end = addDaysUTC(weekStart, DAYS_IN_WEEK - 1);
  const endLabel = end.toLocaleDateString("en-GB", RANGE_FULL);

  const sameMonth =
    weekStart.getUTCFullYear() === end.getUTCFullYear() &&
    weekStart.getUTCMonth() === end.getUTCMonth();
  if (sameMonth) {
    return `${weekStart.getUTCDate()}–${endLabel}`;
  }

  const sameYear = weekStart.getUTCFullYear() === end.getUTCFullYear();
  const startLabel = weekStart.toLocaleDateString(
    "en-GB",
    sameYear
      ? { day: "numeric", month: "long", timeZone: "UTC" }
      : RANGE_FULL
  );
  return `${startLabel}–${endLabel}`;
}

// A day-column heading: the short weekday and the day-and-month, e.g. "Mon" and
// "23 Jun". Returned as a pair so the view can stack them.
export function formatDayHeading(date: Date): { weekday: string; date: string } {
  return {
    weekday: date.toLocaleDateString("en-GB", {
      weekday: "short",
      timeZone: "UTC",
    }),
    date: date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }),
  };
}

// The wall-clock time of a scheduled instant, formatted at UTC (the stored
// convention), e.g. "09:00".
export function formatScheduledTime(value: string): string {
  return new Date(value).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}
