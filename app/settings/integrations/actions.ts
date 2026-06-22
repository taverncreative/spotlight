"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GSC_PROVIDER } from "@/lib/oauth/google";
import { decryptToken } from "@/lib/oauth/encryption";

// Disconnect Google Search Console: best-effort revoke at Google, then delete
// the operator's connection row (RLS-scoped). Revoke failures don't block the
// delete.
export async function disconnectGoogleSearchConsole() {
  const supabase = await createClient();

  const { data: connection } = await supabase
    .from("oauth_connections")
    .select("access_token, refresh_token")
    .eq("provider", GSC_PROVIDER)
    .maybeSingle();

  if (connection) {
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

  await supabase.from("oauth_connections").delete().eq("provider", GSC_PROVIDER);

  // Redirect to the clean URL (not just revalidate): a form-submitted action
  // otherwise leaves the client showing the stale Connected UI, and dropping the
  // ?connected=1 param clears the "Connected." banner so the page reads Connect.
  revalidatePath("/settings/integrations");
  redirect("/settings/integrations");
}
