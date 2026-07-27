// Month-grid maths and day bucketing for the shared calendar.
//
// A PURE module. No React, no database, no ambient clock -- "today" is passed
// in. That is what makes a calendar testable at all: the alternative is a
// component you can only check by looking at it in a particular month.
//
// TIMEZONE DISCIPLINE. Every instant is reduced to a Europe/London wall-clock
// date by lib/social/london.ts before it reaches here, and the grid itself is
// built with Date.UTC. Neither half ever calls naive getDate()/getMonth(), which
// on Vercel's UTC runtime would file a 00:30 BST post under the previous day.
// The two halves therefore agree: a dayKey from the grid and a date from
// londonParts are the same string for the same day.

import { londonParts } from "@/lib/social/london";

export type CalendarItem = {
  id: string;
  // Europe/London wall clock, from londonParts. The module decides WHICH instant
  // (social plots published posts on published_at and the rest on scheduled_at);
  // this module only knows the answer.
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  label: string;
  // Free-form: each module has its own lifecycle, and the dot map falls back
  // rather than throwing on a status added later. Same contract as StatusPill.
  status: string;
  thumbnail: string | null;
  // null for an item with nothing to open (a published social post is inert).
  href: string | null;
};

export type MonthGrid = {
  month: string; // YYYY-MM
  label: string; // "July 2026"
  prevMonth: string;
  nextMonth: string;
  // One entry per cell, Monday first. null is a padding cell outside the month.
  cells: ({ dayKey: string; dayNum: number } | null)[];
};

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

// A YYYY-MM we are willing to render, or null. Callers turn null into "this
// month" -- kept separate so the fallback needs the clock and this does not.
export function parseMonth(value: string | null | undefined): string | null {
  return value && MONTH_PATTERN.test(value) ? value : null;
}

// The London month containing an instant, for defaulting to "now" without ever
// reading the server's UTC month.
export function londonMonth(iso: string): string {
  return londonParts(iso).date.slice(0, 7);
}

function shiftMonth(month: string, delta: -1 | 1): string {
  const [year, monthNum] = month.split("-").map(Number);
  const zeroBased = monthNum - 1 + delta;
  const nextYear = year + Math.floor(zeroBased / 12);
  const nextMonth = ((zeroBased % 12) + 12) % 12;
  return `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}`;
}

export function monthGrid(month: string): MonthGrid {
  const [year, monthNum] = month.split("-").map(Number);

  const first = new Date(Date.UTC(year, monthNum - 1, 1));
  // Monday-first: JS getUTCDay is Sunday-based, so rotate by 6 mod 7.
  const leadingBlanks = (first.getUTCDay() + 6) % 7;
  // Day 0 of the NEXT month is the last day of this one.
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  // Whole weeks, so the grid is always a clean rectangle.
  const cellCount = Math.ceil((leadingBlanks + daysInMonth) / 7) * 7;

  const cells: MonthGrid["cells"] = [];
  for (let index = 0; index < cellCount; index++) {
    const dayNum = index - leadingBlanks + 1;
    cells.push(
      dayNum < 1 || dayNum > daysInMonth
        ? null
        : {
            dayNum,
            dayKey: `${month}-${String(dayNum).padStart(2, "0")}`,
          }
    );
  }

  return {
    month,
    label: first.toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
    prevMonth: shiftMonth(month, -1),
    nextMonth: shiftMonth(month, 1),
    cells,
  };
}

// Items grouped by London date, earliest time first within a day.
//
// Returns EVERY day that has items, not only days inside the current month. The
// caller reads the days it is drawing; an agenda view reads them all.
export function bucketByDay(
  items: CalendarItem[]
): Map<string, CalendarItem[]> {
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const entries = byDay.get(item.date) ?? [];
    entries.push(item);
    byDay.set(item.date, entries);
  }
  for (const entries of byDay.values()) {
    // Stable within a time: sort by time, then id, so two posts at the same
    // minute do not swap order between renders.
    entries.sort(
      (a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id)
    );
  }
  return byDay;
}

// Days with items, in date order, from `fromDate` onwards. The agenda layout for
// narrow screens: a calendar grid squeezed to 320px is worse than a list, and a
// list only earns its place if it starts at today rather than making you scroll
// past the whole month.
export function agendaDays(
  items: CalendarItem[],
  fromDate: string
): { date: string; items: CalendarItem[] }[] {
  const byDay = bucketByDay(items);
  return [...byDay.entries()]
    .filter(([date]) => date >= fromDate)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, dayItems]) => ({ date, items: dayItems }));
}

// "Mon 27 July" for an agenda heading and a day-detail title. UTC-formatted from
// a wall-clock string that is already London, so no second conversion happens.
export function formatDayLabel(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}
