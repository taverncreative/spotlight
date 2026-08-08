import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVerdict, concernsFor } from "@/lib/platform/verdict";
import { buildRoster, usage } from "@/lib/platform/roster";
import type {
  PlatformAggregates,
  PlatformWorkspace,
} from "@/lib/platform/types";

const NOW = new Date("2026-08-08T09:00:00.000Z");

// A paying workspace that somebody is working in, twelve days ago. Nothing to
// say about it.
function workspace(
  overrides: Partial<PlatformWorkspace> = {}
): PlatformWorkspace {
  return {
    organisation_id: "org-1",
    name: "BSK",
    slug: "bsk",
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
    last_invoice_created_at: "2026-08-07T07:41:51.115Z",
    last_credential_sign_in_at: "2026-08-07T06:00:29.570Z",
    sign_in_snapshot_observed_on: "2026-08-08",
    members_never_signed_in: 0,
    open_requests: 0,
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
    requests_by_status: {},
    requests_awaiting_agency: 0,
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

// --- zone 1 ---------------------------------------------------------------

test("a healthy platform says nothing needs you, and says only that", () => {
  const v = buildVerdict([workspace()], aggregates(), NOW);
  assert.equal(v.state, "clear");
  assert.equal(v.state === "clear" && v.line, "Nothing needs you today.");
});

test("the headline names the workspace and counts what is left", () => {
  const quiet = workspace({
    organisation_id: "org-2",
    name: "Slick Automations",
    subscription_status: "trialing",
    plan_key: null,
    trial_ends_at: "2026-08-18T06:24:07.471Z",
    trial_days_remaining: 10,
    last_quote_created_at: null,
    last_invoice_created_at: null,
    age_days: 4,
  });
  const v = buildVerdict(
    [workspace(), quiet],
    aggregates({ requests_awaiting_agency: 3, workspaces_total: 2 }),
    NOW
  );

  assert.equal(v.state, "concern");
  if (v.state !== "concern") return;
  // Our own queue outranks a four-day-old trial going quiet.
  assert.equal(v.headline.line, "3 requests are waiting on us");
  assert.equal(v.others, 1);
});

test("money already lost outranks money about to be", () => {
  const pastDue = workspace({
    organisation_id: "org-3",
    name: "Late Ltd",
    subscription_status: "past_due",
  });
  const endingSoon = workspace({
    organisation_id: "org-4",
    name: "Nearly Ltd",
    subscription_status: "trialing",
    trial_days_remaining: 2,
  });
  const v = buildVerdict(
    [endingSoon, pastDue],
    aggregates({ workspaces_total: 2 }),
    NOW
  );
  assert.equal(
    v.state === "concern" && v.headline.line,
    "Late Ltd is past due on £79"
  );
});

test("a workspace that has raised nothing is counted from its signup, not from forever", () => {
  const w = workspace({
    name: "Slick Automations",
    last_quote_created_at: null,
    last_invoice_created_at: null,
    age_days: 4,
  });
  const [concern] = concernsFor([w], aggregates(), NOW);
  assert.equal(concern.line, "Slick Automations has done nothing in 4 days");
});

test("archived workspaces raise nothing", () => {
  const gone = workspace({
    status: "archived",
    subscription_status: "past_due",
    last_quote_created_at: null,
    last_invoice_created_at: null,
  });
  assert.deepEqual(concernsFor([gone], aggregates(), NOW), []);
});

// --- zone 2 ---------------------------------------------------------------

test("a paying workspace's line is plan, monthly money and when it was last worked in", () => {
  const [line] = buildRoster([workspace()], NOW);
  assert.equal(line.state, "Autopilot £79/mo");
  assert.equal(line.stateTone, "ok");
  assert.equal(line.signal, "active yesterday");
  assert.equal(line.signalQuiet, false);
});

test("a trial's line is how long it has left, and a lapsed one says so", () => {
  const [live] = buildRoster(
    [workspace({ subscription_status: "trialing", trial_days_remaining: 10 })],
    NOW
  );
  assert.equal(live.state, "Trial, 10 days left");
  assert.equal(live.stateTone, "warn");

  const [lapsed] = buildRoster(
    [workspace({ subscription_status: "trialing", trial_days_remaining: -3 })],
    NOW
  );
  assert.equal(lapsed.state, "Trial lapsed 3 days ago");
  assert.equal(lapsed.stateTone, "danger");
});

test("a workspace with nothing raised reads as nothing yet, not as zero", () => {
  const [line] = buildRoster(
    [
      workspace({
        last_quote_created_at: null,
        last_invoice_created_at: null,
        age_days: 4,
      }),
    ],
    NOW
  );
  assert.equal(line.signal, "nothing yet");
  assert.equal(line.signalQuiet, true);
});

test("a workspace worked in months ago reads as quiet, with the gap", () => {
  const [line] = buildRoster(
    [
      workspace({
        last_quote_created_at: "2026-06-01T00:00:00.000Z",
        last_invoice_created_at: null,
      }),
    ],
    NOW
  );
  assert.equal(line.signal, "quiet 68 days");
  assert.equal(line.signalQuiet, true);
});

test("a workspace with no subscription row says so where the money would be", () => {
  const [line] = buildRoster(
    [workspace({ subscription_status: null, plan_key: null })],
    NOW
  );
  assert.equal(line.state, "No subscription");
  assert.equal(line.stateTone, "danger");
});

// --- the default-view figures --------------------------------------------

test("usage counts workspaces somebody is working in, and ignores archived ones", () => {
  const working = workspace({ organisation_id: "org-a" });
  const quiet = workspace({
    organisation_id: "org-b",
    last_quote_created_at: null,
    last_invoice_created_at: null,
  });
  const gone = workspace({ organisation_id: "org-c", status: "archived" });

  assert.deepEqual(usage([working, quiet, gone], NOW), { working: 1, of: 2 });
});

test("usage on an empty platform is 0 of 0, not a division", () => {
  assert.deepEqual(usage([], NOW), { working: 0, of: 0 });
});
