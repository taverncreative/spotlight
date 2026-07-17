import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

// Inbound client requests from other apps (GEM CRM first), pooled into one
// triage list. Fire-and-forget: the sender never blocks on us, so every failure
// is a plain status code with nothing in the body worth reading.
//
// Auth is a per-sender secret, not a single shared one: the token hashes to a
// row in inbound_sources, and THAT row's source_app is what gets recorded. Any
// source_app in the body is ignored, so a sender cannot label its requests as
// another app.
//
// Service-role is deliberate and load-bearing here. create_client_request is a
// SECURITY DEFINER function granted to service_role ONLY (0042): anon lost
// EXECUTE because the publishable key ships in the browser bundle, and PostgREST
// exposes public functions at /rest/v1/rpc, so an anon grant would let anyone
// insert without ever passing this route and make the secret decorative. That is
// also why this file is the one and only caller.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Generous for a request body, mean for an attacker. The DB's length checks are
// the real backstop; this only stops us parsing megabytes.
const MAX_BODY_BYTES = 16 * 1024;

// Per source_app, per lambda instance, so the real ceiling is limit x instances
// and a cold start resets it. An abuse speed bump, not a cap: the DB's length
// constraints are what actually bound the damage a valid token can do.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(sourceApp: string): boolean {
  const now = Date.now();
  const recent = (hits.get(sourceApp) ?? []).filter(
    (at) => now - at < RATE_WINDOW_MS
  );
  if (recent.length >= RATE_LIMIT) {
    hits.set(sourceApp, recent);
    return true;
  }
  hits.set(sourceApp, [...recent, now]);
  return false;
}

// source_app is absent on purpose: the matched inbound_sources row is
// authoritative. Zod strips unknown keys, so a sender that sends one anyway is
// quietly ignored rather than rejected, which keeps fire-and-forget forgiving.
const BodySchema = z.object({
  client_name: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(5000),
  type: z
    .enum(["feature", "change", "bug", "question", "other"])
    .optional(),
  client_slug: z.string().trim().max(64).optional(),
  submitter: z.string().trim().max(200).optional(),
  link: z.string().trim().max(500).optional(),
  request_id: z.string().trim().max(128).optional(),
});

type MatchedSource = { id: string; source_app: string };

// Resolve a token to its live source by comparing sha256 digests in constant
// time. Every active row is compared, with no early exit, so neither the number
// of comparisons nor the time taken says which row matched (or whether the
// prefix of a stored hash was close). Fine while senders number a handful; if
// this ever grew to thousands of live secrets, it would want an indexed lookup
// on the hash instead, and the timing argument would need revisiting.
function matchSource(
  rows: { id: string; source_app: string; secret_hash: string }[],
  token: string
): MatchedSource | null {
  const provided = createHash("sha256").update(token).digest();
  let matched: MatchedSource | null = null;
  for (const row of rows) {
    // bytea arrives from PostgREST as \x-prefixed hex.
    const stored = Buffer.from(
      String(row.secret_hash).replace(/^\\x/, ""),
      "hex"
    );
    if (
      stored.length === provided.length &&
      timingSafeEqual(stored, provided)
    ) {
      matched = { id: row.id, source_app: row.source_app };
    }
  }
  return matched;
}

// One shape for every rejection: a caller learns the status and nothing else. No
// DB text, no zod issue tree, no stack, and never a hint about whether a token
// was wrong, revoked, or simply absent.
function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  // 1. Token present. Free, and rejects the commonest junk before any work.
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return fail(401, "Unauthorized");

  // 2. Size, before parsing. Reading first and rejecting after would mean
  // parsing whatever was sent.
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return fail(413, "Payload too large");
  }

  const supabase = createAdminClient();

  // 3. Resolve the token to a live source. revoked_at is null means active, the
  // same convention client_api_keys uses.
  const { data: rows, error: sourcesError } = await supabase
    .from("inbound_sources")
    .select("id, source_app, secret_hash")
    .is("revoked_at", null);
  if (sourcesError) {
    console.error("inbound: source lookup failed", sourcesError.code);
    return fail(500, "Internal error");
  }

  const source = matchSource(rows ?? [], token);
  // Unknown, revoked and malformed tokens are one answer. Never say which.
  if (!source) return fail(401, "Unauthorized");

  // 4. Rate limit, keyed by the authenticated sender. Unauthenticated floods are
  // not limited here: they are cheap to reject and the platform is the backstop.
  if (rateLimited(source.source_app)) return fail(429, "Too many requests");

  // 5. Body.
  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(JSON.parse(raw));
  } catch (error) {
    // Name the field so the sender can fix its integration, but nothing beyond
    // it: no issue tree, no received values (which may carry someone's data).
    const field =
      error instanceof z.ZodError ? error.issues[0]?.path.join(".") : undefined;
    return fail(400, field ? `Invalid body: ${field}` : "Invalid body");
  }

  // 6. Insert. source_app comes from the row, never the body. request_id makes a
  // retry idempotent: the function returns the original id and duplicate=true.
  const { data, error } = await supabase.rpc("create_client_request", {
    p_source_app: source.source_app,
    p_client_name: parsed.client_name,
    p_message: parsed.message,
    p_type: parsed.type ?? "other",
    p_client_slug: parsed.client_slug ?? null,
    p_submitter: parsed.submitter ?? null,
    p_link: parsed.link ?? null,
    p_request_id: parsed.request_id ?? null,
  });
  if (error) {
    // Logged for us (code only, never the body or the token), opaque to them.
    console.error("inbound: insert failed", error.code);
    return fail(500, "Internal error");
  }

  // The function returns TABLE(id uuid, duplicate boolean), so PostgREST hands
  // back an array of one row.
  const row = (Array.isArray(data) ? data[0] : data) as
    | { id: string; duplicate: boolean }
    | undefined;
  if (!row?.id) {
    console.error("inbound: insert returned no row");
    return fail(500, "Internal error");
  }

  // Best effort, and deliberately after the row is safe: a failure to stamp
  // last_used_at must never cost us a request we have already accepted.
  const { error: stampError } = await supabase
    .from("inbound_sources")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", source.id);
  if (stampError) console.error("inbound: last_used_at stamp failed", stampError.code);

  // 200 for a first send and for a retry alike: both mean "it is on the list".
  return NextResponse.json(
    { ok: true, id: row.id, duplicate: row.duplicate === true },
    { status: 200 }
  );
}
