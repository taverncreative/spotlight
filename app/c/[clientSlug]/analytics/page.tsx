import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireClient } from "@/lib/clients/require-client";
import { listGa4Properties } from "@/lib/ga4/properties";
import { fetchGa4Report } from "@/lib/ga4/reports";
import { normalizeRangeKey, rangeDaysFromKey } from "@/lib/gsc/ranges";
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";

// Per-client Analytics module: GA4 performance for the client's mapped
// properties. Read-only — reads ga4_property (Slice 16) and the stored
// connection; no new schema. Twin of the SEO module; guides setup through its
// empty/disconnected states.

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
        <h1 className="text-lg font-medium">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Google Analytics for this client.
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

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<{ property?: string; range?: string }>;
}) {
  const { clientSlug } = await params;
  const { property: propertyParam, range: rangeParam } = await searchParams;
  const { client } = await requireClient(clientSlug);

  // The client's mapped GA4 properties (from the sites) and the operator's GA4
  // property list (for display names + the connection/reconnect state) — the DB
  // read and the API list run in parallel.
  const supabase = await createClient();
  const [{ data: rows }, ga4List] = await Promise.all([
    supabase
      .from("sites")
      .select("ga4_property")
      .eq("client_id", client.id)
      .not("ga4_property", "is", null)
      .order("created_at", { ascending: true }),
    listGa4Properties(),
  ]);

  // 1. No connection at all → prompt to connect.
  if (ga4List.status === "not_connected") {
    return (
      <Notice title="Connect Google Analytics">
        <Link href="/settings/integrations" className={linkClass}>
          Connect Google Analytics
        </Link>{" "}
        to see analytics for this client.
      </Notice>
    );
  }

  // 2. Connected but no mapped property for this client → prompt to map one.
  const seen = new Set<string>();
  const mapped: string[] = [];
  for (const row of rows ?? []) {
    const resource = row.ga4_property as string;
    if (seen.has(resource)) continue;
    seen.add(resource);
    mapped.push(resource);
  }

  if (mapped.length === 0) {
    return (
      <Notice title="Map a Google Analytics property">
        Map a site to a GA4 property on the{" "}
        <Link href={`/c/${clientSlug}/sites`} className={linkClass}>
          Sites tab
        </Link>{" "}
        to see its analytics here.
      </Notice>
    );
  }

  // 3. Connected but the token can't be refreshed → prompt to reconnect.
  if (ga4List.status === "reconnect_needed") {
    return (
      <Notice title="Reconnect Google Analytics">
        Google Analytics access needs renewing —{" "}
        <Link href="/settings/integrations" className={linkClass}>
          reconnect
        </Link>
        .
      </Notice>
    );
  }

  // Resolve display names from the live list, falling back to the resource name.
  const nameMap = new Map(
    ga4List.properties.map((p) => [p.property, p.displayName])
  );
  const properties = mapped.map((resource) => ({
    property: resource,
    displayName: nameMap.get(resource) ?? resource,
  }));

  // 4. Selected property (default first) and range (default 28 days).
  const selected =
    propertyParam && mapped.includes(propertyParam) ? propertyParam : mapped[0];
  const rangeKey = normalizeRangeKey(rangeParam);

  const result = await fetchGa4Report(selected, rangeDaysFromKey(rangeKey));

  if (result.status === "reconnect_needed") {
    return (
      <Notice title="Reconnect Google Analytics">
        Google Analytics access needs renewing —{" "}
        <Link href="/settings/integrations" className={linkClass}>
          reconnect
        </Link>
        .
      </Notice>
    );
  }

  if (result.status === "error") {
    return (
      <Notice title="Couldn't load Google Analytics">
        Something went wrong fetching analytics data. Please try again shortly.
      </Notice>
    );
  }

  return (
    <AnalyticsDashboard
      properties={properties}
      selected={selected}
      rangeKey={rangeKey}
      result={result}
    />
  );
}
