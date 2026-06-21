import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client. Bypasses RLS, so it is used only where RLS cannot
// apply. The secret key has no NEXT_PUBLIC prefix and this module imports
// "server-only", so it can never reach the browser. Keep call sites few and
// easy to audit, per docs/architecture.md section 1.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
