import { pounds, shortDate } from "@/lib/platform/format";
import type { PlatformAggregates } from "@/lib/platform/types";

// The totals. Deliberately below the attention list and deliberately plainer:
// they are context for the chase, not the point of the screen.
//
// The field_notes prose that used to sit under each section is gone: John knows
// what these numbers mean and does not need it restated every time he opens the
// page. What survives is carried by the labels themselves, which is where it
// belonged anyway. "MRR (estimated)" says estimated in the label. Conversions
// and churn are titled with the period they actually cover, so they cannot
// imply all time. Those are names, not commentary.

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

export function Aggregates({ platform }: { platform: PlatformAggregates }) {
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
          />
          <Stat
            label="At-risk MRR"
            value={pounds(platform.at_risk_mrr_pence)}
            note={`${platform.subscriptions_past_due} past due`}
          />
          <Stat
            label="New in 30 days"
            value={platform.workspaces_created_last_30d}
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Trialing"
            value={platform.subscriptions_trialing}
            note={`${platform.trials_expiring_within_7d} lapse within 7 days`}
          />
          <Stat label="Trials overrun" value={platform.trials_overdue} />
          <Stat label="No subscription" value={platform.subscriptions_none} />
          <Stat
            label="Subscribed"
            value={platform.subscriptions_active}
            note={`${platform.subscriptions_canceled} cancelled`}
          />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold">Conversions and churn</h2>
          {/* The period is the section's subtitle rather than a footnote. It is
              what the figures are, not a caveat about them. */}
          <span className="text-xs text-muted-foreground">
            {platform.billing_events_since
              ? `since ${shortDate(platform.billing_events_since)}`
              : "no billing rows yet"}
          </span>
        </div>

        {platform.billing_events_since === null ? (
          // Still not four zeros. With no billing rows there is nothing to
          // count from, and a grid of zeros would read as "measured, nobody
          // converted". One line, not a paragraph.
          <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
            Nothing to count from yet.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Conversions, 30 days"
              value={platform.conversions_last_30d}
            />
            <Stat
              label="Conversions, 90 days"
              value={platform.conversions_last_90d}
            />
            <Stat label="Churn, 30 days" value={platform.churn_last_30d} />
            <Stat label="Churn, 90 days" value={platform.churn_last_90d} />
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Requests</h2>
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
                : "none raised yet"
            }
          />
        </div>
      </section>
    </div>
  );
}
