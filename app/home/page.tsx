import { createClient } from "@/lib/supabase/server";
import {
  MonitoringBoard,
  type AttentionRow,
  type BoardModel,
  type FailedPostAttention,
  type RosterChip,
  type RosterRow,
} from "@/components/monitoring-board";
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

// Assemble the board model outside the component so the render stays pure
// (Date.now() lives here, per request, not in the component body).
function buildBoard(
  clients: ClientRow[],
  sites: BoardSite[],
  failedRows: FailedPostRow[]
): BoardModel {
  const now = Date.now();

  const clientById = new Map(clients.map((client) => [client.id, client]));
  const sitesByClient = new Map<string, BoardSite[]>();
  for (const site of sites) {
    const list = sitesByClient.get(site.client_id) ?? [];
    list.push(site);
    sitesByClient.set(site.client_id, list);
  }

  const attention: AttentionRow[] = [];
  const atRiskClients = new Set<string>();
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
      atRiskClients.add(site.client_id);
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

  const roster: RosterRow[] = [];
  for (const client of clients) {
    if (atRiskClients.has(client.id)) continue;
    const clientSites = sitesByClient.get(client.id) ?? [];

    if (clientSites.length === 0) {
      roster.push({ client, kind: "empty", chips: [] });
      continue;
    }

    let upCount = 0;
    let checkedCount = 0;
    let soonestSsl: number | null = null;
    let soonestDomain: number | null = null;
    for (const site of clientSites) {
      const check = site.site_checks?.[0] ?? null;
      if (!check) continue;
      checkedCount++;
      const risk = assessSite(check, now);
      if (check.status === "up") upCount++;
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

    if (checkedCount === 0) {
      roster.push({ client, kind: "unchecked", chips: [] });
      continue;
    }

    const chips: RosterChip[] = [
      { label: `${upCount}/${clientSites.length} up`, tone: "ok" },
      soonestSsl !== null
        ? { label: `SSL ${soonestSsl}d`, tone: "ok" }
        : { label: "SSL —", tone: "muted" },
      soonestDomain !== null
        ? { label: `Domain ${soonestDomain}d`, tone: "ok" }
        : { label: "Domain —", tone: "muted" },
    ];
    roster.push({ client, kind: "healthy", chips });
  }

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
    roster,
    failedPosts,
  };
}

export default async function HomePage() {
  const supabase = await createClient();
  const [clientsRes, sitesRes, failedRes] = await Promise.all([
    supabase.from("clients").select("id, name, slug, status").order("name"),
    supabase
      .from("sites")
      .select(
        "id, url, client_id, site_checks(status, ssl_expiry, domain_expiry, checked_at)"
      )
      .eq("monitoring_enabled", true)
      .order("checked_at", { referencedTable: "site_checks", ascending: false })
      .limit(1, { referencedTable: "site_checks" }),
    supabase
      .from("social_posts")
      .select("id, caption, status, last_error, clients(name, slug)")
      .in("status", ["failed", "partial"])
      .order("created_at", { ascending: false }),
  ]);

  const board = buildBoard(
    (clientsRes.data ?? []) as ClientRow[],
    (sitesRes.data ?? []) as BoardSite[],
    (failedRes.data ?? []) as unknown as FailedPostRow[]
  );

  return <MonitoringBoard board={board} />;
}
