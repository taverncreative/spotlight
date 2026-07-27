import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

// The shared front half of every inbound endpoint: resolve a bearer token to a
// live inbound_sources row, rate limit the sender, and fail opaquely.
//
// This is a module rather than a copy in each route on purpose. There are two
// inbound endpoints now (feedback, print-order) and there will be more, and the
// one thing they must never do is drift on token verification: a second
// hand-rolled comparison is how one endpoint ends up with a non-constant-time
// match, or an early return that leaks which row was close. Same reasoning the
// schema uses for holding secrets one way rather than two (0043).
//
// Deliberately NOT in here: the body schema and the insert. Those differ per
// endpoint and belong to the endpoint.

// bytea arrives from PostgREST as \x-prefixed hex.
type SourceRow = { id: string; source_app: string; secret_hash: string };
export type MatchedSource = { id: string; source_app: string };

// Per source_app per endpoint, per lambda instance, so the real ceiling is
// limit x instances and a cold start resets it. An abuse speed bump, not a cap:
// the DB's length and range constraints are what actually bound the damage a
// valid token can do.
//
// Keyed by endpoint AND source so a busy sender on one endpoint cannot throttle
// itself out of another. In practice each route is its own lambda and the map is
// not shared at all, but the key makes that independence explicit rather than an
// accident of the platform.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

export function rateLimited(endpoint: string, sourceApp: string): boolean {
  const key = `${endpoint}:${sourceApp}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter(
    (at) => now - at < RATE_WINDOW_MS
  );
  if (recent.length >= RATE_LIMIT) {
    hits.set(key, recent);
    return true;
  }
  hits.set(key, [...recent, now]);
  return false;
}

// Resolve a token to its live source by comparing sha256 digests in constant
// time. Every active row is compared, with no early exit, so neither the number
// of comparisons nor the time taken says which row matched (or whether the
// prefix of a stored hash was close). Fine while senders number a handful; if
// this ever grew to thousands of live secrets, it would want an indexed lookup
// on the hash instead, and the timing argument would need revisiting.
export function matchSource(
  rows: SourceRow[],
  token: string
): MatchedSource | null {
  const provided = createHash("sha256").update(token).digest();
  let matched: MatchedSource | null = null;
  for (const row of rows) {
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
export function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

// Read every live source and match. revoked_at is null means active, the same
// convention client_api_keys uses. Returns null for a lookup failure too: the
// caller cannot usefully distinguish them and must not tell the sender either,
// so the error is logged here (code only, never the body or the token) and the
// caller turns any null into 401.
export async function resolveSource(
  supabase: SupabaseClient,
  token: string
): Promise<{ source: MatchedSource | null; lookupFailed: boolean }> {
  const { data: rows, error } = await supabase
    .from("inbound_sources")
    .select("id, source_app, secret_hash")
    .is("revoked_at", null);
  if (error) {
    console.error("inbound: source lookup failed", error.code);
    return { source: null, lookupFailed: true };
  }
  return {
    source: matchSource((rows ?? []) as SourceRow[], token),
    lookupFailed: false,
  };
}

// Best effort, and always called AFTER the row is safe: a failure to stamp
// last_used_at must never cost us a request we have already accepted.
export async function stampLastUsed(
  supabase: SupabaseClient,
  sourceId: string
): Promise<void> {
  const { error } = await supabase
    .from("inbound_sources")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", sourceId);
  if (error) console.error("inbound: last_used_at stamp failed", error.code);
}
