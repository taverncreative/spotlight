// Europe/London wall-clock helpers, shared by the composer (schedule prefill),
// the schedule actions (wall-clock -> UTC) and the calendar view (bucketing
// posts by London date). All go through Intl.DateTimeFormat with the IANA zone:
// deterministic across server and client (hydration-safe) and correct on
// Vercel's UTC runtime, where naive getDate()/getMonth() would misplace
// instants near midnight during BST.

// The offset (minutes) of Europe/London at the given instant: +60 in BST, 0 in
// GMT. Computed by formatting the instant in the London zone and diffing.
export function londonOffsetMinutes(date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((asIfUtc - date.getTime()) / 60000);
}

// The Europe/London wall-clock date (YYYY-MM-DD) + time (HH:MM) for a UTC ISO.
export function londonParts(iso: string): { date: string; time: string } {
  const parts: Record<string, string> = {};
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  for (const part of fmt.formatToParts(new Date(iso)))
    parts[part.type] = part.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}
