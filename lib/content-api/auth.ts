import "server-only";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The public content API's Supabase client: the ANON (publishable) key, no
// session -- never the operator SSR client or the service-role client. The
// SECURITY DEFINER functions (migration 0035) are the only door, and 0032 denies
// anon all direct table access, so this client can read nothing else.
export function createPublicClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

// Resolve the calling site's client from the Authorization: Bearer key. The key
// is sha256'd and handed (with the path slug) to content_key_client, which
// returns a client_id only for a matching, unrevoked key that belongs to that
// slug -- null for a bad/absent key OR an unknown slug (so callers can return a
// single uniform 401 and never enumerate slugs). The key itself is never logged.
export async function resolveClientId(
  supabase: SupabaseClient,
  request: Request,
  clientSlug: string
): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key) return null;

  const hashHex = createHash("sha256").update(key).digest("hex");
  const { data, error } = await supabase.rpc("content_key_client", {
    p_client_slug: clientSlug,
    p_key_hash: `\\x${hashHex}`,
  });
  if (error || !data) return null;

  // Stamp the key as used. Best effort and deliberately NOT awaited for its
  // result beyond swallowing a failure: a request that has already resolved must
  // not fail because a timestamp did not save.
  //
  // Why a function rather than an update: this client is the ANON one, and 0032
  // denies anon every direct table grant, so the definer function in 0069 is the
  // only way to write this column without widening what the public routes can
  // touch. It takes the hash, never the key.
  //
  // This was missing entirely until now. last_used_at existed and had never once
  // been written, so all nine keys read "never used" while two client sites
  // called these endpoints daily -- a column that looked like a usage signal and
  // was actually noise, which is worse than not having one when you are deciding
  // whether a key is safe to revoke.
  const { error: touchError } = await supabase.rpc("touch_content_key", {
    p_key_hash: `\\x${hashHex}`,
  });
  if (touchError) {
    console.error("content-api: last_used stamp failed", touchError.code);
  }

  return data as string;
}
