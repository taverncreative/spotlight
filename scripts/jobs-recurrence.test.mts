// Unit test for the pure recurrence rule engine (Phase 2, recurrence pass). Runs
// with: npm run test:rule-engine. No database or server; the awkward cases the
// engine lives or dies on: interval > 1, until-date vs after-count ends, the
// anchor (time of day and day-of-month preserved), and month-length edges for
// monthly and yearly.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addMonthsUTC,
  describeRule,
  generateOccurrences,
  type RecurrenceRule,
} from "../lib/jobs/recurrence.ts";

const at = (iso: string) => new Date(iso);
const iso = (dates: Date[]) => dates.map((d) => d.toISOString());

test("daily, interval 1, keeps the anchor time of day", () => {
  const rule: RecurrenceRule = {
    frequency: "daily",
    interval: 1,
    anchor: at("2026-06-15T09:30:00.000Z"),
  };
  const got = generateOccurrences(rule, at("2026-06-19T00:00:00.000Z"));
  assert.deepEqual(iso(got), [
    "2026-06-15T09:30:00.000Z",
    "2026-06-16T09:30:00.000Z",
    "2026-06-17T09:30:00.000Z",
    "2026-06-18T09:30:00.000Z",
  ]);
});

test("interval > 1 spaces occurrences (every 3 days, every 2 weeks)", () => {
  const daily = generateOccurrences(
    { frequency: "daily", interval: 3, anchor: at("2026-06-01T08:00:00.000Z") },
    at("2026-06-12T00:00:00.000Z")
  );
  assert.deepEqual(iso(daily), [
    "2026-06-01T08:00:00.000Z",
    "2026-06-04T08:00:00.000Z",
    "2026-06-07T08:00:00.000Z",
    "2026-06-10T08:00:00.000Z",
  ]);

  const weekly = generateOccurrences(
    { frequency: "weekly", interval: 2, anchor: at("2026-06-01T08:00:00.000Z") },
    at("2026-08-01T00:00:00.000Z")
  );
  assert.deepEqual(iso(weekly), [
    "2026-06-01T08:00:00.000Z",
    "2026-06-15T08:00:00.000Z",
    "2026-06-29T08:00:00.000Z",
    "2026-07-13T08:00:00.000Z",
    "2026-07-27T08:00:00.000Z",
  ]);
});

test("end after N occurrences yields exactly N (within the horizon)", () => {
  const rule: RecurrenceRule = {
    frequency: "weekly",
    interval: 1,
    anchor: at("2026-06-01T10:00:00.000Z"),
    count: 5,
  };
  // A far horizon, so the count is the binding limit.
  const got = generateOccurrences(rule, at("2027-01-01T00:00:00.000Z"));
  assert.equal(got.length, 5);
  assert.equal(got[4].toISOString(), "2026-06-29T10:00:00.000Z");
});

test("end until a date is exclusive of the bound, inclusive of earlier days", () => {
  const rule: RecurrenceRule = {
    frequency: "weekly",
    interval: 1,
    anchor: at("2026-06-01T10:00:00.000Z"),
    // Exclusive bound at 2026-06-22 00:00Z: the 2026-06-22 occurrence is excluded.
    until: at("2026-06-22T00:00:00.000Z"),
  };
  const got = generateOccurrences(rule, at("2027-01-01T00:00:00.000Z"));
  assert.deepEqual(iso(got), [
    "2026-06-01T10:00:00.000Z",
    "2026-06-08T10:00:00.000Z",
    "2026-06-15T10:00:00.000Z",
  ]);
});

test("the horizon caps generation when the rule is open-ended", () => {
  const rule: RecurrenceRule = {
    frequency: "daily",
    interval: 1,
    anchor: at("2026-06-01T00:00:00.000Z"),
  };
  const got = generateOccurrences(rule, at("2026-06-04T00:00:00.000Z"));
  assert.equal(got.length, 3); // 1st, 2nd, 3rd; the 4th is at the exclusive cap
});

