import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCohorts, cohortDisagrees, isQuiet } from "@/lib/platform/roster";
import type {
  PlatformAggregates,
  PlatformWorkspace,
} from "@/lib/platform/types";

// Fixed "now", so "10 days left" is a fact about the fixture rather than about
// the day the suite runs.
const NOW = new Date("2026-08-08T09:00:00.000Z");

function workspace(
  overrides: Partial<PlatformWorkspace> = {}
): PlatformWorkspace {
  return {
    organisation_id: "org-1",
    name: "Medway Plumbing",
    slug: "medway-plumbing",
    status: "active",
    created_at: "2026-06-22T14:24:02.260Z",
    age_days: 47,
    plan_key: "autopilot",
    subscription_status: "active",
    billing_period: "monthly",
    trial_ends_at: null,
    trial_days_remaining: null,
    mrr_pence_estimated_from_plan_prices: 7900,
    owner_email: "owner@example.co.uk",
    members_active: 2,
    members_invited_never_accepted: 0,
    modules_entitled_count: 19,
    modules_enabled_count: 18,
    modules_entitled_not_enabled: 1,
    modules_enabled: ["quotes"],
    onboarding_completed_at: null,
    onboarding_trade: null,
    leads_count: 4,
    customers_count: 4,
    quotes_count: 2,
    invoices_count: 1,
    has_raised_quote: true,
    has_sent_invoice: true,
    last_quote_created_at: "2026-07-27T04:24:24.926Z",
    last_invoice_created_at: "2026-07-27T07:41:51.115Z",
    last_credential_sign_in_at: "2026-08-07T06:00:29.570Z",
    sign_in_snapshot_observed_on: "2026-08-08",
    members_never_signed_in: 0,
    open_requests: 3,
    requests_awaiting_client: 0,
    modules: [],
    ...overrides,
  };
}

function aggregates(
  overrides: Partial<PlatformAggregates> = {}
): PlatformAggregates {
  return {
    workspaces_total: 1,
    workspaces_active: 1,
    workspaces_suspended: 0,
    workspaces_archived: 0,
    workspaces_created_last_30d: 0,
    subscriptions_trialing: 0,
    subscriptions_active: 1,
    subscriptions_past_due: 0,
    subscriptions_canceled: 0,
    subscriptions_none: 0,
    trials_expiring_within_7d: 0,
    trials_overdue: 0,
    mrr_pence_estimated_from_plan_prices: 7900,
    at_risk_mrr_pence: 0,
    requests_by_status: { requested: 3 },
    requests_awaiting_agency: 3,
    requests_awaiting_client: 0,
    sign_in_snapshot_latest_observed_on: "2026-08-08",
    conversions_last_30d: 0,
    conversions_last_90d: 0,
    churn_last_30d: 0,
    churn_last_90d: 0,
    billing_events_since: "2026-08-03T16:09:41.741Z",
    modules: [],
    usage_not_measurable: {},
    ...overrides,
  };
}

function cohort(
  workspaces: PlatformWorkspace[],
  platform: PlatformAggregates,
  key: string
) {
  const found = buildCohorts(workspaces, platform, NOW).find(
    (c) => c.key === key
  );
  assert.ok(found, `no cohort ${key}`);
  return found;
}

function names(
  workspaces: PlatformWorkspace[],
  platform: PlatformAggregates,
  key: string
): string[] {
  return cohort(workspaces, platform, key).members.map((m) => m.workspace.name);
}

// --- names, not numbers ---------------------------------------------------

test("a trialling workspace is named with its end date and days left", () => {
  const w = workspace({
    name: "Slick Automations",
    subscription_status: "trialing",
    plan_key: null,
    billing_period: null,
    trial_ends_at: "2026-08-18T06:24:07.471Z",
    trial_days_remaining: 10,
  });
  const c = cohort([w], aggregates({ subscriptions_trialing: 1 }), "trialing");

  assert.deepEqual(
    c.members.map((m) => m.workspace.name),
    ["Slick Automations"]
  );
  assert.match(c.members[0].note, /18 Aug 2026/);
  assert.match(c.members[0].note, /10 days left/);
});

