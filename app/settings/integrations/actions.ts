"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GOOGLE_PROVIDER_KEYS, isGoogleProvider } from "@/lib/oauth/providers";
import { decryptToken } from "@/lib/oauth/encryption";

// Disconnect a Google provider: delete the operator's row for that provider
// (RLS-scoped), then redirect back to a clean Integrations URL so the card
// re-renders as disconnected.
//
// The grant is revoked at Google only when this is the operator's LAST Google
// connection. GSC and GA4 share a single Google app grant, so revoking a token
// while the other product is still connected would tear that grant down too —
// skipping the revoke keeps the remaining connection intact. Revoke is
// best-effort and never blocks the delete.
export async function disconnectGoogleProvider(formData: FormData) {
  const provider = String(formData.get("provider") ?? "");
  if (!isGoogleProvider(provider)) return;

  const supabase = await createClient();

  const { data: connection } = await supabase
    .from("oauth_connections")
    .select("access_token, refresh_token")
    .eq("provider", provider)
    .maybeSingle();

  const { count: otherGoogle } = await supabase
    .from("oauth_connections")
    .select("provider", { count: "exact", head: true })
    .in("provider", GOOGLE_PROVIDER_KEYS)
    .neq("provider", provider);

  if (connection && (otherGoogle ?? 0) === 0) {
    const cipher = connection.refresh_token ?? connection.access_token;
    try {
      const token = decryptToken(cipher);
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
        }
      );
    } catch {
      // Best-effort revoke; proceed with the delete regardless.
    }
  }

  await supabase.from("oauth_connections").delete().eq("provider", provider);

  revalidatePath("/settings/integrations");
  redirect("/settings/integrations");
}
