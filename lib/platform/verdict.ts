import type {
  PlatformAggregates,
  PlatformWorkspace,
} from "@/lib/platform/types";
import { isQuiet, quietDays } from "@/lib/platform/roster";
import { pounds } from "@/lib/platform/format";

// Zone 1: is anything wrong, and if so with whom. One line.
//
// This is the only question somebody holds when they open the page, so it is
// answered first, in a sentence, before any table. Everything below it is
// there for the mornings when the answer is yes and John wants to know more.
//
// THE EMPTY ANSWER IS THE COMMON ONE. "Nothing needs you today" is what this
// returns most mornings, and that is the console working. It is not padded out
// with a summary of how healthy everything is, because a screen that always has
// something on it teaches you to stop reading it.
//
// Every concern below is derived from facts already on the page. Nothing new is
// measured here; this is the same information ranked by whether it needs
// somebody now.

export type Concern = {
  // Ranked, lowest first. The ranking is the editorial judgement: money already
  // lost, then money about to be lost, then a queue we are holding, then
  // somebody quietly not getting value.
  rank: number;
  line: string;
  tone: "danger" | "warn";
  // The workspace it is about, so the roster can be scrolled to it. Absent for
  // the requests concern, which is about our own queue.
  organisation_id: string | null;
};

export type Verdict =
  | { state: "clear"; line: string }
  | { state: "concern"; headline: Concern; others: number };

function days(n: number, one = "day", many = "days"): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function concernsFor(
  workspaces: PlatformWorkspace[],
  platform: PlatformAggregates,
  now: Date = new Date()
): Concern[] {
  const concerns: Concern[] = [];
  const live = workspaces.filter((w) => w.status !== "archived");

  for (const w of live) {
    const id = w.organisation_id;
    const remaining = w.trial_days_remaining;

    if (w.subscription_status === "past_due") {
      concerns.push({
        rank: 0,
        tone: "danger",
        line: `${w.name} is past due on ${pounds(w.mrr_pence_estimated_from_plan_prices)}`,
        organisation_id: id,
      });
    }

    if (
      w.subscription_status === "trialing" &&
      remaining !== null &&
      remaining < 0
    ) {
      concerns.push({
        rank: 1,
        tone: "danger",
        line: `${w.name}'s trial lapsed ${days(Math.abs(remaining))} ago and is still free`,
        organisation_id: id,
      });
    }

    if (!w.subscription_status || w.subscription_status === "none") {
      concerns.push({
        rank: 2,
        tone: "danger",
        line: `${w.name} has no subscription, ${days(w.age_days)} after signing up`,
        organisation_id: id,
      });
    }

    if (
      w.subscription_status === "trialing" &&
      remaining !== null &&
      remaining >= 0 &&
      remaining <= 7
    ) {
      concerns.push({
        rank: 4,
        tone: "warn",
        line:
          remaining === 0
            ? `${w.name}'s trial ends today`
            : `${w.name}'s trial ends in ${days(remaining)}`,
        organisation_id: id,
      });
    }

    // The one John asked for by name. Built on quote and invoice timestamps,
    // never on sign-ins.
    if (isQuiet(w, now)) {
      concerns.push({
        rank: 5,
        tone: "warn",
        line: `${w.name} has done nothing in ${days(quietDays(w, now))}`,
        organisation_id: id,
      });
    }
  }

  // Our own queue, not a workspace's problem, but it is still an answer to "is
  // anything waiting on me".
  if (platform.requests_awaiting_agency > 0) {
    const n = platform.requests_awaiting_agency;
    concerns.push({
      rank: 3,
      tone: "warn",
      line: `${n} ${n === 1 ? "request is" : "requests are"} waiting on us`,
      organisation_id: null,
    });
  }

  return concerns.sort(
    (a, b) => a.rank - b.rank || a.line.localeCompare(b.line, "en-GB")
  );
}

export function buildVerdict(
  workspaces: PlatformWorkspace[],
  platform: PlatformAggregates,
  now: Date = new Date()
): Verdict {
  const concerns = concernsFor(workspaces, platform, now);
  if (concerns.length === 0) {
    return { state: "clear", line: "Nothing needs you today." };
  }
  return {
    state: "concern",
    headline: concerns[0],
    others: concerns.length - 1,
  };
}
