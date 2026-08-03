import type { PlatformWorkspace } from "@/lib/platform/types";

// Who needs chasing, derived from the workspace rows.
//
// This is the page. Totals are satisfying and rarely actionable; a list of five
// workspaces to chase on a Tuesday morning is worth opening. Everything here is
// pure so it can be tested without a network, and so the rules are readable in
// one place rather than scattered through JSX.

export type AttentionKind =
  | "trial_lapsed"
  | "no_subscription"
  | "past_due"
  | "trial_ending"
  | "never_returned"
  | "barely_using"
  | "awaiting_client";

export type AttentionReason = {
  kind: AttentionKind;
  // What the row says. Written to be read aloud: "Trial lapsed 12 days ago".
  label: string;
  tone: "danger" | "warn" | "info";
};

export type AttentionRow = {
  workspace: PlatformWorkspace;
  reasons: AttentionReason[];
  // The worst reason's rank, used to order the list. Lower is more urgent.
  urgency: number;
};

// Order of the list, and the left-edge colour of each row. A workspace can
// carry several reasons; it appears once, ranked by its worst.
const RANK: Record<AttentionKind, number> = {
  trial_lapsed: 0,
  past_due: 1,
  no_subscription: 2,
  trial_ending: 3,
  never_returned: 4,
  barely_using: 5,
  awaiting_client: 6,
};

// "Signed up and never came back" only means something while signing up is
// recent. Past this, an untouched workspace is a "barely using it" problem, and
// saying "never came back" about a six-month-old account reads as noise.
const NEVER_RETURNED_MAX_AGE_DAYS = 60;

// Long enough that a quiet first fortnight is not called a problem. Matches the
// 14-day threshold BSK View itself uses for enabled_but_idle.
const BARELY_USING_MIN_AGE_DAYS = 14;

// Entitled to this many modules more than are switched on, and nothing to show
// for the ones that are: that is a workspace not getting the value it pays for.
const UNUSED_ENTITLEMENT_THRESHOLD = 3;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// A subscription row that was never created at all. BSK View reports this as
// the subscriptions_none bucket at platform level; per workspace it arrives as
// a null or "none" status, and both mean the same thing.
function hasNoSubscription(w: PlatformWorkspace): boolean {
  return !w.subscription_status || w.subscription_status === "none";
}

export function reasonsFor(w: PlatformWorkspace): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  const days = w.trial_days_remaining;

  // A trial that has overrun: they are getting the plan free because nobody
  // chased it. The most expensive row on the page, so it leads.
  if (w.subscription_status === "trialing" && days !== null && days < 0) {
    reasons.push({
      kind: "trial_lapsed",
      label: `Trial lapsed ${plural(Math.abs(days), "day", "days")} ago`,
      tone: "danger",
    });
  }

  if (w.subscription_status === "past_due") {
    reasons.push({
      kind: "past_due",
      label: "Payment past due",
      tone: "danger",
    });
  }

  if (hasNoSubscription(w)) {
    reasons.push({
      kind: "no_subscription",
      label: "Provisioned, never subscribed",
      tone: "danger",
    });
  }

  if (
    w.subscription_status === "trialing" &&
    days !== null &&
    days >= 0 &&
    days <= 7
  ) {
    reasons.push({
      kind: "trial_ending",
      label:
        days === 0
          ? "Trial ends today"
          : `Trial ends in ${plural(days, "day", "days")}`,
      tone: "warn",
    });
  }

  // Signed up, and at least one member has never signed in even once, with no
  // work to show for it. members_never_signed_in is exact: it is a count of
  // accounts with no sign-in at all, not a stale-timestamp guess.
  if (
    w.members_never_signed_in > 0 &&
    !w.has_raised_quote &&
    !w.has_sent_invoice &&
    w.age_days <= NEVER_RETURNED_MAX_AGE_DAYS
  ) {
    reasons.push({
      kind: "never_returned",
      label:
        w.members_active <= 1
          ? "Signed up, never came back"
          : `${plural(w.members_never_signed_in, "member", "members")} never signed in`,
      tone: "info",
    });
  }

  // Settled in long enough to have done something, and has not. Either nothing
  // has ever been raised, or a good chunk of what they are entitled to was
  // never switched on.
  if (w.age_days >= BARELY_USING_MIN_AGE_DAYS) {
    const nothingRaised = w.quotes_count === 0 && w.invoices_count === 0;
    const unusedEntitlement =
      w.modules_entitled_not_enabled >= UNUSED_ENTITLEMENT_THRESHOLD;
    if (nothingRaised || unusedEntitlement) {
      reasons.push({
        kind: "barely_using",
        label: nothingRaised
          ? "No quotes or invoices raised"
          : `${plural(w.modules_entitled_not_enabled, "paid module", "paid modules")} never switched on`,
        tone: "info",
      });
    }
  }

  if (w.requests_awaiting_client > 0) {
    reasons.push({
      kind: "awaiting_client",
      label: `${plural(w.requests_awaiting_client, "request", "requests")} waiting on them`,
      tone: "info",
    });
  }

  return reasons;
}

// Modules switched on 14+ days ago that have produced nothing in the window.
// Only measured modules can be idle: Calendar, Templates and Automations report
// null and BSK View already excludes them, but we do not rely on that.
export function idleModules(w: PlatformWorkspace): string[] {
  return w.modules
    .filter((m) => m.measured && m.enabled_but_idle)
    .map((m) => m.module);
}

// The most recent evidence that somebody was actually working, preferring the
// exact record timestamps over the sign-in value. Returns null when there is no
// evidence at all, which is itself the finding.
export function lastWorkAt(
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

// The list, worst first. Archived workspaces are dropped: there is nobody to
// chase. Suspended ones are kept, because a suspension is exactly the sort of
// thing that should not be quietly sitting there.
export function buildAttentionList(
  workspaces: PlatformWorkspace[]
): AttentionRow[] {
  return workspaces
    .filter((w) => w.status !== "archived")
    .map((w) => {
      const reasons = reasonsFor(w);
      return {
        workspace: w,
        reasons,
        urgency: reasons.length
          ? Math.min(...reasons.map((r) => RANK[r.kind]))
          : Number.POSITIVE_INFINITY,
      };
    })
    .filter((row) => row.reasons.length > 0)
    .sort(
      (a, b) =>
        a.urgency - b.urgency ||
        a.workspace.name.localeCompare(b.workspace.name, "en-GB")
    );
}
