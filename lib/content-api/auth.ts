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
  return data as string;
}
