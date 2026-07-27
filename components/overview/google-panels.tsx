import { createClient } from "@/lib/supabase/server";
import { fetchSearchPerformance } from "@/lib/gsc/search-analytics";
import { fetchGa4Report } from "@/lib/ga4/reports";
import { Panel, PanelEmpty } from "@/components/overview/panel";

// The two panels that talk to Google.
//
// Everything else on the Overview comes from our own database and renders
// instantly. These do not: there is no gsc_* or ga4_* cache anywhere, so both
// modules call Search Console and GA4 live on every render. Left inline they
// would hold the whole dashboard behind two external round-trips that can be
// slow, rate-limited, or fail on an expired token.
//
// So they are separate async components, streamed inside <Suspense> by the page.
// The board paints from local data immediately and these fill in after, and a
// Google failure degrades to a quiet line in one tile instead of taking the page
// with it.

const WINDOW_DAYS = 28;

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

const number = (value: number) => value.toLocaleString("en-GB");

export function GooglePanelSkeleton({
  title,
  href,
}: {
  title: string;
  href: string;
}) {
  return (
    <Panel title={title} href={href}>
      <div className="flex gap-6">
        <div className="space-y-1.5">
          <div className="h-6 w-16 animate-pulse rounded bg-muted" />
          <div className="h-3 w-12 animate-pulse rounded bg-muted" />
        </div>
        <div className="space-y-1.5">
          <div className="h-6 w-16 animate-pulse rounded bg-muted" />
          <div className="h-3 w-12 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </Panel>
  );
}

export async function SeoPanel({
  clientId,
  clientSlug,
}: {
  clientId: string;
  clientSlug: string;
}) {
  const href = `/c/${clientSlug}/seo`;
  const supabase = await createClient();
  const { data } = await supabase
    .from("sites")
    .select("gsc_property")
    .eq("client_id", clientId)
    .not("gsc_property", "is", null)
    .limit(1);

  const property = (data?.[0]?.gsc_property as string | undefined) ?? null;
  if (!property) {
    return (
      <Panel title="SEO" href={href}>
        <PanelEmpty>No Search Console property mapped.</PanelEmpty>
      </Panel>
    );
  }

  const result = await fetchSearchPerformance(property, WINDOW_DAYS);
  if (result.status !== "ok") {
    return (
      <Panel title="SEO" href={href}>
        <PanelEmpty>
          {result.status === "reconnect_needed"
            ? "Search Console needs reconnecting."
            : result.status === "no_data"
              ? "No search data for the last 28 days."
              : "Could not load Search Console."}
        </PanelEmpty>
      </Panel>
    );
  }

  return (
    <Panel title="SEO" href={href} hint="last 28 days">
      <div className="flex gap-6">
        <Metric label="Clicks" value={number(result.current.clicks)} />
        <Metric
          label="Impressions"
          value={number(result.current.impressions)}
        />
      </div>
    </Panel>
  );
}

export async function AnalyticsPanel({
  clientId,
  clientSlug,
}: {
  clientId: string;
  clientSlug: string;
}) {
  const href = `/c/${clientSlug}/analytics`;
  const supabase = await createClient();
  const { data } = await supabase
    .from("sites")
    .select("ga4_property")
    .eq("client_id", clientId)
    .not("ga4_property", "is", null)
    .limit(1);

  const property = (data?.[0]?.ga4_property as string | undefined) ?? null;
  if (!property) {
    return (
      <Panel title="Analytics" href={href}>
        <PanelEmpty>No GA4 property mapped.</PanelEmpty>
      </Panel>
    );
  }

  const result = await fetchGa4Report(property, WINDOW_DAYS);
  if (result.status !== "ok") {
    return (
      <Panel title="Analytics" href={href}>
        <PanelEmpty>
          {result.status === "reconnect_needed"
            ? "Analytics needs reconnecting."
            : result.status === "no_data"
              ? "No analytics data for the last 28 days."
              : "Could not load Analytics."}
        </PanelEmpty>
      </Panel>
    );
  }

  return (
    <Panel title="Analytics" href={href} hint="last 28 days">
      <div className="flex gap-6">
        <Metric label="Users" value={number(result.current.users)} />
        <Metric label="Sessions" value={number(result.current.sessions)} />
      </div>
    </Panel>
  );
}
