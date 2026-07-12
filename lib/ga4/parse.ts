// Pure GA4 runReport-response → dashboard-model parsing (no server-only, no I/O,
// no @/ imports) so it can be unit-tested directly against fixtures. The I/O
// (token, fetch, date window) lives in lib/ga4/reports.ts, which calls
// parseGa4Report with the raw response rows.

export type AnalyticsTotals = {
  users: number;
  sessions: number;
  engagementRate: number; // 0–1
  avgSessionDuration: number; // seconds
};

// pct is the relative change vs the prior period; better is whether that change
// is good (all four GA4 metrics are higher-is-better). pct is null when the
// prior period was zero.
export type MetricDelta = { pct: number | null; better: boolean | null };

export type AnalyticsDeltas = {
  users: MetricDelta;
  sessions: MetricDelta;
  engagementRate: MetricDelta;
  avgSessionDuration: MetricDelta;
};

export type TrendPoint = { date: string; sessions: number };
export type ChannelRow = { channel: string; sessions: number; users: number };
export type PageRow = {
  page: string;
  views: number;
  users: number;
  avgSessionDuration: number;
};

export type AnalyticsReportResult =
  | { status: "reconnect_needed" }
  | { status: "error" }
  | { status: "no_data"; through: string }
  | {
      status: "ok";
      through: string;
      current: AnalyticsTotals;
      deltas: AnalyticsDeltas;
      trend: TrendPoint[];
      channels: ChannelRow[];
      topPages: PageRow[];
    };

export type ReportRow = {
  dimensionValues?: { value?: string }[];
  metricValues?: { value?: string }[];
};

// GA4 "date" dimension is YYYYMMDD; normalise to YYYY-MM-DD for the chart.
function ga4DateToYmd(value: string): string {
  return value.length === 8
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : value;
}

function num(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// With two named dateRanges and no dimensions, GA4 adds a dateRange dimension
// per row. Match by name, then by the default date_range_N, then positionally.
function pickRange(
  rows: ReportRow[],
  name: string,
  index: number
): ReportRow | undefined {
  return (
    rows.find((row) => row.dimensionValues?.[0]?.value === name) ??
    rows.find(
      (row) => row.dimensionValues?.[0]?.value === `date_range_${index}`
    ) ??
    rows[index]
  );
}

function totalsFromRow(row: ReportRow | undefined): AnalyticsTotals {
  const m = row?.metricValues ?? [];
  return {
    users: num(m[0]?.value),
    sessions: num(m[1]?.value),
    engagementRate: num(m[2]?.value),
    avgSessionDuration: num(m[3]?.value),
  };
}

function delta(cur: number, prior: number): MetricDelta {
  // All GA4 metrics here are higher-is-better.
  if (prior === 0) return { pct: null, better: null };
  return { pct: ((cur - prior) / prior) * 100, better: cur >= prior };
}

// Seconds → "Xm Ys" for the cards/tables. Pure, so it is unit-tested alongside
// the parse.
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

// Builds the dashboard model from the four runReport responses. Returns no_data
// when the current-period totals row is absent (GA4 omits rows when empty).
export function parseGa4Report(
  totalsRows: ReportRow[],
  trendRows: ReportRow[],
  channelRows: ReportRow[],
  pageRows: ReportRow[],
  through: string
): Extract<AnalyticsReportResult, { status: "ok" } | { status: "no_data" }> {
  const curRow = pickRange(totalsRows, "current", 0);
  if (!curRow) return { status: "no_data", through };

  const current = totalsFromRow(curRow);
  const prior = totalsFromRow(pickRange(totalsRows, "prior", 1));
  return {
    status: "ok",
    through,
    current,
    deltas: {
      users: delta(current.users, prior.users),
      sessions: delta(current.sessions, prior.sessions),
      engagementRate: delta(current.engagementRate, prior.engagementRate),
      avgSessionDuration: delta(
        current.avgSessionDuration,
        prior.avgSessionDuration
      ),
    },
    trend: trendRows
      .map((row) => ({
        date: ga4DateToYmd(row.dimensionValues?.[0]?.value ?? ""),
        sessions: num(row.metricValues?.[0]?.value),
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    channels: channelRows.map((row) => ({
      channel: row.dimensionValues?.[0]?.value ?? "",
      sessions: num(row.metricValues?.[0]?.value),
      users: num(row.metricValues?.[1]?.value),
    })),
    topPages: pageRows.map((row) => ({
      page: row.dimensionValues?.[0]?.value ?? "",
      views: num(row.metricValues?.[0]?.value),
      users: num(row.metricValues?.[1]?.value),
      avgSessionDuration: num(row.metricValues?.[2]?.value),
    })),
  };
}
