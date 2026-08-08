// The BSK View platform-metrics payload, schema_version 3.
//
// Mirrors the contract document exactly: snake_case throughout, money in
// integer pence, and null used deliberately where "not measured" differs from
// zero. Nothing here is optional-by-convenience; a field typed `| null` is one
// BSK View genuinely reports as null, and the UI has to say so rather than
// coerce it to 0.
//
// SCHEMA VERSION. `schema_version` is what lets the console tell "this
// deployment cannot report churn" from "churn was zero". These types describe
// v3; anything older is handled at the boundary in lib/platform/client.ts, not
// by making fields optional here.

export const PLATFORM_SCHEMA_VERSION = 3;

// Free-text caveats, delivered with every response so they travel with the
// data rather than being copied into our source and drifting. The UI renders
// these strings; it does not paraphrase them.
export type PlatformFieldNotes = {
  last_credential_sign_in_at: string;
  sign_in_snapshot_observed_on: string;
  mrr_pence_estimated_from_plan_prices: string;
  counts: string;
  module_usage: string;
  modules_not_measured: string;
  enabled_but_idle: string;
  conversions_and_churn: string;
};

// Platform-wide adoption for one module. `measured: false` means there is no
// evidence row this module could produce, so the usage figures are null and
// must not be drawn as an empty bar.
export type PlatformModule = {
  module: string;
  measured: boolean;
  workspaces_entitled: number;
  workspaces_enabled: number;
  workspaces_active_90d: number | null;
  workspaces_enabled_but_idle: number | null;
  adoption_rate: number | null;
  activation_rate: number | null;
};

export type PlatformAggregates = {
  workspaces_total: number;
  workspaces_active: number;
  workspaces_suspended: number;
  workspaces_archived: number;
  workspaces_created_last_30d: number;
  subscriptions_trialing: number;
  subscriptions_active: number;
  subscriptions_past_due: number;
  subscriptions_canceled: number;
  // Provisioned but never given a subscription row: the bucket a naive query
  // drops, and a real chase target.
  subscriptions_none: number;
  trials_expiring_within_7d: number;
  trials_overdue: number;
  mrr_pence_estimated_from_plan_prices: number;
  at_risk_mrr_pence: number;
  requests_by_status: Record<string, number>;
  requests_awaiting_agency: number;
  requests_awaiting_client: number;
  // The staleness signal for every sign-in value in the payload. If it stops
  // advancing, BSK View's daily snapshot has stopped.
  sign_in_snapshot_latest_observed_on: string | null;
  conversions_last_30d: number;
  conversions_last_90d: number;
  churn_last_30d: number;
  churn_last_90d: number;
  // Earliest billing row held. null means no billing rows at all, so
  // conversions and churn cover no period and must not be shown as totals.
  billing_events_since: string | null;
  modules: PlatformModule[];
  // module key -> why it reports null instead of 0.
  usage_not_measurable: Record<string, string>;
};

// One module within one workspace. Same null-is-not-zero rule as above, plus
// `last_used_at`, which is the most recent evidence WITHIN the 90-day window:
// null means nothing in 90 days, not never.
export type WorkspaceModule = {
  module: string;
  entitled: boolean;
  enabled: boolean;
  enabled_at: string | null;
  setup_completed: boolean;
  measured: boolean;
  last_used_at: string | null;
  records_last_30d: number | null;
  records_last_90d: number | null;
  // Switched on 14+ days ago and has produced nothing in the window. The
  // actionable one: it measures whether the module did work, not whether a tab
  // was opened.
  enabled_but_idle: boolean;
};

// One open request, as far as the feed is allowed to describe it.
//
// SUBJECT AND DATE ONLY, AND THIS IS A PRIVACY LINE, NOT AN OVERSIGHT. A
// subject is a label the client chose for a message they are deliberately
// sending us. A body is free text that may name their own customer, carry a
// phone number, or complain about a third party: data we never collected and
// have no business holding in a second system. There is no `body` field here
// and there must never be one, whatever a future payload happens to include.
//
// `url` is BSK View's own deep link. It is sent rather than assembled here,
// because BSK View owns its routing and a URL this console builds from a slug
// would break silently the day that routing changes.
export type PlatformRequest = {
  id: string;
  subject: string;
  created_at: string;
  awaiting: "agency" | "client";
  url: string;
};

export type PlatformWorkspace = {
  organisation_id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
  age_days: number;

  plan_key: string | null;
  subscription_status: string | null;
  billing_period: string | null;
  trial_ends_at: string | null;
  // Signed. Negative means the trial has overrun and they are getting the plan
  // free because nobody chased it.
  trial_days_remaining: number | null;
  mrr_pence_estimated_from_plan_prices: number;

  // The only email address in the payload, and only because "chase this trial"
  // needs a recipient.
  owner_email: string | null;
  members_active: number;
  members_invited_never_accepted: number;

  modules_entitled_count: number;
  modules_enabled_count: number;
  modules_entitled_not_enabled: number;
  modules_enabled: string[];
  onboarding_completed_at: string | null;
  onboarding_trade: string | null;

  leads_count: number;
  customers_count: number;
  quotes_count: number;
  invoices_count: number;
  has_raised_quote: boolean;
  has_sent_invoice: boolean;
  // Exact record timestamps. These, not the sign-in value, are the evidence
  // that somebody was actually working.
  last_quote_created_at: string | null;
  last_invoice_created_at: string | null;

  // NOT "last active", NOT "last seen". See field_notes.
  last_credential_sign_in_at: string | null;
  sign_in_snapshot_observed_on: string | null;
  members_never_signed_in: number;

  open_requests: number;
  requests_awaiting_client: number;
  // The requests themselves, subject and date only. OPTIONAL BY DEPLOYMENT,
  // not by convenience: v4 and earlier carry counts alone, so `undefined` means
  // "this BSK View cannot report subjects" and an empty array means "it can,
  // and there are none". The UI has to tell those apart, because the first is a
  // reason to say so and the second is good news.
  open_request_list?: PlatformRequest[];

  modules: WorkspaceModule[];
};

export type PlatformMetrics = {
  schema_version: number;
  generated_at: string;
  field_notes: PlatformFieldNotes;
  platform: PlatformAggregates;
  workspaces: PlatformWorkspace[];
};
