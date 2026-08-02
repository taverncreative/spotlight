import { test } from "node:test";
import assert from "node:assert/strict";
import {
  daysAgo,
  moduleLabel,
  planLine,
  pounds,
  readAge,
  snapshotIsStale,
} from "@/lib/platform/format";

test("pence become pounds, dropping .00 on whole amounts", () => {
  assert.equal(pounds(375), "£3.75");
  assert.equal(pounds(9500), "£95");
  assert.equal(pounds(114000), "£1,140");
  assert.equal(pounds(0), "£0");
});

test("days ago reads as a gap, with today and yesterday named", () => {
  const now = new Date("2026-08-02T12:00:00.000Z");
  assert.equal(daysAgo("2026-08-02T09:00:00.000Z", now), "today");
  assert.equal(daysAgo("2026-08-01T09:00:00.000Z", now), "yesterday");
  assert.equal(daysAgo("2026-07-27T09:00:00.000Z", now), "6 days ago");
});

test("a fresh read says just now rather than 0 minutes ago", () => {
  const now = new Date("2026-08-02T12:00:00.000Z");
  assert.equal(readAge("2026-08-02T11:59:50.000Z", now), "just now");
  assert.equal(readAge("2026-08-02T11:59:00.000Z", now), "1 minute ago");
  assert.equal(readAge("2026-08-02T11:20:00.000Z", now), "40 minutes ago");
  assert.equal(readAge("2026-08-02T09:00:00.000Z", now), "3 hours ago");
});

test("a null billing period is stated as monthly, matching how MRR is estimated", () => {
  assert.equal(planLine("autopilot", null, "active"), "autopilot · monthly");
  assert.equal(planLine("autopilot", "annual", "active"), "autopilot · annual");
});

test("a subscription that is not simply active says so in the plan line", () => {
  assert.equal(planLine("essentials", "monthly", "past_due"), "essentials · monthly · past due");
  assert.equal(planLine(null, null, null), "no plan");
});

test("module keys become names, and an unknown key still reads sensibly", () => {
  assert.equal(moduleLabel("prospect_finder"), "Prospect Finder");
  assert.equal(moduleLabel("invoicing"), "Invoicing");
  assert.equal(moduleLabel("sops"), "SOPs");
  assert.equal(moduleLabel("route_planner"), "Route planner");
});

test("a snapshot that has stopped advancing is called stale, and a missing one counts as stale", () => {
  const now = new Date("2026-08-02T12:00:00.000Z");
  assert.equal(snapshotIsStale("2026-08-02", now), false);
  assert.equal(snapshotIsStale("2026-07-31", now), false);
  assert.equal(snapshotIsStale("2026-07-28", now), true);
  assert.equal(snapshotIsStale(null, now), true);
});
