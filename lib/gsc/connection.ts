import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { GSC_PROVIDER } from "@/lib/oauth/google";

// Shape getValidAccessToken needs (structurally matches its StoredConnection).
export type GscConnectionRow = {
  id: string;
  access_token: string;
  refresh_token: string | null;
  token_expiry: string | null;
};

async function load(): Promise<GscConnectionRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("oauth_connections")
    .select("id, access_token, refresh_token, token_expiry")
    .eq("provider", GSC_PROVIDER)
    .maybeSingle();
  return data ?? null;
}

// Request-scoped: the SEO page checks the connection and the analytics fetch
// reuses it, with a single DB read per render.
export const loadGscConnection = cache(load);
