import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ATTEMPTS,
  settle,
  settlementUpdate,
  type Attempt,
} from "@/lib/social/publish-status";

const attempt = (over: Partial<Attempt> = {}): Attempt => ({
  total: 2,
  published: 0,
  skipped: 0,
  sawTransient: false,
  sawTerminal: false,
  sawPending: false,
  attempts: 1,
  ...over,
});

// --- the invariant that this module exists for -----------------------------

test("EVERY 'scheduled' settlement carries a retry time", () => {
  // The bug in one sentence: the claim query is `status = 'scheduled' and
  // scheduled_at is not null and scheduled_at <= now()`, so 'scheduled' with no
  // time is not queued, it is stranded. Exhaustive over the input space rather
  // than over the branches I happen to remember writing.
  const flags = [false, true];
  for (const sawTransient of flags)
    for (const sawTerminal of flags)
      for (const sawPending of flags)
        for (const attempts of [1, 2, MAX_ATTEMPTS, MAX_ATTEMPTS + 1])
          for (const published of [0, 1, 2])
            for (const total of [0, 1, 2]) {
              const result = settle(
                attempt({
                  total,
                  published,
                  sawTransient,
                  sawTerminal,
                  sawPending,
                  attempts,
                })
              );
              if (result.status === "scheduled") {
                assert.ok(
                  result.retryInMs > 0,
                  `stranded: ${JSON.stringify({ sawTransient, sawTerminal, sawPending, attempts, published, total })}`
                );
              }
            }
});

test("the update for a retry always sets a FUTURE scheduled_at", () => {
  const now = new Date("2026-07-28T17:18:00.000Z");
  const result = settle(attempt({ sawPending: true }));
  assert.equal(result.status, "scheduled");
  const update = settlementUpdate(result, now, 0, 2);
  assert.ok(
    new Date(update.scheduled_at as string).getTime() > now.getTime(),
    "a past or null scheduled_at is what stranded the Reel"
  );
});

test("only a retry writes scheduled_at at all", () => {
  // A published or failed post must not have its schedule rewritten; the column
  // means 'when to try next' only while there is a next time.
  const now = new Date("2026-07-28T17:18:00.000Z");
  for (const a of [
    attempt({ published: 2 }), // published
    attempt({ sawTerminal: true }), // failed
    attempt({ sawTerminal: true, published: 1 }), // partial
  ]) {
    const update = settlementUpdate(settle(a), now, a.published, a.total);
    assert.equal(update.scheduled_at, undefined);
  }
});

// --- the real 3ced80b8 case ------------------------------------------------

test("the stranded Reel: both targets pending, from Publish now", () => {
  // Two targets, neither published, both waiting on Meta's encoder. This is the
  // exact shape that wrote 'scheduled' with a null scheduled_at.
  const result = settle(
    attempt({ total: 2, published: 0, sawPending: true, attempts: 1 })
  );
  assert.equal(result.status, "scheduled");
  assert.ok("retryInMs" in result && result.retryInMs > 0);
  // And waiting is not an attempt.
  assert.equal(result.attempts, 0);
});

test("waiting never exhausts the attempt budget", () => {
  // A Reel that encodes slowly would otherwise be marked failed after three
  // ticks for the crime of being a video.
  for (const attempts of [1, MAX_ATTEMPTS, MAX_ATTEMPTS + 5]) {
    const result = settle(attempt({ sawPending: true, attempts }));
    assert.equal(result.status, "scheduled", `gave up at ${attempts}`);
  }
});

test("a transient failure DOES spend attempts, and stops at the cap", () => {
  assert.equal(
    settle(attempt({ sawTransient: true, attempts: 1 })).status,
    "scheduled"
  );
  assert.equal(
    settle(attempt({ sawTransient: true, attempts: MAX_ATTEMPTS })).status,
    "failed"
  );
});

test("pending mixed with a real failure is not treated as merely waiting", () => {
  const result = settle(
    attempt({ sawPending: true, sawTransient: true, attempts: MAX_ATTEMPTS })
  );
  assert.equal(result.status, "failed");
  assert.equal(result.attempts, MAX_ATTEMPTS, "the attempt is not given back");
});

// --- the ordinary outcomes, unchanged --------------------------------------

test("all targets done is published", () => {
  const result = settle(attempt({ published: 2 }));
  assert.equal(result.status, "published");
  const update = settlementUpdate(result, new Date(), 2, 2);
  assert.ok(update.published_at);
  assert.equal(update.last_error, null);
});

test("some done, something terminal, is partial and says the count", () => {
  const result = settle(attempt({ published: 1, sawTerminal: true }));
  assert.equal(result.status, "partial");
  assert.equal(
    settlementUpdate(result, new Date(), 1, 2).last_error,
    "1/2 targets published."
  );
});

test("an already-published target counts toward done", () => {
  // skipped is idempotency doing its job, not a failure.
  assert.equal(
    settle(attempt({ published: 1, skipped: 1 })).status,
    "published"
  );
});

test("a post with no targets fails rather than claiming success", () => {
  assert.equal(settle(attempt({ total: 0 })).status, "failed");
});
