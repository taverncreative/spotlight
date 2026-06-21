// The pure recurrence rule engine for jobs (Phase 2, recurrence pass). Given a
// repeat rule and a generation horizon it produces the occurrence instants. It is
// pure (no Date.now, no I/O) so it is unit-tested hard (npm run test:rule-engine);
// the server-side generation in the actions calls it then filters and stamps real
// job rows.
//
// Everything is computed in UTC, matching the convention scheduled_start is
// stored and displayed in (lib/jobs/week.ts): the anchor carries the time of day,
// and that time of day is preserved on every occurrence.

export const RECURRENCE_FREQUENCIES = [
  "daily",
  "weekly",
  "monthly",
  "yearly",
] as const;

export type Frequency = (typeof RECURRENCE_FREQUENCIES)[number];

export type RecurrenceRule = {
  frequency: Frequency;
  // Every N units; N >= 1.
  interval: number;
  // The first occurrence instant. The rule steps from here, and each occurrence
  // is derived from this anchor (not from the previous occurrence), so month-end
  // clamping never drifts: a 31st monthly stays "the 31st, clamped" every month
  // rather than collapsing to the 28th forever.
  anchor: Date;
  // Exclusive upper bound on occurrence instants (an occurrence strictly before
  // it is kept). Null means no date end.
  until?: Date | null;
  // Stop after this many occurrences. Null means no count end.
  count?: number | null;
};

const DAY_MS = 86_400_000;

export function addDaysUTC(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

// Advance a UTC instant by whole months, preserving the time of day and clamping
// the day-of-month to the target month's length (31 Jan + 1 month -> 28/29 Feb).
// Used for monthly (months) and yearly (months * 12).
export function addMonthsUTC(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth() + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  // Day 0 of the next month is the last day of the target month.
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0)
  ).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDay);
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    )
  );
}

// The i-th occurrence (i = 0 is the anchor), derived from the anchor.
export function occurrenceAt(rule: RecurrenceRule, i: number): Date {
  const step = i * rule.interval;
  switch (rule.frequency) {
    case "daily":
      return addDaysUTC(rule.anchor, step);
    case "weekly":
      return addDaysUTC(rule.anchor, step * 7);
    case "monthly":
      return addMonthsUTC(rule.anchor, step);
    case "yearly":
      return addMonthsUTC(rule.anchor, step * 12);
  }
}

// Hard ceiling on iterations, a backstop against a malformed rule; far above any
// realistic series within a horizon.
const MAX_ITERATIONS = 100_000;

// Generate the occurrence instants from the anchor up to `horizon` (exclusive),
// honouring the interval, the date end (until) and the count end. The result is
// what should exist now: the instant cap is min(horizon, until), and count caps
// the number produced. A count whose N-th occurrence is beyond the horizon yields
// only those before the horizon (the rolling runner extends it later); a count
// fully inside the horizon yields exactly N.
export function generateOccurrences(
  rule: RecurrenceRule,
  horizon: Date
): Date[] {
  const out: Date[] = [];
  const instantCap =
    rule.until && rule.until.getTime() < horizon.getTime()
      ? rule.until
      : horizon;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (rule.count != null && out.length >= rule.count) break;
    const occ = occurrenceAt(rule, i);
    if (occ.getTime() >= instantCap.getTime()) break;
    out.push(occ);
  }
  return out;
}

const FREQUENCY_ADVERB: Record<Frequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

const FREQUENCY_UNIT: Record<Frequency, string> = {
  daily: "days",
  weekly: "weeks",
  monthly: "months",
  yearly: "years",
};

// A plain-language description of a rule for the UI, e.g. "Weekly",
// "Every 2 weeks", "Monthly, 10 times", "Weekly, until 1 Aug 2026". The `until`
// here is the exclusive bound stored on the series; the inclusive end date shown
// is the day before it.
export function describeRule(rule: RecurrenceRule): string {
  const base =
    rule.interval === 1
      ? FREQUENCY_ADVERB[rule.frequency]
      : `Every ${rule.interval} ${FREQUENCY_UNIT[rule.frequency]}`;

  if (rule.count != null) {
    return `${base}, ${rule.count} ${rule.count === 1 ? "time" : "times"}`;
  }
  if (rule.until) {
    const inclusiveEnd = addDaysUTC(rule.until, -1);
    const label = inclusiveEnd.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    return `${base}, until ${label}`;
  }
  return base;
}
