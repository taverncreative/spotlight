import { pounds, shortDate } from "@/lib/platform/format";
import type { PlatformAggregates, PlatformFieldNotes } from "@/lib/platform/types";

// The totals. Deliberately below the attention list and deliberately plainer:
// they are context for the chase, not the point of the screen.

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note?: string;
}) {
  return (
    <div className="rounded-card border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tracking-tight">{value}</p>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="max-w-prose border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

export function Aggregates({
  platform,
  notes,
}: {
  platform: PlatformAggregates;
  notes: PlatformFieldNotes;
}) {
  const requestStatuses = Object.entries(platform.requests_by_status);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Platform</h2>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Workspaces"
            value={platform.workspaces_total}
            note={`${platform.workspaces_active} active · ${platform.workspaces_suspended} suspended · ${platform.workspaces_archived} archived`}
          />
          <Stat
            label="MRR (estimated)"
            value={pounds(platform.mrr_pence_estimated_from_plan_prices)}
            note="From our plan list prices, not Stripe"
          />
          <Stat
            label="At-risk MRR"
            value={pounds(platform.at_risk_mrr_pence)}
            note={`${platform.subscriptions_past_due} past due, held out of MRR`}
          />
          <Stat
            label="New in 30 days"
            value={platform.workspaces_created_last_30d}
            note="workspaces created"
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Trialing"
            value={platform.subscriptions_trialing}
            note={`${platform.trials_expiring_within_7d} lapse within 7 days`}
          />
          <Stat
            label="Trials overrun"
            value={platform.trials_overdue}
            note="still trialing past the end date"
          />
          <Stat
            label="No subscription"
            value={platform.subscriptions_none}
            note="provisioned, never given a plan"
          />
          <Stat
            label="Subscribed"
            value={platform.subscriptions_active}
            note={`${platform.subscriptions_canceled} cancelled`}
          />
        </div>

        <Note>{notes.mrr_pence_estimated_from_plan_prices}</Note>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold">Conversions and churn</h2>
          <span className="text-xs text-muted-foreground">
            {platform.billing_events_since
              ? `since ${shortDate(platform.billing_events_since)}`
              : "no billing rows held yet"}
          </span>
        </div>

        {platform.billing_events_since === null ? (
          // No billing rows at all. Showing four zeros here would read as "we
          // measured, nobody converted"; the truth is there is no period to
          // report on yet.
          <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
            No billing rows exist yet, so these figures cover no period at all.
            They are not zero conversions and zero churn; they are nothing to
            count from. This fills in once Stripe writes its first billing event.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Conversions, 30 days"
              value={platform.conversions_last_30d}
              note="at least — see below"
            />
            <Stat
              label="Conversions, 90 days"
              value={platform.conversions_last_90d}
              note="at least — see below"
            />
            <Stat
              label="Churn, 30 days"
              value={platform.churn_last_30d}
              note="at least — see below"
            />
            <Stat
              label="Churn, 90 days"
              value={platform.churn_last_90d}
              note="at least — see below"
            />
          </div>
        )}

        <Note>{notes.conversions_and_churn}</Note>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold">Requests</h2>
          <span className="text-xs text-muted-foreground">
            across every workspace
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Stat
            label="Awaiting agency"
            value={platform.requests_awaiting_agency}
            note="our queue"
          />
          <Stat
            label="Awaiting client"
            value={platform.requests_awaiting_client}
            note="their queue"
          />
          <Stat
            label="By status"
            value={requestStatuses.reduce((sum, [, n]) => sum + n, 0)}
            note={
              requestStatuses.length
                ? requestStatuses
                    .map(([status, n]) => `${status.replace(/_/g, " ")} ${n}`)
                    .join(" · ")
                : "no requests raised yet"
            }
          />
        </div>
      </section>
    </div>
  );
}
