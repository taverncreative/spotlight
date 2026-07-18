import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyRecord } from "@/lib/dmarc/classify";
import type {
  Classification,
  KnownSender,
  ParsedReport,
} from "@/lib/dmarc/types";

// Store a parsed report against a monitored domain: dedupe, classify each record,
// insert the rows, and refresh the day's rollup. Written to take the client as an
// argument so slice 2's webhook reuses it unchanged (both call it with the
// service-role admin client, which has no session -- scope is the domain id
// resolved from the ingest address, not RLS).

export type StoreResult =
  | { ok: true; duplicate: false; records: number; day: string; state: string }
  | { ok: true; duplicate: true }
  | { ok: false; error: string };

// The report window's day, in UTC, matching refresh_dmarc_daily's
// (window_begin at time zone 'UTC')::date.
function windowDay(windowBeginUnix: number): string {
  return new Date(windowBeginUnix * 1000).toISOString().slice(0, 10);
}

export async function storeReport(
  supabase: SupabaseClient,
  dmarcDomainId: string,
  parsed: ParsedReport,
  known: KnownSender[]
): Promise<StoreResult> {
  // 1. Insert the report. The unique (dmarc_domain_id, report_id) is the dedup
  // seam: a re-ingest returns no row, and we stop before writing records again,
  // so the rollup is never double-counted.
  const { data: reportRow, error: reportError } = await supabase
    .from("dmarc_reports")
    .insert({
      dmarc_domain_id: dmarcDomainId,
      report_id: parsed.reportId,
      org_name: parsed.orgName,
      window_begin: new Date(parsed.windowBegin * 1000).toISOString(),
      window_end: new Date(parsed.windowEnd * 1000).toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (reportError) {
    // 23505 = unique violation = already ingested. Any other error is real.
    if (reportError.code === "23505") return { ok: true, duplicate: true };
    return { ok: false, error: "could not store the report" };
  }
  if (!reportRow) return { ok: true, duplicate: true };

  // 2. Classify and insert the records.
  const classifications: Classification[] = [];
  const rows = parsed.records.map((record) => {
    const classification = classifyRecord(record, known);
    classifications.push(classification);
    return {
      dmarc_report_id: reportRow.id,
      dmarc_domain_id: dmarcDomainId,
      source_ip: record.sourceIp,
      email_count: record.count,
      header_from: record.headerFrom,
      envelope_from: record.envelopeFrom,
      dkim: record.dkim,
      spf_result: record.spf?.result ?? null,
      disposition: record.disposition,
      classification,
    };
  });

  if (rows.length > 0) {
    const { error: recordsError } = await supabase
      .from("dmarc_report_records")
      .insert(rows);
    if (recordsError) return { ok: false, error: "could not store the records" };
  }

  // 3. Refresh the day's rollup from all records on that day (idempotent).
  const day = windowDay(parsed.windowBegin);
  const { error: rollupError } = await supabase.rpc("refresh_dmarc_daily", {
    p_domain_id: dmarcDomainId,
    p_day: day,
  });
  if (rollupError) return { ok: false, error: "could not refresh the rollup" };

  // Report the day's state back for the caller's summary/logs.
  const { data: daily } = await supabase
    .from("dmarc_daily")
    .select("state")
    .eq("dmarc_domain_id", dmarcDomainId)
    .eq("day", day)
    .maybeSingle();

  return {
    ok: true,
    duplicate: false,
    records: rows.length,
    day,
    state: (daily?.state as string) ?? "ok",
  };
}
