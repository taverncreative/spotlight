import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { requireClient } from "@/lib/clients/require-client";
import { buildSiteView } from "@/lib/sites/monitoring";
import { hostnameFromUrl } from "@/lib/sites/schemas";
import { CLIENT_STATUS_LABELS } from "@/lib/clients/schemas";
import { MonitoringChip } from "@/components/monitoring-chip";

// Per-client Overview dashboard: read-only aggregation of the built modules
// (sites + posts), all owns_client-scoped via requireClient. No new tables. Site
// chips reuse buildSiteView so they match the Sites tab exactly; null SSL/Domain
// show "—" as on the board.

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  active: "default",
  paused: "secondary",
  archived: "outline",
};

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

type SiteRow = {
  id: string;
  url: string;
  label: string | null;
  monitoring_enabled: boolean;
  check_interval_minutes: number;
  site_checks: {
    status: string;
    http_status: number | null;
    response_ms: number | null;
    ssl_expiry: string | null;
    domain_expiry: string | null;
    checked_at: string;
  }[];
};

type PostRow = {
  id: string;
  title: string;
  status: string;
  published_at: string | null;
  updated_at: string;
};

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const { client } = await requireClient(clientSlug);

  const supabase = await createClient();
  const [clientRes, sitesRes, postsRes] = await Promise.all([
    supabase.from("clients").select("status").eq("id", client.id).maybeSingle(),
    supabase
      .from("sites")
      .select(
        "id, url, label, monitoring_enabled, check_interval_minutes, site_checks(status, http_status, response_ms, ssl_expiry, domain_expiry, checked_at)"
      )
      .eq("client_id", client.id)
      .order("created_at", { ascending: true })
      .order("checked_at", { referencedTable: "site_checks", ascending: false })
      .limit(1, { referencedTable: "site_checks" }),
    supabase
      .from("posts")
      .select("id, title, status, published_at, updated_at")
      .eq("client_id", client.id)
      .order("updated_at", { ascending: false }),
  ]);

  const status = (clientRes.data?.status as string | undefined) ?? "active";
  const sites = (sitesRes.data ?? []) as SiteRow[];
  const posts = (postsRes.data ?? []) as PostRow[];
  const now = Date.now();

  const primaryUrl = sites[0]?.url ?? null;
  const siteViews = sites.map((site) =>
    buildSiteView(site, site.site_checks?.[0] ?? null, now)
  );
  const draftCount = posts.filter((post) => post.status === "draft").length;
  const recentPosts = posts.slice(0, 3);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">
            {client.name}
          </h1>
          <Badge variant={STATUS_VARIANT[status] ?? "outline"}>
            {CLIENT_STATUS_LABELS[
              status as keyof typeof CLIENT_STATUS_LABELS
            ] ?? status}
          </Badge>
        </div>
        {primaryUrl ? (
          <p className="truncate font-mono text-xs text-muted-foreground">
            {hostnameFromUrl(primaryUrl)}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Sites" value={sites.length} />
        <StatCard label="Posts" value={posts.length} />
        <StatCard label="Drafts" value={draftCount} />
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Site health
          </h2>
          <Button
            variant="ghost"
            size="sm"
            render={<Link href={`/c/${clientSlug}/sites`} />}
          >
            View sites
          </Button>
        </div>
        {siteViews.length === 0 ? (
          <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            No sites yet.
          </p>
        ) : (
          <ul className="grid gap-2">
            {siteViews.map((site) => (
              <li
                key={site.id}
                className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
              >
                <p className="min-w-0 truncate text-sm font-medium">
                  {site.hostname}
                </p>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {site.check ? (
                    <>
                      <MonitoringChip tone={site.check.statusTone}>
                        {site.check.status === "up" ? "Up" : "Down"}
                        {site.check.httpStatus
                          ? ` · ${site.check.httpStatus}`
                          : ""}
                      </MonitoringChip>
                      {site.check.ssl ? (
                        <MonitoringChip tone={site.check.ssl.tone}>
                          {site.check.ssl.label}
                        </MonitoringChip>
                      ) : (
                        <MonitoringChip tone="muted">SSL —</MonitoringChip>
                      )}
                      {site.check.domain ? (
                        <MonitoringChip tone={site.check.domain.tone}>
                          {site.check.domain.label}
                        </MonitoringChip>
                      ) : (
                        <MonitoringChip tone="muted">Domain —</MonitoringChip>
                      )}
                    </>
                  ) : (
                    <MonitoringChip tone="muted">
                      Not yet checked
                    </MonitoringChip>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Recent posts
          </h2>
          <Button
            variant="ghost"
            size="sm"
            render={<Link href={`/c/${clientSlug}/blog/new`} />}
          >
            New post
          </Button>
        </div>
        {recentPosts.length === 0 ? (
          <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            No posts yet.
          </p>
        ) : (
          <ul className="grid gap-2">
            {recentPosts.map((post) => (
              <li key={post.id}>
                <Link
                  href={`/c/${clientSlug}/blog/${post.id}/edit`}
                  className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-accent"
                >
                  <span className="min-w-0 truncate text-sm font-medium">
                    {post.title}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge
                      variant={
                        post.status === "published" ? "default" : "outline"
                      }
                    >
                      {post.status === "published" ? "Published" : "Draft"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {post.status === "published" && post.published_at
                        ? formatDate(post.published_at)
                        : `Updated ${formatDate(post.updated_at)}`}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
