import { createClient } from "@/lib/supabase/server";
import {
  MonitoringBoard,
  type AttentionRow,
  type BoardModel,
  type ClientComparisonRow,
  type FailedPostAttention,
} from "@/components/monitoring-board";
import type { ChipTone } from "@/lib/sites/monitoring";
import { assessSite } from "@/lib/sites/monitoring";
import { hostnameFromUrl } from "@/lib/sites/schemas";
import type { ClientRow } from "@/components/client-form-dialog";

// The operator home: the cross-client monitoring board. Read-only aggregation of
// the latest site_check per monitored site, with risk single-sourced from
// lib/sites/monitoring.ts so the board and the Sites tab agree.
type BoardCheck = {
  status: string;
  ssl_expiry: string | null;
  domain_expiry: string | null;
  checked_at: string;
};
type BoardSite = {
  id: string;
  url: string;
  client_id: string;
  site_checks: BoardCheck[];
};
type FailedPostRow = {
  id: string;
  caption: string;
  status: string;
  last_error: string | null;
  clients: { name: string; slug: string } | null;
};
type SocialCountRow = {
  client_id: string;
  status: string;
  scheduled_at: string | null;
};
type SitePropRow = {
  client_id: string;
  gsc_property: string | null;
  ga4_property: string | null;
};

// Assemble the board model outside the component so the render stays pure
// (Date.now() lives here, per request, not in the component body).
function buildBoard(
  clients: ClientRow[],
  sites: BoardSite[],
  failedRows: FailedPostRow[],
  socialCounts: SocialCountRow[],
  siteProps: SitePropRow[]
): BoardModel {
  const now = Date.now();

  // Social scheduled/failed counts per client (failed folds in partial, matching
  // the attention zone). Cheap: only these three statuses are fetched. The
  // scheduled rows are also kept per client to feed the runway bars.
  const socialByClient = new Map<
    string,
    { scheduled: number; failed: number }
  >();
  const runwayByClient = new Map<
    string,
    { status: string; scheduled_at: string | null }[]
  >();
  for (const row of socialCounts) {
    const counts = socialByClient.get(row.client_id) ?? {
      scheduled: 0,
      failed: 0,
    };
    if (row.status === "scheduled") {
      counts.scheduled++;
      const runway = runwayByClient.get(row.client_id) ?? [];
      runway.push({ status: row.status, scheduled_at: row.scheduled_at });
      runwayByClient.set(row.client_id, runway);
    } else counts.failed++;
    socialByClient.set(row.client_id, counts);
  }

  // SEO/GA4 connection presence per client: any of the client's sites carries a
  // mapped property. Presence only, no live Google call.
  const connByClient = new Map<string, { gsc: boolean; ga4: boolean }>();
  for (const row of siteProps) {
    const conn = connByClient.get(row.client_id) ?? { gsc: false, ga4: false };
    if (row.gsc_property) conn.gsc = true;
    if (row.ga4_property) conn.ga4 = true;
    connByClient.set(row.client_id, conn);
  }

  const clientById = new Map(clients.map((client) => [client.id, client]));
  const sitesByClient = new Map<string, BoardSite[]>();
  for (const site of sites) {
    const list = sitesByClient.get(site.client_id) ?? [];
    list.push(site);
    sitesByClient.set(site.client_id, list);
  }

  const attention: AttentionRow[] = [];
  let down = 0;
  let atRisk = 0;
  let healthy = 0;

  for (const site of sites) {
    const risk = assessSite(site.site_checks?.[0] ?? null, now);
    if (risk.level === "down") down++;
    else if (risk.level === "expired" || risk.level === "at-risk") atRisk++;
    else if (risk.level === "healthy") healthy++;

    if (risk.sortRank <= 2) {
      const client = clientById.get(site.client_id);
      attention.push({
        id: site.id,
        clientName: client?.name ?? "Unknown client",
        clientSlug: client?.slug ?? "",
        hostname: hostnameFromUrl(site.url),
        issue: risk.issue ?? "At risk",
        tone: risk.tone,
        sortRank: risk.sortRank,
        soonestDays: risk.soonestDays,
      });
    }
  }

  // Worst-first: down, then expired, then soonest SSL/domain expiry.
  attention.sort(
    (a, b) =>
      a.sortRank - b.sortRank ||
      (a.soonestDays ?? Infinity) - (b.soonestDays ?? Infinity)
  );

  // One comparison row per client (all clients, not just healthy ones), sorted
  // worst-first by the same risk ranking the attention zone uses.
  const toneFromRank = (rank: number): ChipTone =>
    rank <= 1 ? "danger" : rank === 2 ? "warn" : rank === 3 ? "ok" : "muted";

  const clientRows: ClientComparisonRow[] = clients.map((client) => {
    const clientSites = sitesByClient.get(client.id) ?? [];
    const social = socialByClient.get(client.id) ?? { scheduled: 0, failed: 0 };
    const conn = connByClient.get(client.id) ?? { gsc: false, ga4: false };

    let upCount = 0;
    let downCount = 0;
    let checkedCount = 0;
    let worstRank = 4;
    let soonestSsl: number | null = null;
    let soonestDomain: number | null = null;
    for (const site of clientSites) {
      const check = site.site_checks?.[0] ?? null;
      if (!check) continue;
      checkedCount++;
      const risk = assessSite(check, now);
      if (check.status === "up") upCount++;
      else downCount++;
      worstRank = Math.min(worstRank, risk.sortRank);
      if (risk.sslDays !== null) {
        soonestSsl =
          soonestSsl === null
            ? risk.sslDays
            : Math.min(soonestSsl, risk.sslDays);
      }
      if (risk.domainDays !== null) {
        soonestDomain =
          soonestDomain === null
            ? risk.domainDays
            : Math.min(soonestDomain, risk.domainDays);
      }
    }

    let kind: ClientComparisonRow["kind"];
    let tone: ChipTone;
    let healthLabel: string;
    let sortRank: number;
    if (clientSites.length === 0) {
      kind = "empty";
      tone = "muted";
      healthLabel = "No sites";
      sortRank = 6;
    } else if (checkedCount === 0) {
      kind = "unchecked";
      tone = "muted";
      healthLabel = "Not checked";
      sortRank = 5;
    } else {
      kind = "monitored";
      tone = toneFromRank(worstRank);
      sortRank = worstRank;
      healthLabel =
        downCount > 0
          ? `${downCount} down`
          : worstRank <= 2
            ? "At risk"
            : "Healthy";
    }

    return {
      client,
      kind,
      tone,
      healthLabel,
      sortRank,
      upCount,
      totalSites: clientSites.length,
      soonestSsl,
      soonestDomain,
      scheduled: social.scheduled,
      failed: social.failed,
      gscConnected: conn.gsc,
      ga4Connected: conn.ga4,
      runwayPosts: runwayByClient.get(client.id) ?? [],
    };
  });

  clientRows.sort(
    (a, b) =>
      a.sortRank - b.sortRank ||
      (a.soonestSsl ?? Infinity) - (b.soonestSsl ?? Infinity) ||
      a.client.name.localeCompare(b.client.name)
  );

  // Failed/partial social posts join the attention zone, each linking to the
  // relevant client's failed-posts view.
  const failedPosts: FailedPostAttention[] = failedRows.map((row) => ({
    id: row.id,
    clientName: row.clients?.name ?? "Unknown client",
    clientSlug: row.clients?.slug ?? "",
    caption: row.caption,
    issue: row.status === "partial" ? "Partially published" : "Publish failed",
  }));

  return {
    summary: { down, atRisk, healthy },
    attention,
    clientRows,
    failedPosts,
  };
}

