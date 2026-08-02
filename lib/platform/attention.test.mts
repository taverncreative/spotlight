import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAttentionList,
  idleModules,
  lastWorkAt,
  reasonsFor,
} from "@/lib/platform/attention";
import type { PlatformWorkspace, WorkspaceModule } from "@/lib/platform/types";

// A healthy, paying, working workspace: nothing to chase. Modelled on the real
// payload so the defaults are the shape BSK View actually sends.
function workspace(overrides: Partial<PlatformWorkspace> = {}): PlatformWorkspace {
  return {
    organisation_id: "org-1",
    name: "Medway Plumbing",
    slug: "medway-plumbing",
    status: "active",
    created_at: "2026-06-22T14:24:02.260Z",
    age_days: 40,
    plan_key: "autopilot",
    subscription_status: "active",
    billing_period: "annual",
    trial_ends_at: null,
    trial_days_remaining: null,
    mrr_pence_estimated_from_plan_prices: 375,
    owner_email: "owner@example.co.uk",
    members_active: 1,
    members_invited_never_accepted: 0,
    modules_entitled_count: 18,
    modules_enabled_count: 18,
    modules_entitled_not_enabled: 0,
    modules_enabled: ["quotes"],
    onboarding_completed_at: null,
    onboarding_trade: null,
    leads_count: 3,
    customers_count: 4,
    quotes_count: 2,
    invoices_count: 1,
    has_raised_quote: true,
    has_sent_invoice: true,
    last_quote_created_at: "2026-07-27T04:24:24.926Z",
    last_invoice_created_at: "2026-07-27T07:41:51.115Z",
    last_credential_sign_in_at: "2026-07-29T08:50:34.490Z",
    sign_in_snapshot_observed_on: "2026-08-02",
    members_never_signed_in: 0,
    open_requests: 0,
    requests_awaiting_client: 0,
    modules: [],
    ...overrides,
  };
}

function module(overrides: Partial<WorkspaceModule> = {}): WorkspaceModule {
  return {
    module: "quotes",
    entitled: true,
    enabled: true,
    enabled_at: "2026-07-24T09:03:20.127Z",
    setup_completed: true,
    measured: true,
    last_used_at: "2026-07-27T04:24:24.926Z",
    records_last_30d: 2,
    records_last_90d: 2,
    enabled_but_idle: false,
    ...overrides,
  };
}

function kinds(w: PlatformWorkspace): string[] {
  return reasonsFor(w).map((r) => r.kind);
}

// --- the healthy case must stay off the list ------------------------------

test("a paying workspace that is being used raises nothing", () => {
  assert.deepEqual(reasonsFor(workspace()), []);
  assert.deepEqual(buildAttentionList([workspace()]), []);
});

// --- trials ---------------------------------------------------------------

test("an overrun trial is the most urgent row and says how long it has run", () => {
  const w = workspace({ subscription_status: "trialing", trial_days_remaining: -12 });
  const [reason] = reasonsFor(w);
  assert.equal(reason.kind, "trial_lapsed");
  assert.equal(reason.label, "Trial lapsed 12 days ago");
  assert.equal(reason.tone, "danger");
});

test("a trial lapsed by one day says day, not days", () => {
  const w = workspace({ subscription_status: "trialing", trial_days_remaining: -1 });
  assert.equal(reasonsFor(w)[0].label, "Trial lapsed 1 day ago");
});

test("a trial inside the seven-day window is a warning, not an alarm", () => {
  const w = workspace({ subscription_status: "trialing", trial_days_remaining: 3 });
  const [reason] = reasonsFor(w);
  assert.equal(reason.kind, "trial_ending");
  assert.equal(reason.label, "Trial ends in 3 days");
  assert.equal(reason.tone, "warn");
});

test("a trial ending today reads as today rather than in 0 days", () => {
  const w = workspace({ subscription_status: "trialing", trial_days_remaining: 0 });
  assert.equal(reasonsFor(w)[0].label, "Trial ends today");
});

test("a trial with eight days left is not yet anybody's problem", () => {
  const w = workspace({ subscription_status: "trialing", trial_days_remaining: 8 });
  assert.deepEqual(kinds(w), []);
});

// --- the bucket a naive query drops ---------------------------------------

test("no subscription row at all is caught, whether it is null or the string none", () => {
  for (const status of [null, "none"]) {
    const w = workspace({ subscription_status: status });
    assert.ok(kinds(w).includes("no_subscription"), `status ${status}`);
  }
});

test("past due is flagged and its MRR is somebody else's problem to show", () => {
  const w = workspace({ subscription_status: "past_due" });
  assert.deepEqual(kinds(w), ["past_due"]);
});

// --- signed up, never came back -------------------------------------------

test("a new workspace with a member who never signed in and no work is flagged", () => {
  const w = workspace({
    age_days: 19,
    members_never_signed_in: 1,
    has_raised_quote: false,
    has_sent_invoice: false,
    quotes_count: 0,
    invoices_count: 0,
    last_quote_created_at: null,
    last_invoice_created_at: null,
  });
  assert.ok(kinds(w).includes("never_returned"));
});

