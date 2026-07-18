import { createClient } from "@/lib/supabase/server";
import { DmarcDomainPanel } from "@/components/email/dmarc-domain-panel";
import { AddDomainForm } from "@/components/email/add-domain-form";
import type { KnownSenderRow } from "@/components/email/known-senders-editor";
import { INGEST_DOMAIN } from "@/lib/dmarc/setup";
import {
  buildPanels,
  type DailyRow,
  type DomainInput,
  type OffenderRow,
} from "@/lib/dmarc/panel";

// The date window, stamped outside the component so the render body stays pure
// (the repo's convention -- the clock read lives here, per request, like
// buildBoard in the home page).
function dateWindow(): { today: string; since: string } {
  return {
    today: new Date().toISOString().slice(0, 10),
    since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10),
  };
}

type RecordRow = {
  dmarc_domain_id: string;
  source_ip: string | null;
  email_count: number;
  dkim: { selector: string; domain: string; result: string }[];
  classification: string;
  dmarc_reports: { window_begin: string } | null;
};

// Operator-level email health: every monitored domain as a three-state panel from
// the latest daily rollup, a 30-day strip, and warn/danger detail. Reads are
// RLS-scoped to the operator (dmarc_domains via operator_id, the rollup and
// records via owns_dmarc_domain); the layout gates auth.
//
// Kept glanceable-first: the pill + four-word label is the answer, everything
// else is subordinate. The three queries are small (a handful of domains, 30 days
// of rollup, and only the non-ok records), so they run in one Promise.all.
export default async function EmailPage() {
  const supabase = await createClient();
  const { today, since } = dateWindow();

  const [domainsRes, dailyRes, offendersRes, sendersRes] = await Promise.all([
    supabase
      .from("dmarc_domains")
      .select("id, domain, ingest_address, dmarc_record")
      .order("domain"),
    supabase
      .from("dmarc_daily")
      .select(
        "dmarc_domain_id, day, state, email_count, unknown_count, broken_count"
      )
      .gte("day", since),
    // Only the offending records (warn/danger), joined to their report for the
    // window day. Healthy domains contribute nothing here.
    supabase
      .from("dmarc_report_records")
      .select(
        "dmarc_domain_id, source_ip, email_count, dkim, classification, dmarc_reports(window_begin)"
      )
      .neq("classification", "ok"),
    supabase
      .from("dmarc_known_senders")
      .select(
        "id, dmarc_domain_id, label, dkim_selector, dkim_domain, envelope_domain"
      )
      .order("label"),
  ]);

  const domains = (domainsRes.data ?? []) as DomainInput[];
  const daily = (dailyRes.data ?? []) as DailyRow[];
  const offenders: OffenderRow[] = (
    (offendersRes.data ?? []) as unknown as RecordRow[]
  ).map((r) => ({
    dmarc_domain_id: r.dmarc_domain_id,
    day: r.dmarc_reports?.window_begin
      ? new Date(r.dmarc_reports.window_begin).toISOString().slice(0, 10)
      : "",
    source_ip: r.source_ip,
    email_count: r.email_count,
    dkim: r.dkim ?? [],
    classification: r.classification === "broken" ? "broken" : "unknown",
  }));

  const panels = buildPanels(domains, daily, offenders, today, INGEST_DOMAIN);

  // Known senders grouped by domain, for each panel's inline editor.
  const sendersByDomain = new Map<string, KnownSenderRow[]>();
  for (const row of (sendersRes.data ?? []) as (KnownSenderRow & {
    dmarc_domain_id: string;
  })[]) {
    const list = sendersByDomain.get(row.dmarc_domain_id) ?? [];
    list.push(row);
    sendersByDomain.set(row.dmarc_domain_id, list);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Email health</h1>
        <p className="text-sm text-muted-foreground">
          Who is sending as your domains, and whether they authenticate.
        </p>
      </div>

      <div className="space-y-2 rounded-card border bg-card p-4">
        <p className="text-sm font-medium">Add a domain to monitor</p>
        <AddDomainForm />
      </div>

      {panels.length === 0 ? (
        <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
          No monitored domains yet.
        </p>
      ) : (
        <ul className="grid gap-3">
          {panels.map((panel) => (
            <DmarcDomainPanel
              key={panel.id}
              panel={panel}
              senders={sendersByDomain.get(panel.id) ?? []}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
