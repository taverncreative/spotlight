import { createClient } from "@/lib/supabase/server";
import { requireClient } from "@/lib/clients/require-client";
import { buildSiteViews } from "@/lib/sites/monitoring";
import { SitesList } from "@/components/sites-list";

// The per-client Sites module: add, edit and remove sites, map their Search
// Console and GA4 properties, and run a check now.
//
// This route used to be a redirect to Overview, because site management had been
// merged into that page. The Overview is now a read-only pinboard, so management
// comes back here and the Overview's Site health panel links to it. Anything
// that acts belongs in a module, not on the dashboard.
//
// DB-only: the property columns are read for the edit form's current-value
// prefill, but the live GSC/GA4 property lists are fetched lazily by the dialog
// on open, so this page makes no Google calls.
type SiteRow = {
  id: string;
  url: string;
  label: string | null;
  monitoring_enabled: boolean;
  check_interval_minutes: number;
  gsc_property: string | null;
  ga4_property: string | null;
  site_checks: {
    status: string;
    http_status: number | null;
    response_ms: number | null;
    ssl_expiry: string | null;
    domain_expiry: string | null;
    checked_at: string;
  }[];
};

export default async function SitesPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const { client } = await requireClient(clientSlug);

  const supabase = await createClient();
  const { data } = await supabase
    .from("sites")
    .select(
      "id, url, label, monitoring_enabled, check_interval_minutes, gsc_property, ga4_property, site_checks(status, http_status, response_ms, ssl_expiry, domain_expiry, checked_at)"
    )
    .eq("client_id", client.id)
    .order("created_at", { ascending: true })
    .order("checked_at", { referencedTable: "site_checks", ascending: false })
    .limit(1, { referencedTable: "site_checks" });

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Sites</h1>
        <p className="text-sm text-muted-foreground">
          Monitoring, SSL and domain expiry, and the Search Console and GA4
          properties each site maps to.
        </p>
      </div>

      <SitesList
        clientId={client.id}
        sites={buildSiteViews((data ?? []) as SiteRow[])}
        title="Sites"
      />
    </div>
  );
}
