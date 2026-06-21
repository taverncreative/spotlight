import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SitesList } from "@/components/sites-list";
import { buildSiteView } from "@/lib/sites/monitoring";

// Sites module. Loads the client's sites (RLS-scoped) with their latest check
// embedded (most recent per site), builds the display model server-side, and
// renders the list. No checks exist until Slice 7, so each site reads
// "Not yet checked".
export default async function SitesPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const supabase = await createClient();

  // Send signed-out requests to login first, so the null-client check below only
  // means "unknown slug" (404), not "not authenticated".
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("slug", clientSlug)
    .maybeSingle();
  if (!client) notFound();

  const { data: sites } = await supabase
    .from("sites")
    .select(
      "id, url, label, monitoring_enabled, check_interval_minutes, site_checks(status, http_status, response_ms, ssl_expiry, domain_expiry, checked_at)"
    )
    .eq("client_id", client.id)
    .order("created_at", { ascending: true })
    .order("checked_at", { referencedTable: "site_checks", ascending: false })
    .limit(1, { referencedTable: "site_checks" });

  const now = Date.now();
  const views = (sites ?? []).map((site) =>
    buildSiteView(site, site.site_checks?.[0] ?? null, now)
  );

  return <SitesList clientId={client.id} sites={views} />;
}
