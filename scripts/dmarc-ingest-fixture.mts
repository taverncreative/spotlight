// Slice 1 driver: ingest the real Outlook fixture end to end -- parse, classify,
// store, roll up -- and prove dedup by being safe to re-run. Not the webhook;
// that is slice 2. This exercises the same storeReport() the webhook will call.
//
// Run (the --import hook resolves the repo's "@/" alias for plain Node):
//   node --env-file=.env.local --import ./scripts/test-resolve.mjs \
//     scripts/dmarc-ingest-fixture.mts
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { parseReport } from "@/lib/dmarc/parser";
import { storeReport } from "@/lib/dmarc/store";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// Seed a monitored domain + its known senders under some client (idempotent).
const { data: client } = await admin
  .from("clients")
  .select("id")
  .order("created_at")
  .limit(1)
  .maybeSingle();
if (!client) {
  console.error("FAIL: no client to attach the monitored domain to. Seed one first.");
  process.exit(1);
}

await admin.from("dmarc_domains").upsert(
  {
    client_id: client.id,
    domain: "taverncreative.com",
    ingest_address: "taverncreative-com@inbound.example",
    dmarc_record: "v=DMARC1; p=none; rua=mailto:taverncreative-com@inbound.example; fo=1",
  },
  { onConflict: "client_id,domain", ignoreDuplicates: true }
);
const { data: domain } = await admin
  .from("dmarc_domains")
  .select("id")
  .eq("client_id", client.id)
  .eq("domain", "taverncreative.com")
  .single();
if (!domain) {
  console.error("FAIL: could not resolve the seeded monitored domain.");
  process.exit(1);
}

await admin.from("dmarc_known_senders").upsert(
  [
    { dmarc_domain_id: domain.id, label: "Google Workspace", dkim_selector: "google", dkim_domain: "taverncreative.com" },
    { dmarc_domain_id: domain.id, label: "Resend / SES", dkim_selector: "resend", dkim_domain: "taverncreative.com", envelope_domain: "send.taverncreative.com" },
  ],
  { onConflict: "dmarc_domain_id,dkim_selector,dkim_domain", ignoreDuplicates: true }
);
const { data: known } = await admin
  .from("dmarc_known_senders")
  .select("dkim_selector, dkim_domain")
  .eq("dmarc_domain_id", domain.id);

// Parse the fixture and store it.
const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(resolve(here, "../lib/dmarc/__fixtures__/outlook-taverncreative.xml"));
const parsed = await parseReport(fixture);
const result = await storeReport(admin, domain.id, parsed, known ?? []);

console.log("ingest result:", JSON.stringify(result));

// Report the current stored state so a re-run visibly dedups.
const [{ count: reports }, { count: records }, { data: daily }] = await Promise.all([
  admin.from("dmarc_reports").select("id", { count: "exact", head: true }).eq("dmarc_domain_id", domain.id),
  admin.from("dmarc_report_records").select("id", { count: "exact", head: true }).eq("dmarc_domain_id", domain.id),
  admin.from("dmarc_daily").select("day, state, email_count, unknown_count, broken_count").eq("dmarc_domain_id", domain.id),
]);
console.log(`stored: reports=${reports} records=${records} daily=${JSON.stringify(daily)}`);
