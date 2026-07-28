// How a publish attempt settles: the post's terminal status, and when to look
// again. Pure, so the decision can be tested without a database or a Graph API.
//
// WHY THIS IS ITS OWN MODULE. It used to be an if/else at the bottom of
// publishPost, and it wrote a state the claimer could not claim. The cron's
// claim query is:
//
//   status = 'scheduled' and scheduled_at is not null and scheduled_at <= now()
//
// so a post left at 'scheduled' with a null scheduled_at is not queued, it is
// stranded -- invisible to the only thing that would ever pick it up again.
// That is exactly what happened to a Reel published from the composer: Publish
// now stores scheduled_at as null, both targets came back pending, the status
// machine wrote 'scheduled' to mean "next tick", and no next tick was possible.
// It sat there with a finished Instagram container going stale.
//
// THE INVARIANT: a settlement of 'scheduled' ALWAYS carries a retryAt. The type
// makes them one object rather than two independent writes, and settle() is the
// only thing that constructs it, so there is no path that sets the status and
// forgets the time.

export const MAX_ATTEMPTS = 3;

// How long to wait before the next attempt. Long enough that Meta's encoder has
// moved on since the last poll, short enough that a Reel published from the
// composer appears while the operator still remembers posting it. The cron tick
// is the real floor: this only decides which tick is the first eligible one.
export const RETRY_AFTER_MS = 2 * 60 * 1000; // 2 minutes

export type Attempt = {
  total: number;
  published: number;
  skipped: number;
  sawTransient: boolean;
  // auth, validation, or interrupted
  sawTerminal: boolean;
  // PENDING IS NOT FAILURE. Meta is still encoding; coming back later must not
  // cost one of three attempts, or a Reel that takes twelve minutes gets marked
  // failed for the crime of being a video.
  sawPending: boolean;
  attempts: number;
};

export type Settlement =
  | { status: "published" | "partial" | "failed"; attempts: number }
  | { status: "scheduled"; attempts: number; retryInMs: number };

export function settle(attempt: Attempt): Settlement {
  const { total, published, skipped, attempts } = attempt;
  const allPublished = total > 0 && published + skipped === total;
  // Nothing went wrong; something is merely not ready.
  const pendingOnly =
    attempt.sawPending && !attempt.sawTransient && !attempt.sawTerminal;

  // Give the attempt back when all we did was wait. Rolled back rather than
  // never counted, because the increment happens when the post is claimed, long
  // before anyone knows what will happen to it.
  const settledAttempts = pendingOnly ? Math.max(0, attempts - 1) : attempts;

  if (allPublished) return { status: "published", attempts: settledAttempts };

  // Give up now: a terminal failure is present, or transient retries are spent.
  // pendingOnly is exempt because nothing has failed, we are waiting.
  if (attempt.sawTerminal || (attempts >= MAX_ATTEMPTS && !pendingOnly)) {
    return {
      status: published + skipped > 0 ? "partial" : "failed",
      attempts: settledAttempts,
    };
  }

  if (attempt.sawTransient || attempt.sawPending) {
    // The only branch that comes back, and therefore the only one that may say
    // 'scheduled'. retryInMs travels with it so the caller cannot write the
    // status without the time.
    return {
      status: "scheduled",
      attempts: settledAttempts,
      retryInMs: RETRY_AFTER_MS,
    };
  }

  // No targets at all, or nothing actionable.
  return {
    status: total === 0 ? "failed" : "partial",
    attempts: settledAttempts,
  };
}

// The row update a settlement implies. Kept here rather than at the call site so
// that scheduled_at is written by the same thing that decided to retry.
//
// scheduled_at MOVES on a retry, including for a post the operator scheduled for
// a particular time. That is deliberate: once the original time has passed, the
// column's only remaining job is to say when to try next, and a stale past value
// would mean every tick re-claims a post that is waiting on Meta's encoder.
export function settlementUpdate(
  settlement: Settlement,
  now: Date,
  publishedCount: number,
  total: number
): Record<string, unknown> {
  const update: Record<string, unknown> = {
    status: settlement.status,
    attempts: settlement.attempts,
  };
  if (settlement.status === "published") {
    update.published_at = now.toISOString();
    update.last_error = null;
  } else if (settlement.status === "scheduled") {
    update.scheduled_at = new Date(
      now.getTime() + settlement.retryInMs
    ).toISOString();
    update.last_error = null;
  } else {
    update.last_error = `${publishedCount}/${total} targets published.`;
  }
  return update;
}
