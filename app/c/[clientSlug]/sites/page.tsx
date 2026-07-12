import { createClient } from "@/lib/supabase/server";
import { SitesList } from "@/components/sites-list";
import { buildSiteViews } from "@/lib/sites/monitoring";
import { requireClient } from "@/lib/clients/require-client";
import { listGscProperties } from "@/lib/gsc/properties";
import { listGa4Properties } from "@/lib/ga4/properties";

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
  const { client } = await requireClient(clientSlug);

  const supabase = await createClient();
  // The property lists are fetched once here (cache()-memoised), in parallel,
  // and passed down to the edit form — never per row.
  const [{ data: sites }, gscProperties, ga4Properties] = await Promise.all([
    supabase
      .from("sites")
      .select(
        "id, url, label, monitoring_enabled, check_interval_minutes, gsc_property, ga4_property, site_checks(status, http_status, response_ms, ssl_expiry, domain_expiry, checked_at)"
      )
      .eq("client_id", client.id)
      .order("created_at", { ascending: true })
      .order("checked_at", { referencedTable: "site_checks", ascending: false })
      .limit(1, { referencedTable: "site_checks" }),
    listGscProperties(),
    listGa4Properties(),
  ]);

  const views = buildSiteViews(sites ?? []);

  return (
    <SitesList
      clientId={client.id}
      sites={views}
      gscProperties={gscProperties}
      ga4Properties={ga4Properties}
    />
  );
}
