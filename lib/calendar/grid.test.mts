import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  agendaDays,
  bucketByDay,
  firstWords,
  formatDayLabel,
  londonMonth,
  monthGrid,
  mosaicLayout,
  parseDay,
  parseMonth,
  weekdayIndex,
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
  monthGrid(month)
    .cells.filter(Boolean)
    .map((cell) => cell!.dayKey);

// --- month parsing --------------------------------------------------------

test("only a real YYYY-MM is accepted", () => {
  assert.equal(parseMonth("2026-07"), "2026-07");
  assert.equal(parseMonth("2026-12"), "2026-12");
  for (const bad of [
    "2026-13",
    "2026-00",
    "2026-7",
    "26-07",
    "",
    null,
    undefined,
    "2026-07-01",
  ]) {
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
  assert.deepEqual(monthGrid("2026-06").cells[0], {
    dayNum: 1,
    dayKey: "2026-06-01",
  });
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
  assert.deepEqual(
    byDay.get("2026-07-27")?.map((i) => i.id),
    ["a", "b"]
  );
  assert.deepEqual(
    byDay.get("2026-07-28")?.map((i) => i.id),
    ["c"]
  );
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
  assert.deepEqual(
    days.map((d) => d.date),
    ["2026-07-27", "2026-08-02"]
  );
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
  assert.deepEqual(
    days.map((d) => d.date),
    ["2026-07-27", "2026-08-15", "2026-09-01"]
  );
});

test("the agenda keeps every item on a shared day", () => {
  const days = agendaDays(
    [
      item({ id: "1", date: "2026-07-26", time: "11:00" }),
      item({ id: "2", date: "2026-07-26", time: "08:00" }),
    ],
    "2026-07-01"
  );
  assert.deepEqual(
    days[0].items.map((i) => i.id),
    ["2", "1"]
  );
});

test("nothing upcoming gives an empty agenda, not a crash", () => {
  assert.deepEqual(agendaDays([], "2026-07-27"), []);
  assert.deepEqual(
    agendaDays([item({ id: "old", date: "2020-01-01" })], "2026-07-27"),
    []
  );
});

// --- weekday themes -------------------------------------------------------

// Monday-first, so the index matches the grid's column order. 2026-07-27 is a
// Monday, which is what the fixtures above lean on.
const MON_TUE = ["Reviews", "Real weddings", "", "", "", "", ""];

test("weekdayIndex is Monday-first", () => {
  assert.equal(weekdayIndex("2026-07-27"), 0); // Monday
  assert.equal(weekdayIndex("2026-08-01"), 5); // Saturday
  assert.equal(weekdayIndex("2026-08-02"), 6); // Sunday
});

test("addDays crosses month and year ends", () => {
  assert.equal(addDays("2026-07-27", 5), "2026-08-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("themed days with nothing on them still reach the agenda", () => {
  const days = agendaDays([], "2026-07-27", MON_TUE);
  // Two weeks from Monday the 27th: two Mondays, two Tuesdays, nothing else.
  assert.deepEqual(
    days.map((d) => `${d.date} ${d.theme}`),
    [
      "2026-07-27 Reviews",
      "2026-07-28 Real weddings",
      "2026-08-03 Reviews",
      "2026-08-04 Real weddings",
    ]
  );
  assert.deepEqual(days[0].items, []);
});

test("a themed day merges its theme with its posts rather than duplicating", () => {
  const days = agendaDays(
    [item({ id: "a", date: "2026-07-28" })],
    "2026-07-27",
    MON_TUE
  );
  const tuesdays = days.filter((d) => d.date === "2026-07-28");
  assert.equal(tuesdays.length, 1);
  assert.equal(tuesdays[0].theme, "Real weddings");
  assert.equal(tuesdays[0].items.length, 1);
});

test("an unthemed weekday is never invented, even alongside themed ones", () => {
  const days = agendaDays([], "2026-07-27", MON_TUE);
  assert.equal(
    days.some((d) => weekdayIndex(d.date) > 1),
    false
  );
});

test("no themes at all leaves the agenda exactly as it was", () => {
  const items = [item({ id: "a", date: "2026-07-28" })];
  const blank = ["", "", "", "", "", "", ""];
  assert.deepEqual(
    agendaDays(items, "2026-07-27", blank),
    agendaDays(items, "2026-07-27")
  );
  assert.deepEqual(agendaDays([], "2026-07-27", blank), []);
});

test("a themed day outside the horizon only appears if it has posts", () => {
  const days = agendaDays(
    [item({ id: "far", date: "2026-09-07" })], // a Monday, well past 14 days
    "2026-07-27",
    MON_TUE
  );
  assert.equal(days.at(-1)?.date, "2026-09-07");
  // It still carries its theme, because the theme is a fact about the weekday.
  assert.equal(days.at(-1)?.theme, "Reviews");
  // And nothing empty crept in between the horizon and it.
  assert.equal(days.filter((d) => d.date > "2026-08-09").length, 1);
});

// --- mosaic ---------------------------------------------------------------

test("one post fills the cell", () => {
  assert.deepEqual(mosaicLayout(1), {
    shown: 1,
    spans: ["full"],
    overflow: 0,
  });
});

test("two posts stack full width", () => {
  assert.deepEqual(mosaicLayout(2), {
    shown: 2,
    spans: ["wide", "wide"],
    overflow: 0,
  });
});

test("three is one wide across the top plus two below", () => {
  assert.deepEqual(mosaicLayout(3), {
    shown: 3,
    spans: ["wide", "quarter", "quarter"],
    overflow: 0,
  });
});

test("four quarters the cell evenly, with no overflow tile", () => {
  const mosaic = mosaicLayout(4);
  assert.equal(mosaic.shown, 4);
  assert.equal(mosaic.overflow, 0);
  assert.deepEqual(mosaic.spans, ["quarter", "quarter", "quarter", "quarter"]);
});

test("five or more shows three posts and a +N tile", () => {
  const five = mosaicLayout(5);
  assert.equal(five.shown, 3);
  assert.equal(five.overflow, 2);
  // Four tiles: three posts, then the counter.
  assert.equal(five.spans.length, 4);

  const twenty = mosaicLayout(20);
  assert.equal(twenty.shown, 3);
  assert.equal(twenty.overflow, 17);
});

test("every post is either shown or counted, never dropped", () => {
  // The bug this guards is a cell that silently swallows a post.
  for (let count = 0; count <= 30; count++) {
    const mosaic = mosaicLayout(count);
    assert.equal(
      mosaic.shown + mosaic.overflow,
      count,
      `${count} posts: ${mosaic.shown} shown + ${mosaic.overflow} counted`
    );
  }
});

test("there is always exactly one tile per span, and never more than four", () => {
  for (let count = 0; count <= 30; count++) {
    const mosaic = mosaicLayout(count);
    const tiles = mosaic.shown + (mosaic.overflow > 0 ? 1 : 0);
    assert.equal(mosaic.spans.length, tiles, `${count} posts`);
    assert.ok(mosaic.spans.length <= 4, `${count} posts overflowed the grid`);
  }
});

test("an empty day tiles nothing", () => {
  assert.deepEqual(mosaicLayout(0), { shown: 0, spans: [], overflow: 0 });
  assert.deepEqual(mosaicLayout(-1), { shown: 0, spans: [], overflow: 0 });
});

// --- tile labels ----------------------------------------------------------

test("a caption is cut to whole words, with an ellipsis", () => {
  assert.equal(
    firstWords("Book your appointment before the Christmas rush begins", 4),
    "Book your appointment before…"
  );
});

test("a short caption is left alone, with no ellipsis", () => {
  assert.equal(firstWords("Book now", 6), "Book now");
  assert.equal(
    firstWords("Exactly six words in this one", 6),
    "Exactly six words in this one"
  );
});

test("messy whitespace collapses rather than counting as words", () => {
  assert.equal(firstWords("  Book   your\n\nappointment  ", 2), "Book your…");
});

test("an empty caption yields an empty label, not an ellipsis", () => {
  assert.equal(firstWords("", 5), "");
  assert.equal(firstWords("   ", 5), "");
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

test("a day is accepted only in the shape the calendar links to", () => {
  assert.equal(parseDay("2026-07-27"), "2026-07-27");
  assert.equal(parseDay("2026-12-31"), "2026-12-31");
  assert.equal(parseDay("2026-01-01"), "2026-01-01");
  for (const bad of [
    "2026-13-01",
    "2026-00-01",
    "2026-07-32",
    "2026-07-00",
    "2026-7-27",
    "2026-07-2",
    "26-07-27",
    "2026-07",
    "soon",
    "",
    null,
    undefined,
  ]) {
    assert.equal(parseDay(bad), null, `${bad} should be rejected`);
  }
});

test("shape only: an impossible date the calendar never links to still parses", () => {
  // Deliberate. This guards a query string, not a calendar: the day always
  // arrives from a cell that exists, and the composer's own date input is the
  // thing that has to reject 31 February. Rejecting it here would imply a
  // validation this function does not do.
  assert.equal(parseDay("2026-02-31"), "2026-02-31");
});
