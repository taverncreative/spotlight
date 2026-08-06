import { weekdayIndex } from "@/lib/calendar/grid";

// Weekday themes: what each day of the week is FOR, per client.
//
// Seven slots, Monday first, matching the column order of the month grid and the
// storage order of clients.weekday_themes (0091). The array index IS the grid
// column index, everywhere, so nothing maps between the two.
//
// A PURE module, like grid.ts beside it: no React, no database. Both the server
// action and the calendar go through these, so "blank" means the same thing on
// each side of the wire.

export const THEME_SLOTS = 7;

// Long enough for "Real weddings" or "Behind the scenes", short enough to sit
// under a weekday name in a grid column at 11px without wrapping to three lines.
// Enforced here and on the inputs; the DB constrains shape, not length (0091).
export const MAX_THEME_LENGTH = 24;

// Full names for the editor, where there is room and "Wednesday" is clearer than
// "Wed". The calendar header keeps its own short forms.
export const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

// Anything into exactly seven trimmed strings.
//
// Defensive on purpose: this runs on a column that existed before the constraint
// did on any database restored from an older dump, and on form data, which is
// whatever was posted. A short array pads, a long one truncates, a null element
// becomes ''. Callers can then index 0..6 without checking.
export function normaliseThemes(value: unknown): string[] {
  const input = Array.isArray(value) ? value : [];
  return Array.from({ length: THEME_SLOTS }, (_, index) =>
    typeof input[index] === "string"
      ? input[index].trim().slice(0, MAX_THEME_LENGTH)
      : ""
  );
}

// Whether this client has said anything at all about their week. The calendar
// asks before rendering any theme furniture: a client with no themes must look
// exactly as it did before this feature existed, rather than gaining seven empty
// slots to ignore.
export function hasAnyTheme(themes: string[]): boolean {
  return themes.some((theme) => theme !== "");
}

// The theme for a given day, or null. Days carry a theme by weekday, not by
// date: relabelling Tuesday relabels every Tuesday, past ones included, which is
// what a statement of intent should do.
export function themeForDay(themes: string[], dayKey: string): string | null {
  return themes[weekdayIndex(dayKey)] || null;
}
