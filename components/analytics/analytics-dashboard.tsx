import { cn } from "@/lib/utils";
import { AnalyticsControls } from "@/components/analytics/analytics-controls";
import { AnalyticsTrendChart } from "@/components/analytics/analytics-trend-chart";
import { formatDuration } from "@/lib/ga4/parse";
import type {
  AnalyticsReportResult,
  ChannelRow,
  MetricDelta,
  PageRow,
} from "@/lib/ga4/reports";

type DashboardResult = Extract<
  AnalyticsReportResult,
  { status: "ok" } | { status: "no_data" }
>;

function formatThrough(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function DeltaBadge({ delta }: { delta: MetricDelta }) {
  if (delta.pct === null) {
    return <p className="text-xs text-muted-foreground">— vs prev</p>;
  }
  const rising = delta.pct >= 0;
  return (
    <p
      className={cn(
        "text-xs tabular-nums",
        delta.better ? "text-emerald-400" : "text-destructive"
      )}
    >
      {rising ? "▲" : "▼"} {Math.abs(delta.pct).toFixed(1)}%{" "}
      <span className="text-muted-foreground">vs prev</span>
    </p>
  );
}

function MetricCard({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta: MetricDelta;
}) {
  return (
    <div className="space-y-1 rounded-lg border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <DeltaBadge delta={delta} />
    </div>
  );
}

function ChannelTable({ rows }: { rows: ChannelRow[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">
        Traffic by channel
      </h2>
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Channel</th>
              <th className="px-3 py-2 text-right font-medium">Sessions</th>
              <th className="px-3 py-2 text-right font-medium">Users</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-3 py-4 text-center text-xs text-muted-foreground"
                >
                  No rows.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.channel} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <div className="max-w-[22ch] truncate" title={row.channel}>
                      {row.channel}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.sessions.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.users.toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PagesTable({ rows }: { rows: PageRow[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">Top pages</h2>
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Page</th>
              <th className="px-3 py-2 text-right font-medium">Views</th>
              <th className="px-3 py-2 text-right font-medium">Users</th>
              <th className="px-3 py-2 text-right font-medium">Avg. session</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-4 text-center text-xs text-muted-foreground"
                >
                  No rows.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.page} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <div
                      className="max-w-[22ch] truncate sm:max-w-[32ch]"
                      title={row.page}
                    >
                      {row.page}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.views.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.users.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatDuration(row.avgSessionDuration)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// The connected + mapped view: header (property, through-date, selectors) plus
// either the metrics/chart/tables or the "no data yet" empty state.
export function AnalyticsDashboard({
  properties,
  selected,
  rangeKey,
  result,
}: {
  properties: { property: string; displayName: string }[];
  selected: string;
  rangeKey: string;
  result: DashboardResult;
}) {
  const selectedName =
    properties.find((p) => p.property === selected)?.displayName ?? selected;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-lg font-medium">Analytics</h1>
          <p className="truncate text-xs text-muted-foreground">
            {selectedName}
          </p>
          <p className="text-xs text-muted-foreground">
            Through {formatThrough(result.through)}
          </p>
        </div>
        <AnalyticsControls
          properties={properties}
          selected={selected}
          rangeKey={rangeKey}
        />
      </header>

      {result.status === "no_data" ? (
        <div className="rounded-lg border bg-card p-6 text-sm">
          <p className="font-medium">No analytics data yet</p>
          <p className="mt-1 text-muted-foreground">
            Google Analytics has no data for this property in the selected
            range.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricCard
              label="Users"
              value={result.current.users.toLocaleString()}
              delta={result.deltas.users}
            />
            <MetricCard
              label="Sessions"
              value={result.current.sessions.toLocaleString()}
              delta={result.deltas.sessions}
            />
            <MetricCard
              label="Engagement rate"
              value={`${(result.current.engagementRate * 100).toFixed(1)}%`}
              delta={result.deltas.engagementRate}
            />
            <MetricCard
              label="Avg. session"
              value={formatDuration(result.current.avgSessionDuration)}
              delta={result.deltas.avgSessionDuration}
            />
          </div>

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">
              Daily sessions
            </h2>
            <AnalyticsTrendChart data={result.trend} />
          </section>

          <div className="grid gap-6 md:grid-cols-2">
            <ChannelTable rows={result.channels} />
            <PagesTable rows={result.topPages} />
          </div>
        </>
      )}
    </div>
  );
}
