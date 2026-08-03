import { test } from "node:test";
import assert from "node:assert/strict";
import {
  healthScore,
  THRESHOLDS,
  WEIGHTS,
  type HealthInput,
} from "@/lib/clients/health";

// A client with nothing wrong and nothing to judge. Each test overrides only the
// field it is about, so a failure points at one input rather than a whole shape.
function input(overrides: Partial<HealthInput> = {}): HealthInput {
  return {
    services: [],
    oldestOpenRequestDays: null,
    socialRunwayDays: null,
    daysSinceLastPost: null,
    siteState: null,
    ...overrides,
  };
}

const near = (actual: number | null, expected: number, why: string) => {
  assert.ok(actual !== null, `${why}: expected a score, got null`);
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${why}: expected ${expected}, got ${actual}`
  );
};

// --- no services: the case every client is in today ------------------------

test("no services gives null, not zero", () => {
  const { score, parts } = healthScore(input());
  assert.equal(score, null);
  assert.deepEqual(parts, []);
});

test("services that apply but have nothing to judge still give null", () => {
  // On blog and monitoring, but never posted and no sites checked. Nothing has
  // been neglected; there is simply no history. This must not read as zero.
  const { score } = healthScore(input({ services: ["blog", "monitoring"] }));
  assert.equal(score, null);
});

// --- the central requirement: applicable services only ---------------------

test("two services score the same as five when each performs the same", () => {
  const two = healthScore(
    input({
      services: ["requests", "monitoring"],
      oldestOpenRequestDays: 0,
      siteState: "healthy",
    })
  );
  const four = healthScore(
    input({
      services: ["requests", "monitoring", "blog", "social"],
      oldestOpenRequestDays: 0,
      siteState: "healthy",
      daysSinceLastPost: 1,
      socialRunwayDays: THRESHOLDS.socialRunwayDays,
    })
  );
  near(two.score, 1, "two services all fine");
  near(four.score, 1, "four services all fine");
});

test("a service a client is not on is ignored entirely", () => {
  // Nothing scheduled at all, but they are not on social. It must not count.
  const { score, parts } = healthScore(
    input({
      services: ["monitoring"],
      socialRunwayDays: null,
      siteState: "healthy",
    })
  );
  near(score, 1, "not on social");
  assert.deepEqual(
    parts.map((p) => p.service),
    ["monitoring"]
  );
});

test("the same neglect scores worse for a client on fewer services", () => {
  // One failing service out of two hurts more than one out of four. That is
  // correct: it is a larger share of what we do for them.
  const outOfTwo = healthScore(
    input({
      services: ["monitoring", "blog"],
      siteState: "down",
      daysSinceLastPost: 1,
    })
  );
  const outOfThree = healthScore(
    input({
      services: ["monitoring", "blog", "requests"],
      siteState: "down",
      daysSinceLastPost: 1,
      oldestOpenRequestDays: 0,
    })
  );
  assert.ok(
    outOfTwo.score !== null && outOfThree.score !== null,
    "both scored"
  );
  assert.ok(
    outOfTwo.score < outOfThree.score,
    `one bad of two (${outOfTwo.score}) should be worse than one of three (${outOfThree.score})`
  );
});

// --- per-service scorers ---------------------------------------------------

test("requests: none open is full, threshold age is zero, half is half", () => {
  const only = (days: number | null) =>
    healthScore(input({ services: ["requests"], oldestOpenRequestDays: days }))
      .score;
  near(only(null), 1, "nothing open");
  near(only(0), 1, "opened today");
  near(only(THRESHOLDS.requestDays / 2), 0.5, "half the threshold");
  near(only(THRESHOLDS.requestDays), 0, "at the threshold");
  near(only(THRESHOLDS.requestDays * 10), 0, "far past, clamped");
});

test("social: nothing queued is zero, full runway is one", () => {
  const only = (days: number | null) =>
    healthScore(input({ services: ["social"], socialRunwayDays: days })).score;
  // Unlike blog, an empty queue IS the neglect: scheduling is the work.
  near(only(null), 0, "nothing scheduled");
  near(only(0), 0, "queue runs out today");
  near(only(THRESHOLDS.socialRunwayDays / 2), 0.5, "half the runway");
  near(only(THRESHOLDS.socialRunwayDays), 1, "full runway");
  near(only(THRESHOLDS.socialRunwayDays * 3), 1, "well ahead, clamped");
});

test("blog: within cadence is full, twice cadence is zero", () => {
  const only = (days: number | null) =>
    healthScore(input({ services: ["blog"], daysSinceLastPost: days })).score;
  near(only(0), 1, "posted today");
  near(only(THRESHOLDS.blogCadenceDays), 1, "exactly on cadence");
  near(only(THRESHOLDS.blogCadenceDays * 1.5), 0.5, "half a cycle overdue");
  near(only(THRESHOLDS.blogCadenceDays * 2), 0, "a full cycle overdue");
  near(only(THRESHOLDS.blogCadenceDays * 10), 0, "years overdue, clamped");
  // Never posted is excluded, not zeroed: being started is not being neglected.
  assert.equal(only(null), null, "never posted");
});

test("monitoring: down, at risk and healthy", () => {
  const only = (state: HealthInput["siteState"]) =>
    healthScore(input({ services: ["monitoring"], siteState: state })).score;
  near(only("down"), 0, "down");
  near(only("at-risk"), 0.4, "at risk");
  near(only("healthy"), 1, "healthy");
  assert.equal(only(null), null, "no sites checked");
});

// --- weighting -------------------------------------------------------------

test("a stale request outweighs a down site", () => {
  const staleRequest = healthScore(
    input({
      services: ["requests", "monitoring"],
      oldestOpenRequestDays: THRESHOLDS.requestDays,
      siteState: "healthy",
    })
  ).score;
  const siteDown = healthScore(
    input({
      services: ["requests", "monitoring"],
      oldestOpenRequestDays: 0,
      siteState: "down",
    })
  ).score;
  assert.ok(staleRequest !== null && siteDown !== null, "both scored");
  assert.ok(
    staleRequest < siteDown,
    `a week-old request (${staleRequest}) should hurt more than a down site (${siteDown})`
  );
});

test("the weighted mean is the documented arithmetic", () => {
  // requests 0 (weight 3) and monitoring 1 (weight 1) => 1/4.
  const { score } = healthScore(
    input({
      services: ["requests", "monitoring"],
      oldestOpenRequestDays: THRESHOLDS.requestDays,
      siteState: "healthy",
    })
  );
  const expected = WEIGHTS.monitoring / (WEIGHTS.requests + WEIGHTS.monitoring);
  near(score, expected, "weighted mean");
});

// --- input hygiene ---------------------------------------------------------

test("a duplicated service is counted once", () => {
  // 0061's check constraint cannot reject duplicates, so the scorer must. Left
  // unhandled, monitoring here would carry double weight.
  const duped = healthScore(
    input({
      services: ["monitoring", "monitoring", "requests"],
      siteState: "down",
      oldestOpenRequestDays: 0,
    })
  );
  const single = healthScore(
    input({
      services: ["monitoring", "requests"],
      siteState: "down",
      oldestOpenRequestDays: 0,
    })
  );
  assert.equal(duped.parts.length, 2, "deduped to two parts");
  assert.equal(duped.score, single.score);
});

test("an unknown service is ignored rather than throwing", () => {
  const { score, parts } = healthScore(
    input({
      services: ["monitoring", "telepathy"],
      siteState: "healthy",
    })
  );
  near(score, 1, "unknown ignored");
  assert.deepEqual(
    parts.map((p) => p.service),
    ["monitoring"]
  );
});

test("negative and absurd inputs stay within 0..1", () => {
  const scores = [
    healthScore(input({ services: ["requests"], oldestOpenRequestDays: -5 }))
      .score,
    healthScore(input({ services: ["social"], socialRunwayDays: -5 })).score,
    healthScore(input({ services: ["blog"], daysSinceLastPost: -5 })).score,
    healthScore(input({ services: ["social"], socialRunwayDays: 1e9 })).score,
  ];
  for (const score of scores) {
    assert.ok(score !== null, "scored");
    assert.ok(score >= 0 && score <= 1, `in range, got ${score}`);
  }
});
