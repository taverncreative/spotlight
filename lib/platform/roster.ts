import type {
  PlatformAggregates,
  PlatformWorkspace,
} from "@/lib/platform/types";
import {
  daysAgo,
  daysSince,
  planLine,
  pounds,
  shortDate,
} from "@/lib/platform/format";

// Cohorts: every count on this page that refers to workspaces, turned back into
// the workspaces it counted.
//
// At two workspaces a count is strictly worse than a list, because the list
// carries the count inside it. "1 trialing" and "Slick Automations, trial ends
// 18 Aug" are the same fact, and only one of them can be acted on. These are
// derived from the workspace rows rather than read from the aggregates, so each
// member arrives with the detail that makes it actionable.
//
// EXPECTED. Each cohort also carries the figure BSK View reports for it, when
// it reports one. Normally they agree and the number is never shown. When they
// disagree, the aggregate is the truth and our list is incomplete, and saying so
// is the difference between a partial list and a wrong one.

export type CohortKey =
  | "trialing"
  | "subscribed"
  | "past_due"
  | "no_subscription"
  | "new_30d"
  | "nobody_working";

export type CohortMember = {
  workspace: PlatformWorkspace;
  // The one fact that makes this membership worth reading: when the trial ends,
  // what they pay, how long it has been quiet.
  note: string;
};

export type Cohort = {
  key: CohortKey;
  label: string;
  // What zero members means here. "Nobody is trialling" and "nobody has gone
  // quiet" are opposite kinds of news and must not share a dash.
  empty: string;
  members: CohortMember[];
  expected: number | null;
};

// Long enough that a client who raised a quote a fortnight ago is not called
// idle, short enough that a month of silence surfaces before the renewal does.
const NO_WORK_WITHIN_DAYS = 30;

function trialNote(w: PlatformWorkspace): string {
  const days = w.trial_days_remaining;
  if (days === null) {
    return w.trial_ends_at
      ? `trial ends ${shortDate(w.trial_ends_at)}`
      : "trial, no end date reported";
  }
  if (days < 0) {
    const n = Math.abs(days);
    return `trial lapsed ${n} ${n === 1 ? "day" : "days"} ago, still free`;
  }
  const ends = w.trial_ends_at ? `${shortDate(w.trial_ends_at)}, ` : "";
  if (days === 0) return `${ends}ends today`;
  return `${ends}${days} ${days === 1 ? "day" : "days"} left`;
}

function planNote(w: PlatformWorkspace): string {
  return `${planLine(w.plan_key, w.billing_period, w.subscription_status)} · ${pounds(w.mrr_pence_estimated_from_plan_prices)}`;
}

// The most recent evidence of actual work, as a phrase. Shared with the
// attention list's rule: exact record timestamps, never the sign-in value.
export function lastWork(
  w: PlatformWorkspace
): { at: string; what: "quote" | "invoice" } | null {
  const quote = w.last_quote_created_at;
  const invoice = w.last_invoice_created_at;
  if (quote && invoice) {
    return quote > invoice
      ? { at: quote, what: "quote" }
      : { at: invoice, what: "invoice" };
  }
  if (quote) return { at: quote, what: "quote" };
  if (invoice) return { at: invoice, what: "invoice" };
  return null;
}

// Nobody working in it: no quote and no invoice inside the window. Deliberately
// NOT built on sign-in dates, which move only on a real credential sign-in and
// would call a daily user idle.
export function isQuiet(w: PlatformWorkspace, now: Date = new Date()): boolean {
  const work = lastWork(w);
  if (!work) return true;
  return daysSince(work.at, now) > NO_WORK_WITHIN_DAYS;
}

// How long it has been quiet, in days. With no work ever recorded there is
// nothing to count from, so the age of the workspace is the honest answer: a
// four-day-old workspace has done nothing in four days, not in forever.
export function quietDays(
  w: PlatformWorkspace,
  now: Date = new Date()
): number {
  const work = lastWork(w);
  return work ? daysSince(work.at, now) : w.age_days;
}

function quietNote(w: PlatformWorkspace, now: Date): string {
  const work = lastWork(w);
  if (work) return `last ${work.what} ${daysAgo(work.at, now)}`;
  // A brand-new workspace with nothing raised is not the same finding as an
  // old one with nothing raised, and the age is what tells them apart.
  return `nothing raised yet · signed up ${w.age_days} ${w.age_days === 1 ? "day" : "days"} ago`;
}

// ONE LINE PER WORKSPACE: name, state, the one number that matters, and the
// single most actionable fact. Two workspaces is two lines and forty is forty
// lines that still scan, which is the whole reason a line beats a card.
export type RosterLine = {
  workspace: PlatformWorkspace;
  // Plan and money, or where the trial has got to. The number that matters.
  state: string;
  stateTone: "ok" | "warn" | "danger" | "muted";
  // Whether anybody is actually working in it. Quotes and invoices, not
  // sign-ins.
  signal: string;
  signalQuiet: boolean;
};

