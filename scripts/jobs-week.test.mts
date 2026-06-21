// Unit test for the pure jobs scheduler week helpers (Phase 2, Pass 2). Runs
// with: npm run test:jobs-week. No database or server; just the date maths,
// which carries the awkward edge cases (Sunday belongs to the week that began
// the previous Monday, and a week can span a month or a year boundary).

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addWeeksUTC,
  dayIndexInWeek,
  formatWeekRange,
  isSameUTCDay,
  startOfWeekUTC,
  weekDayStarts,
  weekParam,
  weekStartFromParam,
} from "../lib/jobs/week.ts";

const at = (iso: string) => new Date(iso);

test("startOfWeekUTC returns the Monday of the week, in UTC", () => {
  // A Wednesday steps back to its Monday.
  assert.equal(
    weekParam(startOfWeekUTC(at("2026-06-17T14:30:00.000Z"))),
    "2026-06-15"
  );
  // The Monday itself is unchanged, and the time of day is dropped.
  const monday = startOfWeekUTC(at("2026-06-15T23:59:59.000Z"));
  assert.equal(monday.toISOString(), "2026-06-15T00:00:00.000Z");
  // Sunday is the END of the week, so it maps back to the previous Monday, not
  // forward to the next one. This is the easy off-by-one.
  assert.equal(
    weekParam(startOfWeekUTC(at("2026-06-21T08:00:00.000Z"))),
    "2026-06-15"
  );
});

test("weekDayStarts gives seven consecutive midnights Mon..Sun", () => {
  const days = weekDayStarts(startOfWeekUTC(at("2026-06-15T00:00:00.000Z")));
  assert.equal(days.length, 7);
  assert.equal(days[0].toISOString(), "2026-06-15T00:00:00.000Z"); // Mon
  assert.equal(days[6].toISOString(), "2026-06-21T00:00:00.000Z"); // Sun
});

test("addWeeksUTC moves by whole weeks and stays on Monday midnight", () => {
  const monday = startOfWeekUTC(at("2026-06-15T00:00:00.000Z"));
  assert.equal(weekParam(addWeeksUTC(monday, 1)), "2026-06-22");
  assert.equal(weekParam(addWeeksUTC(monday, -1)), "2026-06-08");
});

test("weekStartFromParam parses a valid date and falls back to today's week", () => {
  const today = at("2026-06-17T00:00:00.000Z"); // a Wednesday
  // A valid param naming any day in a week returns that week's Monday.
  assert.equal(weekParam(weekStartFromParam("2026-07-01", today)), "2026-06-29");
  // Absent or malformed falls back to the week containing `today`.
  assert.equal(weekParam(weekStartFromParam(undefined, today)), "2026-06-15");
  assert.equal(weekParam(weekStartFromParam("nonsense", today)), "2026-06-15");
  assert.equal(weekParam(weekStartFromParam("2026-13-40", today)), "2026-06-15");
});

test("dayIndexInWeek buckets an instant, or -1 when outside the week", () => {
  const weekStart = startOfWeekUTC(at("2026-06-15T00:00:00.000Z"));
  assert.equal(dayIndexInWeek(weekStart, at("2026-06-15T09:00:00.000Z")), 0);
  assert.equal(dayIndexInWeek(weekStart, at("2026-06-18T23:59:00.000Z")), 3);
  assert.equal(dayIndexInWeek(weekStart, at("2026-06-21T23:59:00.000Z")), 6);
  assert.equal(dayIndexInWeek(weekStart, at("2026-06-22T00:00:00.000Z")), -1);
  assert.equal(dayIndexInWeek(weekStart, at("2026-06-14T23:59:00.000Z")), -1);
});

test("isSameUTCDay compares the calendar day, not the instant", () => {
  assert.ok(
    isSameUTCDay(at("2026-06-15T00:00:00.000Z"), at("2026-06-15T22:00:00.000Z"))
  );
  assert.ok(
    !isSameUTCDay(at("2026-06-15T23:00:00.000Z"), at("2026-06-16T01:00:00.000Z"))
  );
});

test("formatWeekRange collapses the shared month and year", () => {
  // Same month.
  assert.equal(
    formatWeekRange(startOfWeekUTC(at("2026-06-15T00:00:00.000Z"))),
    "15–21 June 2026"
  );
  // Same year, different month.
  assert.equal(
    formatWeekRange(startOfWeekUTC(at("2026-06-29T00:00:00.000Z"))),
    "29 June–5 July 2026"
  );
  // Different year (the week straddling new year).
  assert.equal(
    formatWeekRange(startOfWeekUTC(at("2025-12-31T00:00:00.000Z"))),
    "29 December 2025–4 January 2026"
  );
});
