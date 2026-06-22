import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getValidAccessToken, TokenRefreshError } from "@/lib/oauth/google";
import {
  parseGa4Report,
  type AnalyticsReportResult,
  type ReportRow,
} from "@/lib/ga4/parse";

// I/O layer for the GA4 Data API runReport: token + the four report calls, then
// hands the raw rows to parseGa4Report (the pure response-to-model parse). Goes
// through getValidAccessToken (refresh + persist on near-expiry).
//
// GA4 data is fresher than Search Console, so no multi-day lag — the window ends
// at yesterday (the most recent complete day, avoiding a partial-today dip).

export type {
  AnalyticsReportResult,
  AnalyticsTotals,
  AnalyticsDeltas,
  MetricDelta,
  TrendPoint,
  ChannelRow,
  PageRow,
} from "@/lib/ga4/parse";
export { formatDuration } from "@/lib/ga4/parse";

const GA4_PROVIDER = "google_analytics";
const END_OFFSET_DAYS = 1; // end at yesterday
const DAY_MS = 86_400_000;

function reportEndpoint(property: string): string {
  // property is already "properties/NNN"; the slash stays a path separator.
  return `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`;
}

// Thrown internally so an auth failure anywhere in the fan-out maps to the
// reconnect state instead of crashing.
class Ga4AuthError extends Error {}

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

async function runReport(
  token: string,
  property: string,
  body: Record<string, unknown>
): Promise<ReportRow[]> {
  const res = await fetch(reportEndpoint(property), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Ga4AuthError();
    throw new Error(`runReport failed: ${res.status}`);
  }
  const data = (await res.json()) as { rows?: ReportRow[] };
  return data.rows ?? [];
}

async function loadGa4Report(
  property: string,
  rangeDays: number
): Promise<AnalyticsReportResult> {
  const supabase = await createClient();
  const { data: connection } = await supabase
    .from("oauth_connections")
    .select("id, access_token, refresh_token, token_expiry")
    .eq("provider", GA4_PROVIDER)
    .maybeSingle();
  if (!connection) return { status: "reconnect_needed" };

  let token: string;
  try {
    token = await getValidAccessToken(connection);
  } catch (error) {
    if (error instanceof TokenRefreshError) return { status: "reconnect_needed" };
    return { status: "error" };
  }

  const endMs = Date.now() - END_OFFSET_DAYS * DAY_MS;
  const endDate = ymd(endMs);
  const curStart = ymd(endMs - (rangeDays - 1) * DAY_MS);
  const priorEnd = ymd(endMs - rangeDays * DAY_MS);
  const priorStart = ymd(endMs - (2 * rangeDays - 1) * DAY_MS);

  try {
    const [totalsRows, trendRows, channelRows, pageRows] = await Promise.all([
      runReport(token, property, {
        dateRanges: [
          { startDate: curStart, endDate, name: "current" },
          { startDate: priorStart, endDate: priorEnd, name: "prior" },
        ],
        metrics: [
          { name: "activeUsers" },
          { name: "sessions" },
          { name: "engagementRate" },
          { name: "averageSessionDuration" },
        ],
      }),
      runReport(token, property, {
        dateRanges: [{ startDate: curStart, endDate }],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ dimension: { dimensionName: "date" }, desc: false }],
      }),
      runReport(token, property, {
        dateRanges: [{ startDate: curStart, endDate }],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }, { name: "activeUsers" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10,
      }),
      runReport(token, property, {
        dateRanges: [{ startDate: curStart, endDate }],
        dimensions: [{ name: "pagePath" }],
        metrics: [
          { name: "screenPageViews" },
          { name: "activeUsers" },
          { name: "averageSessionDuration" },
        ],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 10,
      }),
    ]);

    return parseGa4Report(totalsRows, trendRows, channelRows, pageRows, endDate);
  } catch (error) {
    if (error instanceof Ga4AuthError) return { status: "reconnect_needed" };
    return { status: "error" };
  }
}

// cache() keyed by the primitive args: dedupes identical reads within a render.
export const fetchGa4Report = cache(loadGa4Report);