test("never-came-back does not apply to a workspace that has raised a quote", () => {
  const w = workspace({ age_days: 19, members_never_signed_in: 1 });
  assert.ok(!kinds(w).includes("never_returned"));
});

test("an old dormant workspace is barely-using, not never-came-back", () => {
  const w = workspace({
    age_days: 200,
    members_never_signed_in: 1,
    has_raised_quote: false,
    has_sent_invoice: false,
    quotes_count: 0,
    invoices_count: 0,
  });
  const found = kinds(w);
  assert.ok(!found.includes("never_returned"));
  assert.ok(found.includes("barely_using"));
});

// --- barely using it ------------------------------------------------------

test("a fortnight of grace before quiet counts as a problem", () => {
  const quiet = { quotes_count: 0, invoices_count: 0, has_raised_quote: false, has_sent_invoice: false };
  assert.ok(!kinds(workspace({ age_days: 13, ...quiet })).includes("barely_using"));
  assert.ok(kinds(workspace({ age_days: 14, ...quiet })).includes("barely_using"));
});

test("paying for modules that were never switched on is flagged with the count", () => {
  const w = workspace({ modules_entitled_not_enabled: 5 });
  const reason = reasonsFor(w).find((r) => r.kind === "barely_using");
  assert.equal(reason?.label, "5 paid modules never switched on");
});

test("one or two unswitched modules is not worth a chase", () => {
  const w = workspace({ modules_entitled_not_enabled: 2 });
  assert.ok(!kinds(w).includes("barely_using"));
});

// --- waiting on them ------------------------------------------------------

test("requests waiting on the client are listed, lowest urgency", () => {
  const w = workspace({ requests_awaiting_client: 2, open_requests: 2 });
  const [reason] = reasonsFor(w);
  assert.equal(reason.kind, "awaiting_client");
  assert.equal(reason.label, "2 requests waiting on them");
});

// --- the list -------------------------------------------------------------

test("a workspace with several problems appears once, carrying all of them", () => {
  const w = workspace({
    subscription_status: "trialing",
    trial_days_remaining: -4,
    requests_awaiting_client: 1,
    modules_entitled_not_enabled: 6,
  });
  const list = buildAttentionList([w]);
  assert.equal(list.length, 1);
  assert.ok(list[0].reasons.length >= 3);
});

test("the list leads with the most urgent, and ties break alphabetically", () => {
  const lapsed = workspace({
    organisation_id: "a",
    name: "Zebra Roofing",
    subscription_status: "trialing",
    trial_days_remaining: -2,
  });
  const ending = workspace({
    organisation_id: "b",
    name: "Alpha Gas",
    subscription_status: "trialing",
    trial_days_remaining: 2,
  });
  const alsoEnding = workspace({
    organisation_id: "c",
    name: "Beta Tiling",
    subscription_status: "trialing",
    trial_days_remaining: 5,
  });
  const names = buildAttentionList([ending, alsoEnding, lapsed]).map(
    (r) => r.workspace.name
  );
  assert.deepEqual(names, ["Zebra Roofing", "Alpha Gas", "Beta Tiling"]);
});

test("archived workspaces are dropped: there is nobody left to chase", () => {
  const w = workspace({ status: "archived", subscription_status: "trialing", trial_days_remaining: -30 });
  assert.deepEqual(buildAttentionList([w]), []);
});

test("suspended workspaces stay on the list", () => {
  const w = workspace({ status: "suspended", subscription_status: "past_due" });
  assert.equal(buildAttentionList([w]).length, 1);
});

test("an empty platform produces an empty list rather than throwing", () => {
  assert.deepEqual(buildAttentionList([]), []);
});

// --- null is not zero -----------------------------------------------------

test("an unmeasured module can never be reported as idle", () => {
  const w = workspace({
    modules: [
      // Calendar reports null usage. BSK View already excludes it from idle,
      // but a future payload that set the flag must not make us claim Calendar
      // is unused, because we cannot know that.
      module({ module: "calendar", measured: false, enabled_but_idle: true, records_last_90d: null }),
      module({ module: "jobs", enabled_but_idle: true, records_last_90d: 0 }),
    ],
  });
  assert.deepEqual(idleModules(w), ["jobs"]);
});

// --- last work ------------------------------------------------------------

test("last work prefers whichever record timestamp is more recent", () => {
  assert.deepEqual(lastWorkAt(workspace()), {
    at: "2026-07-27T07:41:51.115Z",
    what: "invoice",
  });
  assert.deepEqual(
    lastWorkAt(workspace({ last_invoice_created_at: "2026-07-01T00:00:00.000Z" })),
    { at: "2026-07-27T04:24:24.926Z", what: "quote" }
  );
});

test("last work falls back to whichever single timestamp exists", () => {
  assert.equal(
    lastWorkAt(workspace({ last_quote_created_at: null }))?.what,
    "invoice"
  );
  assert.equal(
    lastWorkAt(workspace({ last_invoice_created_at: null }))?.what,
    "quote"
  );
});

test("no work at all is null, never the sign-in value standing in for it", () => {
  const w = workspace({
    last_quote_created_at: null,
    last_invoice_created_at: null,
    last_credential_sign_in_at: "2026-07-29T08:50:34.490Z",
  });
  assert.equal(lastWorkAt(w), null);
});