// Plan keys arrive lower-case and machine-shaped. This is the only place they
// are made presentable, so "autopilot" reads as Autopilot on the line.
function planName(planKey: string): string {
  return planKey.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function stateOf(w: PlatformWorkspace): {
  state: string;
  stateTone: RosterLine["stateTone"];
} {
  const money = pounds(w.mrr_pence_estimated_from_plan_prices);
  const plan = w.plan_key ? planName(w.plan_key) : "No plan";
  const remaining = w.trial_days_remaining;

  if (w.subscription_status === "past_due") {
    return { state: `Past due · ${plan} ${money}`, stateTone: "danger" };
  }
  if (w.subscription_status === "trialing") {
    if (remaining === null) return { state: "Trial", stateTone: "warn" };
    if (remaining < 0) {
      const n = Math.abs(remaining);
      return {
        state: `Trial lapsed ${n} ${n === 1 ? "day" : "days"} ago`,
        stateTone: "danger",
      };
    }
    if (remaining === 0)
      return { state: "Trial ends today", stateTone: "warn" };
    return {
      state: `Trial, ${remaining} ${remaining === 1 ? "day" : "days"} left`,
      stateTone: "warn",
    };
  }
  if (w.subscription_status === "canceled") {
    return { state: "Cancelled", stateTone: "muted" };
  }
  if (!w.subscription_status || w.subscription_status === "none") {
    return { state: "No subscription", stateTone: "danger" };
  }
  // Paying. The one number that matters is what they pay, per month, whatever
  // the billing period: BSK View has already divided an annual price down.
  return { state: `${plan} ${money}/mo`, stateTone: "ok" };
}

export function buildRoster(
  workspaces: PlatformWorkspace[],
  now: Date = new Date()
): RosterLine[] {
  return workspaces
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB"))
    .map((w) => {
      const work = lastWork(w);
      const quiet = isQuiet(w, now);
      return {
        workspace: w,
        ...stateOf(w),
        signal: !work
          ? "nothing yet"
          : quiet
            ? `quiet ${quietDays(w, now)} days`
            : `active ${daysAgo(work.at, now)}`,
        signalQuiet: quiet,
      };
    });
}

// Is the platform being used at all: how many live workspaces have raised a
// quote or an invoice inside the window, out of how many there are. The one
// figure that fails silently, because a client who stops using it does not
// write in to say so.
export function usage(
  workspaces: PlatformWorkspace[],
  now: Date = new Date()
): { working: number; of: number } {
  const live = workspaces.filter((w) => w.status !== "archived");
  return {
    working: live.filter((w) => !isQuiet(w, now)).length,
    of: live.length,
  };
}

// Below this many workspaces the roster IS the cohorts: every line is on screen
// at once, so "who is trialling" is answered by reading the second column, and a
// cohort block above it would say the same thing twice in a worse shape. Twelve,
// because that is about where a list stops being something you read whole and
// starts being something you scan for a category, and where the grouping starts
// carrying information the lines no longer volunteer.
export const COHORT_THRESHOLD = 12;

export function buildCohorts(
  workspaces: PlatformWorkspace[],
  platform: PlatformAggregates,
  now: Date = new Date()
): Cohort[] {
  const live = workspaces.filter((w) => w.status !== "archived");

  const member = (
    list: PlatformWorkspace[],
    note: (w: PlatformWorkspace) => string
  ): CohortMember[] =>
    list
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "en-GB"))
      .map((w) => ({ workspace: w, note: note(w) }));

  return [
    {
      key: "trialing",
      label: "Trialling",
      empty: "Nobody is on a trial.",
      members: member(
        live.filter((w) => w.subscription_status === "trialing"),
        trialNote
      ),
      expected: platform.subscriptions_trialing,
    },
    {
      key: "subscribed",
      label: "Subscribed",
      empty: "Nobody is paying yet.",
      members: member(
        live.filter((w) => w.subscription_status === "active"),
        planNote
      ),
      expected: platform.subscriptions_active,
    },
    {
      key: "past_due",
      label: "Payment past due",
      empty: "Every subscription is paid up.",
      members: member(
        live.filter((w) => w.subscription_status === "past_due"),
        planNote
      ),
      expected: platform.subscriptions_past_due,
    },
    {
      key: "no_subscription",
      label: "Provisioned, never subscribed",
      empty: "Every workspace has a subscription row.",
      members: member(
        live.filter(
          (w) => !w.subscription_status || w.subscription_status === "none"
        ),
        (w) =>
          `no subscription row · ${w.age_days} ${w.age_days === 1 ? "day" : "days"} old`
      ),
      expected: platform.subscriptions_none,
    },
    {
      key: "new_30d",
      label: "Signed up in the last 30 days",
      empty: "No new workspaces this month.",
      members: member(
        live.filter((w) => w.age_days <= 30),
        (w) => `signed up ${daysAgo(w.created_at, now)}`
      ),
      expected: platform.workspaces_created_last_30d,
    },
    {
      key: "nobody_working",
      label: "Nobody working in it",
      empty: "Every workspace has raised something in the last 30 days.",
      members: member(
        live.filter((w) => isQuiet(w, now)),
        (w) => quietNote(w, now)
      ),
      // BSK View reports no equivalent aggregate; this rule is ours.
      expected: null,
    },
  ];
}

// The cohort list and BSK View's own count disagree. Only ever true when
// something is wrong, so the UI can render it as an alarm rather than a note.
export function cohortDisagrees(cohort: Cohort): boolean {
  return cohort.expected !== null && cohort.expected !== cohort.members.length;
}
