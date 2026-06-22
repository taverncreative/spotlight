import { cn } from "@/lib/utils";
import { SeoControls } from "@/components/seo/seo-controls";
import { SeoTrendChart } from "@/components/seo/seo-trend-chart";
import type {
  MetricDelta,
  SearchAnalyticsResult,
  SeoTableRow,
} from "@/lib/gsc/search-analytics";

type DashboardResult = Extract<
  SearchAnalyticsResult,
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

function SeoTable({
  title,
  head,
  rows,
}: {
  title: string;
  head: string;
  rows: SeoTableRow[];
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">{head}</th>
              <th className="px-3 py-2 text-right font-medium">Clicks</th>
              <th className="px-3 py-2 text-right font-medium">Impr.</th>
              <th className="px-3 py-2 text-right font-medium">CTR</th>
              <th className="px-3 py-2 text-right font-medium">Pos.</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-4 text-center text-xs text-muted-foreground"
                >
                  No rows.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.key} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <div
                      className="max-w-[22ch] truncate sm:max-w-[40ch]"
                      title={row.key}
                    >
                      {row.key}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.clicks.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.impressions.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {(row.ctr * 100).toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.position.toFixed(1)}
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
export function SeoDashboard({
  properties,
  selected,
  rangeKey,
  result,
}: {
  properties: { siteUrl: string; label: string }[];
  selected: string;
  rangeKey: string;
  result: DashboardResult;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-lg font-medium">Search performance</h1>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {selected}
          </p>
          <p className="text-xs text-muted-foreground">
            Through {formatThrough(result.through)}
          </p>
        </div>
        <SeoControls
          properties={properties}
          selected={selected}
          rangeKey={rangeKey}
        />
      </header>

      {result.status === "no_data" ? (
        <div className="rounded-lg border bg-card p-6 text-sm">
          <p className="font-medium">No search data yet</p>
          <p className="mt-1 text-muted-foreground">
            Search Console has no data for this property in the selected range.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricCard
              label="Clicks"
              value={result.current.clicks.toLocaleString()}
              delta={result.deltas.clicks}
            />
            <MetricCard
              label="Impressions"
              value={result.current.impressions.toLocaleString()}
              delta={result.deltas.impressions}
            />
            <MetricCard
              label="CTR"
              value={`${(result.current.ctr * 100).toFixed(1)}%`}
              delta={result.deltas.ctr}
            />
            <MetricCard
              label="Avg. position"
              value={result.current.position.toFixed(1)}
              delta={result.deltas.position}
            />
          </div>

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">
              Daily clicks
            </h2>
            <SeoTrendChart data={result.trend} />
          </section>

          <div className="grid gap-6 md:grid-cols-2">
            <SeoTable title="Top queries" head="Query" rows={result.topQueries} />
            <SeoTable title="Top pages" head="Page" rows={result.topPages} />
          </div>
        </>
      )}
    </div>
  );
}
