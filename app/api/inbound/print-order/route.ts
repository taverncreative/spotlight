import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { inboundPrintOrderSchema } from "@/lib/inbound/print-order-schema";
import {
  bearerToken,
  fail,
  rateLimited,
  resolveSource,
  stampLastUsed,
} from "@/lib/inbound/auth";

// Inbound print orders from other apps (GEM's print library first), pooled into
// one fulfilment queue. Fire-and-forget: the sender never blocks on us, so every
// failure is a plain status code with nothing in the body worth reading.
//
// Auth is a per-sender secret, not a single shared one: the token hashes to a
// row in inbound_sources — the SAME registry /api/inbound/feedback uses, with no
// per-endpoint scoping — and THAT row's source_app is what gets recorded. Any
// source_app in the body is ignored, so a sender cannot label its orders as
// another app.
//
// Service-role is deliberate and load-bearing here. create_print_order is a
// SECURITY DEFINER function granted to service_role ONLY (0059): the publishable
// key ships in the browser bundle, and PostgREST exposes public functions at
// /rest/v1/rpc, so an anon grant would let anyone insert without ever passing
// this route and make the secret decorative. That is also why this file is the
// one and only caller.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Larger than feedback's 16KB because the body carries an items array. Set
// deliberately ABOVE what the schema permits (50 items at their maximum field
// lengths) so that an oversized order is rejected by zod, which can name the
// offending field, rather than by a byte count that tells the sender nothing.
const MAX_BODY_BYTES = 64 * 1024;

const ENDPOINT = "print-order";

export async function POST(request: Request) {
  // 1. Token present. Free, and rejects the commonest junk before any work.
  const token = bearerToken(request);
  if (!token) return fail(401, "Unauthorized");

  // 2. Size, before parsing. Reading first and rejecting after would mean
  // parsing whatever was sent.
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return fail(413, "Payload too large");
  }

  const supabase = createAdminClient();

  // 3. Resolve the token to a live source.
  const { source, lookupFailed } = await resolveSource(supabase, token);
  if (lookupFailed) return fail(500, "Internal error");
  // Unknown, revoked and malformed tokens are one answer. Never say which.
  if (!source) return fail(401, "Unauthorized");

  // 4. Rate limit, keyed by the authenticated sender. Unauthenticated floods are
  // not limited here: they are cheap to reject and the platform is the backstop.
  if (rateLimited(ENDPOINT, source.source_app)) {
    return fail(429, "Too many requests");
  }

  // 5. Body — validated against the external contract, not the DB shape.
  let parsed: ReturnType<typeof inboundPrintOrderSchema.parse>;
  try {
    parsed = inboundPrintOrderSchema.parse(JSON.parse(raw));
  } catch (error) {
    // Name the field so the sender can fix its integration, but nothing beyond
    // it: no issue tree, no received values (which may carry someone's data).
    // The path includes the item index for an items error (e.g. "items.2.name"),
    // which is the difference between a fixable report and a shrug.
    const field =
      error instanceof z.ZodError ? error.issues[0]?.path.join(".") : undefined;
    return fail(400, field ? `Invalid body: ${field}` : "Invalid body");
  }

  // 6. Insert. source_app comes from the row, never the body. order_id makes a
  // retry idempotent: the function returns the original id and duplicate=true
  // without re-inserting items, so a resend cannot cause a second print run.
  // client_name is optional on the wire but NOT NULL in the table, so an omitted
  // one falls back to the source name (it reads as e.g. "gem-crm" in the queue,
  // rather than 400-ing a sender that had no client name to give).
  const { data, error } = await supabase.rpc("create_print_order", {
    p_source_app: source.source_app,
    p_client_name: parsed.client_name ?? source.source_app,
    p_items: parsed.items,
    p_client_slug: parsed.client_slug ?? null,
    p_submitter: parsed.submitter ?? null,
    p_ordered_at: parsed.ordered_at ?? null,
    p_order_id: parsed.order_id,
  });
  if (error) {
    // Logged for us (code only, never the body or the token), opaque to them.
    console.error("inbound: print order insert failed", error.code);
    return fail(500, "Internal error");
  }

  // The function returns TABLE(id uuid, duplicate boolean), so PostgREST hands
  // back an array of one row.
  const row = (Array.isArray(data) ? data[0] : data) as
    | { id: string; duplicate: boolean }
    | undefined;
  if (!row?.id) {
    console.error("inbound: print order insert returned no row");
    return fail(500, "Internal error");
  }

  await stampLastUsed(supabase, source.id);

  // 200 for a first send and for a retry alike: both mean "it is in the queue".
  return NextResponse.json(
    { ok: true, id: row.id, duplicate: row.duplicate === true },
    { status: 200 }
  );
}
