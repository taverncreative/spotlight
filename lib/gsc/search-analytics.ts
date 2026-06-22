import "server-only";
import { cache } from "react";
import { getValidAccessToken, TokenRefreshError } from "@/lib/oauth/google";
import { loadGscConnection } from "@/lib/gsc/connection";

// Search Console searchAnalytics.query for one mapped property over a date
// range, plus the equal-length prior period for deltas. First live read goes
// through getValidAccessToken (refresh + persist on near-expiry).

const LAG_DAYS = 3; // GSC data lags ~3 days; end the window there.
const DAY_MS = 86_400_000;

function queryEndpoint(siteUrl: string): string {
  return `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    siteUrl
  )}/searchAnalytics/query`;
}

export type SearchTotals = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

// pct is the relative change vs the prior period; better encodes whether that
// change is good for this metric (position is lower-is-better). pct is null when
// the prior period was zero.
export type MetricDelta = { pct: number | null; better: boolean | null };

export type SeoDeltas = {
  clicks: MetricDelta;
  impressions: MetricDelta;
  ctr: MetricDelta;
  position: MetricDelta;
};

export type SeoTableRow = {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type TrendPoint = { date: string; clicks: number };

export type SearchAnalyticsResult =
  | { status: "reconnect_needed" }
  | { status: "error" }
  | { status: "no_data"; through: string }
  | {
      status: "ok";
      through: string;
      current: SearchTotals;
      deltas: SeoDeltas;
      trend: TrendPoint[];
      topQueries: SeoTableRow[];
      topPages: SeoTableRow[];
    };

type ApiRow = {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
};

// Thrown internally so an auth failure anywhere in the query fan-out maps to the
// reconnect state instead of crashing.
class GscAuthError extends Error {}

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

async function runQuery(
  token: string,
  siteUrl: string,
  body: Record<string, unknown>
): Promise<ApiRow[]> {
  const res = await fetch(queryEndpoint(siteUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new GscAuthError();
    throw new Error(`searchAnalytics.query failed: ${res.status}`);
  }
  const data = (await res.json()) as { rows?: ApiRow[] };
  return data.rows ?? [];
}

function totals(rows: ApiRow[]): SearchTotals {
  const row = rows[0];
  return {
    clicks: row?.clicks ?? 0,
    impressions: row?.impressions ?? 0,
    ctr: row?.ctr ?? 0,
    position: row?.position ?? 0,
  };
}

function delta(cur: number, prior: number, higherIsBetter: boolean): MetricDelta {
  if (prior === 0) return { pct: null, better: null };
  return {
    pct: ((cur - prior) / prior) * 100,
    better: higherIsBetter ? cur >= prior : cur <= prior,
  };
}

function toTableRows(rows: ApiRow[]): SeoTableRow[] {
  return rows.map((row) => ({
    key: row.keys?.[0] ?? "",
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  }));
}

async function loadSearchPerformance(
  property: string,
  rangeDays: number
): Promise<SearchAnalyticsResult> {
  const connection = await loadGscConnection();
  if (!connection) return { status: "reconnect_needed" };

  let token: string;
  try {
    token = await getValidAccessToken(connection);
  } catch (error) {
    if (error instanceof TokenRefreshError) return { status: "reconnect_needed" };
    return { status: "error" };
  }

  const endMs = Date.now() - LAG_DAYS * DAY_MS;
  const endDate = ymd(endMs);
  const curStart = ymd(endMs - (rangeDays - 1) * DAY_MS);
  const priorEnd = ymd(endMs - rangeDays * DAY_MS);
  const priorStart = ymd(endMs - (2 * rangeDays - 1) * DAY_MS);

  try {
    const [curRows, priorRows, trendRows, queryRows, pageRows] = await Promise.all([
      runQuery(token, property, { startDate: curStart, endDate }),
      runQuery(token, property, { startDate: priorStart, endDate: priorEnd }),
      runQuery(token, property, {
        startDate: curStart,
        endDate,
        dimensions: ["date"],
      }),
      runQuery(token, property, {
        startDate: curStart,
        endDate,
        dimensions: ["query"],
        rowLimit: 10,
      }),
      runQuery(token, property, {
        startDate: curStart,
        endDate,
        dimensions: ["page"],
        rowLimit: 10,
      }),
    ]);

    // No aggregate row means the property has no data in this window.
    if (curRows.length === 0) return { status: "no_data", through: endDate };

    const current = totals(curRows);
    const prior = totals(priorRows);
    return {
      status: "ok",
      through: endDate,
      current,
      deltas: {
        clicks: delta(current.clicks, prior.clicks, true),
        impressions: delta(current.impressions, prior.impressions, true),
        ctr: delta(current.ctr, prior.ctr, true),
        position: delta(current.position, prior.position, false),
      },
      trend: trendRows
        .map((row) => ({ date: row.keys?.[0] ?? "", clicks: row.clicks ?? 0 }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      topQueries: toTableRows(queryRows),
      topPages: toTableRows(pageRows),
    };
  } catch (error) {
    if (error instanceof GscAuthError) return { status: "reconnect_needed" };
    return { status: "error" };
  }
}

// cache() keyed by the primitive args: dedupes identical reads within a render.
export const fetchSearchPerformance = cache(loadSearchPerformance);
