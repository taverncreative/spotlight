import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { INGEST_DOMAIN } from "@/lib/dmarc/setup";
import { storeReport } from "@/lib/dmarc/store";
import {
  MAX_ATTACHMENT_BYTES,
  downloadCapped,
  handleInbound,
} from "@/lib/dmarc/inbound";

// Resend's email.received webhook: the live feed for DMARC monitoring. Svix
// signature verification comes FIRST, over the raw body, before anything else
// is read; then the recipient address routes to a monitored domain by exact
// match on ingest_address, the report attachment is fetched size-capped, and
// the existing hardened parser and storeReport do the rest unchanged.
//
// All policy lives in lib/dmarc/inbound.ts (tested there with real signatures
// and the real fixture); this file only wires the real effects. Service-role is
// deliberate: the webhook has no session, the same shape as the inbound
// feedback route, and every write is scoped by the domain id resolved from the
// verified payload's recipient.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A genuine email.received payload is small metadata (attachment bytes travel
// via the Attachments API, not the webhook). Anything past this cannot be one,
// and refusing before HMAC-ing megabytes keeps verification cheap.
const MAX_BODY_BYTES = 1024 * 1024;

// Best-effort redelivery short-circuit, per lambda instance: a bounded
// insertion-ordered set, evicting oldest. An optimisation only; the real
// idempotency is storeReport's (domain, report_id) unique key.
const SEEN_LIMIT = 200;
const seen = new Set<string>();
function alreadyProcessed(emailId: string): boolean {
  return seen.has(emailId);
}
function markProcessed(emailId: string): void {
  seen.add(emailId);
  if (seen.size > SEEN_LIMIT) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
}

export async function POST(request: Request) {
  // Fail closed on missing configuration: 500 so Resend retries once fixed,
  // rather than silently dropping reports. The values are never logged.
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  const apiKey = process.env.RESEND_API_KEY;
  if (!webhookSecret || !apiKey) {
    console.error(
      "dmarc inbound: RESEND_WEBHOOK_SECRET or RESEND_API_KEY not set"
    );
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  const headers = {
    id: request.headers.get("svix-id") ?? "",
    timestamp: request.headers.get("svix-timestamp") ?? "",
    signature: request.headers.get("svix-signature") ?? "",
  };

  const resend = new Resend(apiKey);
  const admin = createAdminClient();

  const outcome = await handleInbound(rawBody, headers, INGEST_DOMAIN, {
    verify: (payload, svixHeaders) =>
      resend.webhooks.verify({
        payload,
        headers: svixHeaders,
        webhookSecret,
      }),

    resolveDomain: async (address) => {
      const { data, error } = await admin
        .from("dmarc_domains")
        .select("id")
        .eq("ingest_address", address)
        .maybeSingle();
      if (error) throw new Error("domain lookup failed");
      return data;
    },

    listAttachments: async (emailId) => {
      const { data, error } = await resend.emails.receiving.attachments.list({
        emailId,
      });
      if (error || !data) throw new Error("attachment list failed");
      return data.data;
    },

    download: (url) => downloadCapped(url, MAX_ATTACHMENT_BYTES),

    store: async (domainId, parsed) => {
      const { data: known, error } = await admin
        .from("dmarc_known_senders")
        .select("dkim_selector, dkim_domain")
        .eq("dmarc_domain_id", domainId);
      if (error) return { ok: false, error: "could not load known senders" };
      return storeReport(admin, domainId, parsed, known ?? []);
    },

    alreadyProcessed,
    markProcessed,
  });

  // One log line per delivery, outcome only: ids and counts, never headers,
  // secrets or bodies.
  console.log(`dmarc inbound: ${outcome.status} ${outcome.note}`);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
