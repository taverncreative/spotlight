import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireClient } from "@/lib/clients/require-client";
import { hostnameFromUrl } from "@/lib/sites/schemas";
import { loadGscConnection } from "@/lib/gsc/connection";
import { fetchSearchPerformance } from "@/lib/gsc/search-analytics";
import { normalizeRangeKey, rangeDaysFromKey } from "@/lib/gsc/ranges";
import { SeoDashboard } from "@/components/seo/seo-dashboard";

// Per-client SEO module: Search Console performance for the client's mapped
// properties. Read-only — reads gsc_property (Slice 9b) and the stored
// connection; no new schema. Guides setup through its empty/disconnected states.

function Notice({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-medium">Search performance</h1>
        <p className="text-sm text-muted-foreground">
          Google Search Console for this client.
        </p>
      </div>
      <div className="rounded-card border bg-card p-6 text-sm">
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

const linkClass = "font-medium text-primary underline-offset-4 hover:underline";

export default async function SeoPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<{ property?: string; range?: string }>;
}) {
  const { clientSlug } = await params;
  const { property: propertyParam, range: rangeParam } = await searchParams;
  const { client } = await requireClient(clientSlug);

  // 1. No connection at all → prompt to connect.
  const connection = await loadGscConnection();
  if (!connection) {
    return (
      <Notice title="Connect Search Console">
        <Link href="/settings/integrations" className={linkClass}>
          Connect Search Console
        </Link>{" "}
        to see search performance for this client.
      </Notice>
    );
  }

  // 2. Connected but no mapped property for this client → prompt to map one.
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("sites")
    .select("id, url, label, gsc_property")
    .eq("client_id", client.id)
    .not("gsc_property", "is", null)
    .order("created_at", { ascending: true });

  const seen = new Set<string>();
  const properties: { siteUrl: string; label: string }[] = [];
  for (const row of rows ?? []) {
    const siteUrl = row.gsc_property as string;
    if (seen.has(siteUrl)) continue;
    seen.add(siteUrl);
    properties.push({ siteUrl, label: row.label || hostnameFromUrl(row.url) });
  }

  if (properties.length === 0) {
    return (
      <Notice title="Map a Search Console property">
        Map a site to a Search Console property on the{" "}
        <Link href={`/c/${clientSlug}/overview`} className={linkClass}>
          Overview
        </Link>{" "}
        to see its performance here.
      </Notice>
    );
  }

  // 3. Selected property (default first) and range (default 28 days).
  const selected =
    propertyParam && properties.some((p) => p.siteUrl === propertyParam)
      ? propertyParam
      : properties[0].siteUrl;
  const rangeKey = normalizeRangeKey(rangeParam);

  const result = await fetchSearchPerformance(
    selected,
    rangeDaysFromKey(rangeKey)
  );

  if (result.status === "reconnect_needed") {
    return (
      <Notice title="Reconnect Search Console">
        Search Console access needs renewing —{" "}
        <Link href="/settings/integrations" className={linkClass}>
          reconnect
        </Link>
        .
      </Notice>
    );
  }

  if (result.status === "error") {
    return (
      <Notice title="Couldn't load Search Console">
        Something went wrong fetching search data. Please try again shortly.
      </Notice>
    );
  }

  return (
    <SeoDashboard
      properties={properties}
      selected={selected}
      rangeKey={rangeKey}
      result={result}
    />
  );
}
