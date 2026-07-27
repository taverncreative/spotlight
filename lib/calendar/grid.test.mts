import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agendaDays,
  bucketByDay,
  formatDayLabel,
  londonMonth,
  monthGrid,
  parseMonth,
  type CalendarItem,
} from "@/lib/calendar/grid";

function item(overrides: Partial<CalendarItem> & { id: string }): CalendarItem {
  return {
    date: "2026-07-27",
    time: "09:00",
    label: "A post",
    status: "scheduled",
    thumbnail: null,
    href: null,
    ...overrides,
  };
}

const dayKeys = (month: string) =>
  monthGrid(month).cells.filter(Boolean).map((cell) => cell!.dayKey);

// --- month parsing --------------------------------------------------------

test("only a real YYYY-MM is accepted", () => {
  assert.equal(parseMonth("2026-07"), "2026-07");
  assert.equal(parseMonth("2026-12"), "2026-12");
  for (const bad of ["2026-13", "2026-00", "2026-7", "26-07", "", null, undefined, "2026-07-01"]) {
    assert.equal(parseMonth(bad), null, `${bad} should be rejected`);
  }
});

test("the London month of an instant, not the UTC one", () => {
  // 00:30 BST on 1 July is 23:30 UTC on 30 June. London says July.
  assert.equal(londonMonth("2026-06-30T23:30:00.000Z"), "2026-07");
  // And in GMT the two agree.
  assert.equal(londonMonth("2026-01-15T12:00:00.000Z"), "2026-01");
});

// --- the grid -------------------------------------------------------------

test("July 2026 starts on a Wednesday, so there are two leading blanks", () => {
  const grid = monthGrid("2026-07");
  assert.equal(grid.cells[0], null);
  assert.equal(grid.cells[1], null);
  assert.deepEqual(grid.cells[2], { dayNum: 1, dayKey: "2026-07-01" });
});

test("the grid is always whole weeks", () => {
  for (const month of ["2026-01", "2026-02", "2026-07", "2026-08", "2027-02"]) {
    assert.equal(monthGrid(month).cells.length % 7, 0, `${month} is ragged`);
  }
});

test("a month that starts on a Monday has no leading blanks", () => {
  // 1 June 2026 is a Monday.
  assert.deepEqual(monthGrid("2026-06").cells[0], { dayNum: 1, dayKey: "2026-06-01" });
});

test("every day of the month appears exactly once, in order", () => {
  assert.equal(dayKeys("2026-07").length, 31);
  assert.equal(dayKeys("2026-06").length, 30);
  assert.equal(dayKeys("2026-02").length, 28);
  const july = dayKeys("2026-07");
  assert.equal(july[0], "2026-07-01");
  assert.equal(july.at(-1), "2026-07-31");
  assert.deepEqual(july, [...july].sort());
});

test("a leap year February has 29 days", () => {
  assert.equal(dayKeys("2028-02").length, 29);
  assert.equal(dayKeys("2028-02").at(-1), "2028-02-29");
});

test("month navigation wraps the year in both directions", () => {
  assert.equal(monthGrid("2026-01").prevMonth, "2025-12");
  assert.equal(monthGrid("2026-01").nextMonth, "2026-02");
  assert.equal(monthGrid("2026-12").nextMonth, "2027-01");
  assert.equal(monthGrid("2026-12").prevMonth, "2026-11");
});

test("the label reads as a month, not a date", () => {
  assert.equal(monthGrid("2026-07").label, "July 2026");
});

// --- bucketing ------------------------------------------------------------

test("items land on their own day, earliest first", () => {
  const byDay = bucketByDay([
    item({ id: "b", time: "17:00" }),
    item({ id: "a", time: "09:00" }),
    item({ id: "c", date: "2026-07-28", time: "08:00" }),
  ]);
  assert.deepEqual(byDay.get("2026-07-27")?.map((i) => i.id), ["a", "b"]);
  assert.deepEqual(byDay.get("2026-07-28")?.map((i) => i.id), ["c"]);
});

test("two items at the same minute keep a stable order", () => {
  // Otherwise the grid reshuffles between renders for no visible reason.
  const forwards = bucketByDay([item({ id: "b" }), item({ id: "a" })]);
  const backwards = bucketByDay([item({ id: "a" }), item({ id: "b" })]);
  assert.deepEqual(
    forwards.get("2026-07-27")?.map((i) => i.id),
    backwards.get("2026-07-27")?.map((i) => i.id)
  );
});

test("FOUR items on one day, which is the real crowded case", () => {
  // Blog published four posts on 26 July 2026. The cell is designed for this,
  // not for the one-a-day social rhythm.
  const byDay = bucketByDay([
    item({ id: "1", date: "2026-07-26", time: "08:00" }),
    item({ id: "2", date: "2026-07-26", time: "09:00" }),
    item({ id: "3", date: "2026-07-26", time: "10:00" }),
    item({ id: "4", date: "2026-07-26", time: "11:00" }),
  ]);
  assert.equal(byDay.get("2026-07-26")?.length, 4);
});

test("no items means no days, not empty days", () => {
  assert.equal(bucketByDay([]).size, 0);
});

test("days outside the drawn month are still bucketed", () => {
  // The agenda reads them even when the grid does not.
  const byDay = bucketByDay([item({ id: "x", date: "2027-01-04" })]);
  assert.equal(byDay.get("2027-01-04")?.length, 1);
});

// --- agenda ---------------------------------------------------------------

test("the agenda starts at today and looks forward", () => {
  const days = agendaDays(
    [
      item({ id: "past", date: "2026-07-01" }),
      item({ id: "today", date: "2026-07-27" }),
      item({ id: "soon", date: "2026-08-02" }),
    ],
    "2026-07-27"
  );
  assert.deepEqual(days.map((d) => d.date), ["2026-07-27", "2026-08-02"]);
});

test("the agenda is date-ordered regardless of input order", () => {
  const days = agendaDays(
    [
      item({ id: "c", date: "2026-09-01" }),
      item({ id: "a", date: "2026-07-27" }),
      item({ id: "b", date: "2026-08-15" }),
    ],
    "2026-01-01"
  );
  assert.deepEqual(days.map((d) => d.date), [
    "2026-07-27",
    "2026-08-15",
    "2026-09-01",
  ]);
});

test("the agenda keeps every item on a shared day", () => {
  const days = agendaDays(
    [
      item({ id: "1", date: "2026-07-26", time: "11:00" }),
      item({ id: "2", date: "2026-07-26", time: "08:00" }),
    ],
    "2026-07-01"
  );
  assert.deepEqual(days[0].items.map((i) => i.id), ["2", "1"]);
});

test("nothing upcoming gives an empty agenda, not a crash", () => {
  assert.deepEqual(agendaDays([], "2026-07-27"), []);
  assert.deepEqual(agendaDays([item({ id: "old", date: "2020-01-01" })], "2026-07-27"), []);
});

// --- labels ---------------------------------------------------------------

test("a day label reads as a day", () => {
  assert.equal(formatDayLabel("2026-07-27"), "Mon 27 July");
  assert.equal(formatDayLabel("2026-01-01"), "Thu 1 January");
});

test("day labels never shift by a timezone", () => {
  // The input is already London wall clock. Formatting must not convert again,
  // which is what would turn the 1st into the 31st.
  assert.match(formatDayLabel("2026-07-01"), /1 July/);
  assert.match(formatDayLabel("2026-12-31"), /31 December/);
});