test("a count beyond the horizon yields only those before it (runner extends later)", () => {
  const rule: RecurrenceRule = {
    frequency: "weekly",
    interval: 1,
    anchor: at("2026-06-01T00:00:00.000Z"),
    count: 50,
  };
  const got = generateOccurrences(rule, at("2026-07-01T00:00:00.000Z"));
  // Only the weeks within the month-long horizon, not all 50.
  assert.deepEqual(iso(got), [
    "2026-06-01T00:00:00.000Z",
    "2026-06-08T00:00:00.000Z",
    "2026-06-15T00:00:00.000Z",
    "2026-06-22T00:00:00.000Z",
    "2026-06-29T00:00:00.000Z",
  ]);
});

test("monthly clamps the day to the month length and re-derives from the anchor", () => {
  const rule: RecurrenceRule = {
    frequency: "monthly",
    interval: 1,
    anchor: at("2026-01-31T09:00:00.000Z"),
  };
  const got = generateOccurrences(rule, at("2026-06-01T00:00:00.000Z"));
  // Jan 31, Feb 28 (clamped), Mar 31 (re-derived, not stuck at 28), Apr 30, May 31.
  assert.deepEqual(iso(got), [
    "2026-01-31T09:00:00.000Z",
    "2026-02-28T09:00:00.000Z",
    "2026-03-31T09:00:00.000Z",
    "2026-04-30T09:00:00.000Z",
    "2026-05-31T09:00:00.000Z",
  ]);
});

test("monthly into a leap February lands on the 29th", () => {
  const got = generateOccurrences(
    { frequency: "monthly", interval: 1, anchor: at("2024-01-31T12:00:00.000Z") },
    at("2024-04-01T00:00:00.000Z")
  );
  assert.deepEqual(iso(got), [
    "2024-01-31T12:00:00.000Z",
    "2024-02-29T12:00:00.000Z", // 2024 is a leap year
    "2024-03-31T12:00:00.000Z", // re-derived from the 31st anchor
  ]);
});

test("yearly on Feb 29 clamps to Feb 28 in non-leap years, restores on leap", () => {
  const rule: RecurrenceRule = {
    frequency: "yearly",
    interval: 1,
    anchor: at("2024-02-29T00:00:00.000Z"),
  };
  const got = generateOccurrences(rule, at("2029-01-01T00:00:00.000Z"));
  assert.deepEqual(iso(got), [
    "2024-02-29T00:00:00.000Z",
    "2025-02-28T00:00:00.000Z",
    "2026-02-28T00:00:00.000Z",
    "2027-02-28T00:00:00.000Z",
    "2028-02-29T00:00:00.000Z", // 2028 is a leap year, the 29th returns
  ]);
});

test("addMonthsUTC handles negative and year-crossing steps", () => {
  assert.equal(
    addMonthsUTC(at("2026-01-15T00:00:00.000Z"), -1).toISOString(),
    "2025-12-15T00:00:00.000Z"
  );
  assert.equal(
    addMonthsUTC(at("2026-11-15T00:00:00.000Z"), 3).toISOString(),
    "2027-02-15T00:00:00.000Z"
  );
});

test("describeRule renders plain-language summaries", () => {
  assert.equal(
    describeRule({ frequency: "weekly", interval: 1, anchor: at("2026-06-01T00:00:00.000Z") }),
    "Weekly"
  );
  assert.equal(
    describeRule({ frequency: "weekly", interval: 2, anchor: at("2026-06-01T00:00:00.000Z") }),
    "Every 2 weeks"
  );
  assert.equal(
    describeRule({
      frequency: "monthly",
      interval: 1,
      anchor: at("2026-06-01T00:00:00.000Z"),
      count: 10,
    }),
    "Monthly, 10 times"
  );
  assert.equal(
    describeRule({
      frequency: "weekly",
      interval: 1,
      anchor: at("2026-06-01T00:00:00.000Z"),
      until: at("2026-08-02T00:00:00.000Z"),
    }),
    "Weekly, until 1 Aug 2026"
  );
});
