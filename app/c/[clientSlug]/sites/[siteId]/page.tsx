import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireClient } from "@/lib/clients/require-client";
import { MonitoringChip } from "@/components/monitoring-chip";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";

const HISTORY_LIMIT = 20;

type CheckRow = {
  id: string;
  status: string;
  http_status: number | null;
  response_ms: number | null;
  ssl_expiry: string | null;
  domain_expiry: string | null;
  checked_at: string;
};

function formatLondon(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDay(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Read-only check history for one site: the last N site_checks rows, newest
// first. RLS scopes both reads to the operator's own data (owns_client /
// owns_site); the client match below only guards against cross-client URLs.
export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ clientSlug: string; siteId: string }>;
}) {
  const { clientSlug, siteId } = await params;
  const { client } = await requireClient(clientSlug);

  const supabase = await createClient();
  const { data: site } = await supabase
    .from("sites")
    .select("id, client_id, url, label, monitoring_enabled")
    .eq("id", siteId)
    .maybeSingle();
  if (!site || site.client_id !== client.id) notFound();

  const { data: checks } = await supabase
    .from("site_checks")
    .select(
      "id, status, http_status, response_ms, ssl_expiry, domain_expiry, checked_at"
    )
    .eq("site_id", site.id)
    .order("checked_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  const history = (checks ?? []) as CheckRow[];

  let hostname = site.url as string;
  try {
    hostname = new URL(site.url as string).hostname;
  } catch {
    // keep the raw URL if it doesn't parse
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{hostname}</h1>
          {!site.monitoring_enabled ? (
            <MonitoringChip tone="muted">Paused</MonitoringChip>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {site.label ? `${site.label} · ` : ""}Last {HISTORY_LIMIT} checks.{" "}
          <Link
            href={`/c/${clientSlug}/overview`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Back to overview
          </Link>
        </p>
      </div>

      {history.length === 0 ? (
        <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
          No checks yet for this site. Run one from the Sites list with Check
          now.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-card border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Response</TableHead>
                <TableHead>SSL expiry</TableHead>
                <TableHead>Domain expiry</TableHead>
                <TableHead>Checked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((check) => (
                <TableRow key={check.id}>
                  <TableCell>
                    <MonitoringChip
                      tone={check.status === "up" ? "ok" : "danger"}
                    >
                      {check.status === "up" ? "Up" : "Down"}
                      {check.http_status ? ` · ${check.http_status}` : ""}
                    </MonitoringChip>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {check.response_ms != null
                      ? `${check.response_ms} ms`
                      : "—"}
                  </TableCell>
                  <TableCell>{formatDay(check.ssl_expiry)}</TableCell>
                  <TableCell>{formatDay(check.domain_expiry)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatLondon(check.checked_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
