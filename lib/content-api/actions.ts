"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireClient } from "@/lib/clients/require-client";
import { generateKey } from "@/lib/content-api/keys";

// Content API read-key management, all behind requireClient/owns_client. Writes
// go through the operator SSR client, so RLS (client_api_keys_operator_all)
// enforces the operator can only touch their own clients' keys -- no service
// role anywhere. Only the sha256 hash is stored; the plaintext is returned once.

export type GenerateKeyResult =
  | { ok: true; key: string; keyPrefix: string }
  | { ok: false; error: string };

export async function generateApiKey(
  clientSlug: string,
  label: string
): Promise<GenerateKeyResult> {
  const { client } = await requireClient(clientSlug);
  const { key, keyPrefix, keyHashHex } = generateKey();

  const supabase = await createClient();
  const { error } = await supabase.from("client_api_keys").insert({
    client_id: client.id,
    key_hash: `\\x${keyHashHex}`,
    key_prefix: keyPrefix,
    label: label.trim() || null,
  });
  if (error) return { ok: false, error: "Could not generate the key." };

  revalidatePath(`/c/${clientSlug}/overview`);
  return { ok: true, key, keyPrefix };
}

export type RevokeKeyResult = { ok: boolean; error?: string };

export async function revokeApiKey(
  clientSlug: string,
  keyId: string
): Promise<RevokeKeyResult> {
  await requireClient(clientSlug);

  const supabase = await createClient();
  const { error } = await supabase
    .from("client_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId);
  if (error) return { ok: false, error: "Could not revoke the key." };

  revalidatePath(`/c/${clientSlug}/overview`);
  return { ok: true };
}
