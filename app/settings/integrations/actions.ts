"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GOOGLE_PROVIDER_KEYS, isGoogleProvider } from "@/lib/oauth/providers";
import { META_PROVIDER, GRAPH_VERSION } from "@/lib/oauth/meta";
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

// Disconnect Meta: delete the facebook oauth_connections row and all of the
// operator's connected Pages/IG accounts (both RLS-scoped to this operator),
// then return to a clean Integrations URL. Meta is a single app grant (unlike
// Google's shared GSC/GA4 grant), so the grant is revoked outright via DELETE
// /me/permissions. Revoke is best-effort and never blocks the delete.
export async function disconnectMeta() {
  const supabase = await createClient();

  const { data: connection } = await supabase
    .from("oauth_connections")
    .select("access_token")
    .eq("provider", META_PROVIDER)
    .maybeSingle();

  if (connection) {
    try {
      const token = decryptToken(connection.access_token);
      await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/me/permissions?access_token=${encodeURIComponent(token)}`,
        { method: "DELETE" }
      );
    } catch {
      // Best-effort revoke; proceed with the delete regardless.
    }
  }

  await supabase
    .from("oauth_connections")
    .delete()
    .eq("provider", META_PROVIDER);
  // The operator's connected Pages/IG accounts (RLS scopes this to their rows;
  // the filter is just supabase-js's required predicate).
  await supabase.from("meta_accounts").delete().not("id", "is", null);

  revalidatePath("/settings/integrations");
  redirect("/settings/integrations");
}

// Assign a connected Meta account (Page or Instagram) to one of the operator's
// clients — or back to Unassigned (client_id null). This sets meta_accounts.
// client_id, the column the Social composer's "Post to" selector filters on, so
// an assignment lights the account up as a target for that client.
//
// Operator-scoped two ways: meta_accounts RLS limits the account to the
// operator's own rows, and the target client is looked up under the operator's
// clients RLS — a non-owned client id isn't found, so the assignment is rejected
// (the meta_accounts FK alone would not enforce client ownership).
//
// Convenience: assigning a Page to a client cascades to its linked Instagram
// rows that are still unassigned, so an IG defaults to mirror its Page. The IG
// stays independently overridable (the cascade only fills nulls) and is left
// untouched when the Page is later unassigned.
export async function assignMetaAccountClient(formData: FormData) {
  const accountId = String(formData.get("account_id") ?? "");
  const raw = String(formData.get("client_id") ?? "");
  const clientId = raw === "" ? null : raw;
  if (!accountId) return;

  const supabase = await createClient();

  const { data: account } = await supabase
    .from("meta_accounts")
    .select("id, platform")
    .eq("id", accountId)
    .maybeSingle();
  if (!account) return; // not the operator's account (RLS)

  if (clientId) {
    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .eq("id", clientId)
      .maybeSingle();
    if (!client) return; // not the operator's client — reject the assignment
  }

  await supabase
    .from("meta_accounts")
    .update({ client_id: clientId })
    .eq("id", accountId);

  if (account.platform === "facebook" && clientId) {
    await supabase
      .from("meta_accounts")
      .update({ client_id: clientId })
      .eq("parent_account_id", accountId)
      .is("client_id", null);
  }

  revalidatePath("/settings/integrations");
}
