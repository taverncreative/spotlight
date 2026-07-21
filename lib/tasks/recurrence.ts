// Recurrence for client_tasks. The enum and the roll-forward date maths live
// together so the form picker, the validator and the completeTask action all
// read one source of truth.

export const RECURRENCE_VALUES = [
  "none",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
] as const;

export type Recurrence = (typeof RECURRENCE_VALUES)[number];

// Picker options, in the order they appear in the form select.
export const RECURRENCE_OPTIONS: { value: Recurrence; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

const RECURRENCE_LABELS: Record<Recurrence, string> = Object.fromEntries(
  RECURRENCE_OPTIONS.map((option) => [option.value, option.label])
) as Record<Recurrence, string>;

// Short chip label for a recurring task in the list. "none" has no chip.
export function recurrenceLabel(recurrence: string): string | null {
  if (recurrence === "none") return null;
  return RECURRENCE_LABELS[recurrence as Recurrence] ?? null;
}

const MONTHS_TO_ADD: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

// Roll a YYYY-MM-DD due date forward by one recurrence interval, anchored on the
// existing due date so the cadence never drifts (a quarterly task due the 1st
// stays on the 1st, whenever it is actually completed). Month maths clamps to
// the target month's last day, so 31 Jan + 1 month = 28/29 Feb rather than
// spilling into March. All arithmetic is in UTC so a local timezone can never
// shift the calendar date. Returns the input unchanged for 'none' or an
// unparseable date (a non-recurring task never rolls).
export function nextDueDate(due: string, recurrence: string): string {
  const [year, month, day] = due.split("-").map(Number);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return due;
  }

  if (recurrence === "weekly") {
    // Day-of-month arithmetic; Date.UTC normalises any month/year rollover.
    const rolled = new Date(Date.UTC(year, month - 1, day + 7));
    return toIsoDate(rolled);
  }

  const addMonths = MONTHS_TO_ADD[recurrence];
  if (addMonths === undefined) return due; // 'none' or unknown

  // Run months as a single 0-indexed count so the year carries correctly
  // (e.g. Nov + 3 months = Feb of the next year).
  const runningMonth = month - 1 + addMonths;
  const targetYear = year + Math.floor(runningMonth / 12);
  const targetMonth = runningMonth % 12; // 0-indexed
  const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return `${targetYear}-${pad(targetMonth + 1)}-${pad(clampedDay)}`;
}

// Last day of a 0-indexed month: day 0 of the next month rolls back to it.
function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

function toIsoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate()
  )}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