test("a trial that has overrun says so and says it is still free", () => {
  const w = workspace({
    subscription_status: "trialing",
    trial_ends_at: "2026-07-29T06:24:07.471Z",
    trial_days_remaining: -10,
  });
  const c = cohort([w], aggregates({ subscriptions_trialing: 1 }), "trialing");
  assert.match(c.members[0].note, /lapsed 10 days ago, still free/);
});

test("a subscribed workspace is named with plan, period and what it pays", () => {
  const c = cohort([workspace()], aggregates(), "subscribed");
  assert.equal(c.members[0].note, "autopilot · monthly · £79");
});

test("empty cohorts say what empty means rather than showing a zero", () => {
  const c = cohort([workspace()], aggregates(), "past_due");
  assert.deepEqual(c.members, []);
  assert.equal(c.empty, "Every subscription is paid up.");
});

// --- nobody working in it -------------------------------------------------

test("a workspace that has raised nothing at all counts as quiet", () => {
  const w = workspace({
    last_quote_created_at: null,
    last_invoice_created_at: null,
    quotes_count: 0,
    invoices_count: 0,
    age_days: 4,
  });
  assert.equal(isQuiet(w, NOW), true);
  assert.match(
    cohort([w], aggregates(), "nobody_working").members[0].note,
    /nothing raised yet · signed up 4 days ago/
  );
});

test("work inside 30 days is not quiet, work outside it is", () => {
  // 12 days before NOW.
  assert.equal(isQuiet(workspace(), NOW), false);
  const stale = workspace({
    last_quote_created_at: "2026-06-20T04:24:24.926Z",
    last_invoice_created_at: "2026-06-21T07:41:51.115Z",
  });
  assert.equal(isQuiet(stale, NOW), true);
  assert.match(
    cohort([stale], aggregates(), "nobody_working").members[0].note,
    /last invoice 48 days ago/
  );
});

test("quietness is read from record timestamps, never from the sign-in date", () => {
  // Signed in this morning, has raised nothing in months: still quiet. And the
  // reverse, which is the one that matters: months since a credential sign-in
  // while working daily is NOT quiet.
  const signedInWorkingNothing = workspace({
    last_credential_sign_in_at: "2026-08-08T07:00:00.000Z",
    last_quote_created_at: "2026-05-01T00:00:00.000Z",
    last_invoice_created_at: null,
  });
  assert.equal(isQuiet(signedInWorkingNothing, NOW), true);

  const workingNeverSignsIn = workspace({
    last_credential_sign_in_at: "2026-02-01T00:00:00.000Z",
    last_quote_created_at: "2026-08-06T00:00:00.000Z",
  });
  assert.equal(isQuiet(workingNeverSignsIn, NOW), false);
});

// --- archived, and reconciliation ----------------------------------------

test("archived workspaces are left out of the cohorts", () => {
  const archived = workspace({
    organisation_id: "org-2",
    name: "Gone Ltd",
    status: "archived",
    last_quote_created_at: null,
    last_invoice_created_at: null,
  });
  assert.deepEqual(
    names([workspace(), archived], aggregates(), "nobody_working"),
    []
  );
  assert.deepEqual(names([workspace(), archived], aggregates(), "subscribed"), [
    "Medway Plumbing",
  ]);
});

test("a cohort that disagrees with BSK View's own count is flagged", () => {
  const agreeing = cohort([workspace()], aggregates(), "subscribed");
  assert.equal(cohortDisagrees(agreeing), false);

  // BSK View says two are subscribed; only one workspace row says so.
  const short = cohort(
    [workspace()],
    aggregates({ subscriptions_active: 2 }),
    "subscribed"
  );
  assert.equal(cohortDisagrees(short), true);
});

test("the cohort we invented has no expected count, so it never disagrees", () => {
  const c = cohort([workspace()], aggregates(), "nobody_working");
  assert.equal(c.expected, null);
  assert.equal(cohortDisagrees(c), false);
});