export default async function HomePage() {
  const supabase = await createClient();
  const [clientsRes, sitesRes, failedRes, socialCountsRes, sitePropsRes] =
    await Promise.all([
      supabase
        .from("clients")
        .select("id, name, slug, status, blog_base_url")
        .order("name"),
      supabase
        .from("sites")
        .select(
          "id, url, client_id, site_checks(status, ssl_expiry, domain_expiry, checked_at)"
        )
        .eq("monitoring_enabled", true)
        .order("checked_at", {
          referencedTable: "site_checks",
          ascending: false,
        })
        .limit(1, { referencedTable: "site_checks" }),
      supabase
        .from("social_posts")
        .select("id, caption, status, last_error, clients(name, slug)")
        .in("status", ["failed", "partial"])
        .order("created_at", { ascending: false }),
      // Lean per-client social rows (scheduled + failed/partial) — no captions.
      // scheduled_at feeds the per-client runway bars.
      supabase
        .from("social_posts")
        .select("client_id, status, scheduled_at")
        .in("status", ["scheduled", "failed", "partial"]),
      // SEO/GA4 connection presence across all sites (property columns only).
      supabase.from("sites").select("client_id, gsc_property, ga4_property"),
    ]);

  const board = buildBoard(
    (clientsRes.data ?? []) as ClientRow[],
    (sitesRes.data ?? []) as BoardSite[],
    (failedRes.data ?? []) as unknown as FailedPostRow[],
    (socialCountsRes.data ?? []) as SocialCountRow[],
    (sitePropsRes.data ?? []) as SitePropRow[]
  );

  return <MonitoringBoard board={board} />;
}
