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

// Monday-first weekday index (0..6) for a YYYY-MM-DD.
//
// Monday-first because everything else here is: monthGrid rotates its leading
// blanks the same way, and the calendar's weekday header row starts at Mon. Any
// consumer indexing a seven-slot array by weekday uses this rather than
// getUTCDay, so the rotation is written once.
export function weekdayIndex(dayKey: string): number {
  const [year, month, day] = dayKey.split("-").map(Number);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

// n days after a YYYY-MM-DD, as a YYYY-MM-DD. Date.UTC normalises the overflow,
// so month and year ends need no special case.
export function addDays(dayKey: string, n: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + n));
  return shifted.toISOString().slice(0, 10);
}

// How far forward the agenda invents empty days for. Two weeks: far enough to
// see next week's gaps while there is still time to fill them, short enough that
// a themed client's agenda does not become an endless list of days with nothing
// on them.
const THEME_HORIZON_DAYS = 14;

// Days with items, in date order, from `fromDate` onwards. The agenda layout for
// narrow screens: a calendar grid squeezed to 320px is worse than a list, and a
// list only earns its place if it starts at today rather than making you scroll
// past the whole month.
//
// WITH THEMES, IT ALSO LISTS DAYS THAT HAVE NOTHING ON THEM. That looks like the
// opposite of what an agenda is for, and it is the point: once a weekday means
// "real weddings", an empty Tuesday is not absence of data, it is a missing
// post. A list built only from what exists can never show that, so the themed
// days inside the horizon are filled in whether or not anything sits on them.
//
// Unthemed days are NOT invented. A client with no themes gets exactly the
// agenda they had before this existed.
export function agendaDays(
  items: CalendarItem[],
  fromDate: string,
  // Seven Monday-first labels, '' for a day with no theme. Omitted entirely on a
  // calendar that does not carry themes.
  themes?: string[]
): { date: string; items: CalendarItem[]; theme?: string }[] {
  const byDay = bucketByDay(items);
  const dates = new Set([...byDay.keys()].filter((date) => date >= fromDate));

  if (themes?.some(Boolean)) {
    for (let offset = 0; offset < THEME_HORIZON_DAYS; offset++) {
      const date = addDays(fromDate, offset);
      if (themes[weekdayIndex(date)]) dates.add(date);
    }
  }

  return [...dates]
    .sort((a, b) => a.localeCompare(b))
    .map((date) => {
      const theme = themes?.[weekdayIndex(date)];
      return {
        date,
        items: byDay.get(date) ?? [],
        ...(theme ? { theme } : {}),
      };
    });
}

// How a day's posts tile inside one cell.
//
// A day cell is a fixed rectangle, so the posts in it split that rectangle
// rather than queueing down a list: one fills it, two stack, three is one wide
// across the top with two beneath, four quarters it evenly. Five or more shows
// three and gives the fourth quarter to a "+N" tile that opens the day detail,
// because a fifth tile at this size would be a smear rather than an image.
//
// Pure and here rather than in the component, so the rule can be tested at every
// count instead of eyeballed at the two that happen to exist in the data.
export type MosaicSpan = "full" | "wide" | "quarter";

export type Mosaic = {
  // How many posts get a tile of their own.
  shown: number;
  // One span per tile, in order. Length is shown, plus one when overflow > 0 --
  // that last entry is the "+N" tile, which is not a post.
  spans: MosaicSpan[];
  // How many posts are represented by the "+N" tile. 0 when everything fits.
  overflow: number;
};

const QUARTERS: MosaicSpan[] = ["quarter", "quarter", "quarter", "quarter"];

export function mosaicLayout(count: number): Mosaic {
  if (count <= 0) return { shown: 0, spans: [], overflow: 0 };
  if (count === 1) return { shown: 1, spans: ["full"], overflow: 0 };
  if (count === 2) return { shown: 2, spans: ["wide", "wide"], overflow: 0 };
  if (count === 3) {
    return { shown: 3, spans: ["wide", "quarter", "quarter"], overflow: 0 };
  }
  if (count === 4) return { shown: 4, spans: QUARTERS, overflow: 0 };
  // Three posts and a counter, filling the same four quarters.
  return { shown: 3, spans: QUARTERS, overflow: count - 3 };
}

// The first few words of a caption, for a tile label.
//
// Social captions run to paragraphs and blog titles do not, so a caption needs
// trimming to sit where a title sits. Cut on a word boundary rather than a
// character count: "Book your appoint" reads as a bug, "Book your…" reads as a
// summary.
export function firstWords(text: string, limit: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length <= limit) return words.join(" ");
  return `${words.slice(0, limit).join(" ")}…`;
}

const DAY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// A YYYY-MM-DD we are willing to prefill a composer with, or null.
//
// The sibling of parseMonth, and it exists for the same reason: a day now
// arrives from the query string when the calendar sends you to the composer
// with a date already chosen, and "?date=lol" must land on an empty date field
// rather than in a form input or a database column. Shape only -- 31 February
// parses here and is a date the calendar will simply never link to.
export function parseDay(value: string | null | undefined): string | null {
  return value && DAY_PATTERN.test(value) ? value : null;
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
