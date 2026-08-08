import { pounds, shortDate } from "@/lib/platform/format";
import type { PlatformAggregates } from "@/lib/platform/types";

// What is left once the workspace-shaped counts have become names.
//
// "1 trialing", "2 workspaces", "1 new in 30 days" and "0 without a
// subscription" all used to live here as tiles. Every one of them is now a line
// in the roster with the workspace named beside it, and keeping both would have
// meant showing the same fact twice in two shapes, the weaker one first.
//
// What survives is what a name cannot carry: money summed across the platform,
// and movement over a period, which is about workspaces that may no longer be
// in the list at all. The suspended and archived line renders only when there
// is one, because "0 suspended" is not news.
//
// MRR IS READ LIVE, every page load, straight from BSK View's current plan
// prices. Spotlight stores no history of it and draws no trend, so the annual-
// price bug that made snapshots before 6 August report a twelfth of the truth
// cannot reach this page: there is no stored series here to be wrong. If a
// trend line is ever added, it wants the correction annotated at that date.

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
      {note ? (
        <p className="mt-1 text-xs text-muted-foreground">{note}</p>
      ) : null}
    </div>
  );
}

export function Aggregates({ platform }: { platform: PlatformAggregates }) {
  const offRoster =
    platform.workspaces_suspended > 0 || platform.workspaces_archived > 0;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Money</h2>

        {/* MRR itself is not repeated here: it is on the line at the top of the
            page, where it belongs, and a second copy inside the fold would be
            the same figure twice in two shapes. */}
        <div className="grid gap-2 sm:grid-cols-2">
          <Stat
            label="At-risk MRR"
            value={pounds(platform.at_risk_mrr_pence)}
            note={`${platform.subscriptions_past_due} past due`}
          />
          <Stat
            label="Cancelled"
            value={platform.subscriptions_canceled}
            note="subscriptions"
          />
        </div>

        {offRoster ? (
          <p className="text-xs text-muted-foreground">
            {platform.workspaces_suspended} suspended ·{" "}
            {platform.workspaces_archived} archived, excluded from the cohorts
            above.
          </p>
        ) : null}
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
    </div>
  );
}
